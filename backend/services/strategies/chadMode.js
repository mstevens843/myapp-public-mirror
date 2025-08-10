/* ──────────────────────────────────────────────────────────
   Chad-Mode Strategy – multi-mint support + auto-dump
   ────────────────────────────────────────────────────────── */

const fs                     = require("fs");
const prisma                 = require("../../prisma/prisma");
const { strategyLog }        = require("./logging/strategyLogger");
const { emitHealth }         = require("./logging/emitHealth");
const { createSummary, tradeExecuted }      = require("./core/alerts");
const wm                     = require("./core/walletManager");
const guards                 = require("./core/tradeGuards");
const { getSafeQuote }       = require("./core/quoteHelper");
const { liveBuy, simulateBuy } = require("./core/tradeExecutor");
const { initTxWatcher }      = require("./core/txTracker");
const {
  lastTickTimestamps,
  runningProcesses,
}                             = require("../utils/strategy_utils/activeStrategyTracker");
const getTokenShortTermChange = require("./paid_api/getTokenShortTermChanges");
const { getWalletBalance, isAboveMinBalance } = require("../utils");

// ----------------------------------------------------------------------
// Extended helper imports (signals + risk)
//
// Chad mode is manual by design.  The following modules provide stubs
// for symmetry with other strategies.  They will only be used if
// explicitly enabled via cfg.useSignals or cfg.executionShape.
const chadSignals = require("./signals/chadmode");
const chadRisk    = require("./risk/chadmodePolicy");

module.exports = async function chadMode(cfg = {}) {
  const botId = cfg.botId || "manual";
  const log   = strategyLog("chadmode", botId, cfg);
  const sum   = createSummary("ChadMode", log, cfg.userId);

  // Report when this bot exits.  Without this hook the health monitor
  // would not know that the bot has stopped and could display stale
  // status.
  process.on('exit', () => {
    emitHealth(botId, { status: 'stopped' });
  });

  /* ╭─ static config ────────────────────────────────────── */
  const BASE_MINT = "So11111111111111111111111111111111111111112";

  // ← multi-mint support
  const TARGETS = Array.isArray(cfg.outputMints)
    ? cfg.outputMints
        .map(m => m.replace(/[^\x20-\x7E]+/g, "").trim())
        .filter(Boolean)
    : [cfg.outputMint].filter(Boolean);

  if (!TARGETS.length) return log("error", "No outputMint(s) provided – aborting");

  const FEE_LAMPORTS     = +cfg.priorityFeeLamports || 10_000;
  const LAMPORTS         = (+cfg.amountToSpend || 0.03) * 1e9;
  const SLIPPAGE         = +cfg.slippage || 5;
  const MAX_IMPACT_PCT   = +cfg.maxSlippage     || 0.25;
  const SLIPPAGE_MAX_PCT = +cfg.slippageMaxPct  || 10;
  const INTERVAL_MS      = (+cfg.interval || 20) * 1000;
  const MAX_OPEN_TRADES  = +cfg.maxOpenTrades   || 2;
  const MAX_TRADES       = Number.isInteger(+cfg.maxTrades)
    ? +cfg.maxTrades
    : 1;                       // each “trade” == one loop over TARGETS
  const HALT_ON_FAILS    = +cfg.haltOnFailures  || 4;
  const MIN_BAL_SOL      = 0.02;

  /* auto-sell defaults */
  const AS = {
    enabled        : true,
    delay          : 10_000,
    dumpPct        : 100,
    randomJitterMs : 0,
    ...(cfg.autoSell || {}),
  };

  const DRY_RUN   = cfg.dryRun === true;
  const execTrade = DRY_RUN ? simulateBuy : liveBuy;

  /* ╭─ runtime state ────────────────────────────────────── */
  let loops    = 0;
  let fails    = 0;
  let dumping  = false;
  let processing = false;
  const boughtMintsThisSession = new Set();

  log("info", `🔗 Loading wallet from DB (walletId: ${cfg.walletId})`);
  await wm.initWalletFromDb(cfg.userId, cfg.walletId);
  initTxWatcher("ChadMode");

  log(
    "info",
    `[CONFIG] TARGETS=${TARGETS.join(",")} AMT=${LAMPORTS / 1e9} SOL SLIP=${SLIPPAGE}% MAX_IMPACT=${MAX_IMPACT_PCT}`,
  );
  log(
    "info",
    `[CONFIG] FEE=${FEE_LAMPORTS} INTERVAL=${INTERVAL_MS / 1000}s OPEN_TR=${MAX_OPEN_TRADES} HALT_ON_FAILS=${HALT_ON_FAILS}`,
  );
  log("info", `[CONFIG] AUTO_SELL=${JSON.stringify(AS)}`);

  /* ╭─ main loop ───────────────────────────────────────── */
  async function tick() {
    // Capture the start time for this iteration so we can report
    // loop duration back to the health registry.
    const _healthStart = Date.now();
    if (processing) return;
    processing = true;

    try {
      if (loops >= MAX_TRADES) {  
        processing = false;
        return;
      }

      log("loop", `\nChad Tick @ ${new Date().toLocaleTimeString()}`);
      lastTickTimestamps[botId] = Date.now();

      // Optional: compute any manual mode signals.  This stub simply
      // logs failures and returns immediately.  To enable, set
      // cfg.useSignals on the UI.  It does not block the trading loop.
      if (cfg.useSignals) {
        chadSignals(cfg).catch((err) => {
          log("error", `signal precompute failed: ${err.message || err}`);
        });
      }

      if (dumping) {
        log("warn", "⏸ Waiting for auto-dump to complete");
        processing = false;
        return;
      }

      guards.assertOpenTradeCap("chadmode", botId, MAX_OPEN_TRADES);

      if (
        !(await wm.ensureMinBalance(
          MIN_BAL_SOL,
          getWalletBalance,
          isAboveMinBalance,
        ))
      ) {
        log("warn", "Balance < min – skipping tick");
        processing = false;
        return;
      }
      const wallet = wm.current();

      /* reset mint tracker each loop */
      boughtMintsThisSession.clear();

      /* ── iterate mints ─────────────────────────────── */
      for (const mint of TARGETS) {
        // if (boughtMintsThisSession.has(mint)) {
        //   log("warn", `⚠️ Already bought ${mint} in this session – skipping`);
        //   continue;
        // }

        /* ── get quote (adaptive) ─────────────────── */
        let attempt = 0;
        let curSlip = SLIPPAGE;
        let curFee  = FEE_LAMPORTS;
        let quote   = null;

        while (attempt < 4) {
          log("info", `Getting swap quote for ${mint}…`);
          const res = await getSafeQuote({
            inputMint    : BASE_MINT,
            outputMint   : mint,
            amount       : LAMPORTS,
            slippage     : curSlip,
            maxImpactPct : MAX_IMPACT_PCT,
          });

          if (!res.ok) {
            log("warn", `Quote failed: ${res.reason || "no route"}`);
            sum.inc(res.reason || "quoteFail");
            attempt++;
            curSlip = Math.min(SLIPPAGE_MAX_PCT, curSlip + 1);
            curFee += 5_000;
            continue;
          }

          quote = res.quote;
          quote.prioritizationFeeLamports = curFee;
          log(
            "info",
            `Quote for ${mint} – impact ${(quote.priceImpactPct * 100).toFixed(
              2,
            )}% fee=${curFee}`,
          );
          break;
        }

        if (!quote) continue;

        /* ── execute buy ─────────────────────────── */
        log("info", `[🚀 BUY ATTEMPT] Aping token ${mint}…`);
        const txHash = await execTrade({
          quote,
          wallet,
          mint,
          meta: {
            strategy        : "Chad Mode",
            walletId        : cfg.walletId,
            userId          : cfg.userId,
            slippage        : SLIPPAGE,
            category        : "ChadMode",
            tpPercent       : cfg.tpPercent ?? 0,
            slPercent       : cfg.slPercent ?? 0,
            tp              : cfg.takeProfit,
            sl              : cfg.stopLoss,
            openTradeExtras : { strategy: "Chad Mode" },
            // NEW: optional execution shape for manual mode; allow the UI
            // to choose a custom executor.  When undefined the default
            // single‑swap executor will be used.
            executionShape  : cfg.executionShape,
            // NEW: attach chad mode risk policy for future guardrails
            riskPolicy      : chadRisk,
          },
        });

        // trades++;
        sum.inc("buys");
        boughtMintsThisSession.add(mint);

        const txLink = DRY_RUN
          ? ""
          : ` Tx: https://solscan.io/tx/${txHash}`;
        log("info", `[🎆 BOUGHT SUCCESS] ${mint}${txLink}`);

        /* quick overview */
        try {
          const o = await getTokenShortTermChange(mint, "5m", "1h");
          log(
            "info",
            `[OVERVIEW] ${mint} | $${(o.price || 0).toFixed(4)} | 5m ${(o.priceChange5m * 100).toFixed(2)}% | 1h ${(o.priceChange * 100).toFixed(2)}% | vol1h $${(o.volume1h || 0).toLocaleString()}`,
          );
        } catch {}

        /* schedule dump */
        if (!DRY_RUN && AS.enabled && quote.outAmount) {
          scheduleDump(wallet, quote.outAmount, mint);
        }

        /* cap check */
      //   if (trades >= MAX_TRADES) break;
      // }
        }
      // if (trades >= MAX_TRADES) {
      /* one full sweep finished */
      loops++;

      if (loops >= MAX_TRADES) {

        log("info", "🧯 Max trades hit – stopping bot");
        clearInterval(loopHandle);
        if (!dumping || !AS.enabled)
          await finish("✅ ChadMode completed (cap reached)");
      }

      fails = 0;
    } catch (err) {
      if (/insufficient.*lamports|insufficient.*balance/i.test(err.message)) {
        log("error", "🛑 Not enough SOL – bot shutting down");
        await finish("ChadMode halted: insufficient SOL");
        return;
      }
      fails++;
      sum.inc("errors");
      log("error", err?.message || String(err));
            await tradeExecuted({
              userId     : cfg.userId,
              mint,
              tx         : txHash,
              wl         : cfg.walletLabel || "default",
              category   : "ChadMode",
              simulated  : DRY_RUN,
              amountFmt  : `${(SNIPE_LAMPORTS / 1e9).toFixed(3)} ${BASE_MINT === SOL_MINT ? "SOL" : "USDC"}`,
              impactPct  : (quote?.priceImpactPct || 0) * 100,
            });
      if (fails >= HALT_ON_FAILS) {
        log("error", "🛑 halted (too many errors)");
        await finish("ChadMode halted on errors");
      }
    } finally {
      processing = false;
      // Emit health telemetry for this iteration.  A static restartCount
      // of 0 is used here; restart counts are managed by the supervisor.
      const _duration = Date.now() - _healthStart;
      emitHealth(botId, {
        lastTickAt: new Date().toISOString(),
        loopDurationMs: _duration,
        restartCount: 0,
        status: 'running',
      });
    }
  }

  /* ╭─ auto-dump helper ───────────────────────────────── */
  const { performManualSell } = require("../manualExecutor");
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function scheduleDump(wallet, outAmountRaw, mint) {
    if (!outAmountRaw) {
      log("warn", "🛑 Auto-dump aborted – outAmountRaw undefined");
      return;
    }

    dumping = true;
    const jitter = AS.randomJitterMs
      ? randInt(-AS.randomJitterMs, AS.randomJitterMs)
      : 0;
    const delay = AS.delay + jitter;
    const sellAmt =
      (BigInt(outAmountRaw) * BigInt(AS.dumpPct)) / 100n;

    log(
      "info",
      `⏳ Dumping ${AS.dumpPct}% of ${mint} (~${sellAmt} raw) in ${(delay / 1000).toFixed(1)}s`,
    );

    setTimeout(async () => {
      try {
        await performManualSell({
          percent     : AS.dumpPct,
          mint,
          strategy    : "Chad Mode",
          walletId    : cfg.walletId,
         	userId      : cfg.userId,
          walletLabel : cfg.walletLabel || "default",
          triggerType : "autoDump",
          outAmount   : outAmountRaw.toString(),
        });
        log("info", `💸 Auto-dumped ${AS.dumpPct}% of ${mint} → DB updated`);
      } catch (e) {
        log("error", `💥 Dump Error: ${e.message}`);
      } finally {
        dumping = false;
        if (loops >= MAX_TRADES) await finish("✅ ChadMode session finished");      }
    }, delay);
  }

  /* ╭─ graceful finish helper ─────────────────────────── */
  async function finish(msg) {
    try {
      await sum.printAndAlert("ChadMode");
    } catch {}
    log("summary", msg);
    if (runningProcesses[botId])
      runningProcesses[botId].finished = true;
    clearInterval(loopHandle);
    process.exit(0);
  }

  /* ╭─ start scheduler ───────────────────────────────── */
  const loopHandle = setInterval(tick, INTERVAL_MS);
  runningProcesses[botId] = { mode: "chadmode", proc: loopHandle };
};

/* CLI helper */
if (require.main === module) {
  const fp = process.argv[2];
  if (!fp || !fs.existsSync(fp)) {
    console.error("Pass config JSON path");
    process.exit(1);
  }
  module.exports(JSON.parse(fs.readFileSync(fp, "utf8")));
}