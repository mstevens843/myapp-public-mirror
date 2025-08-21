/* backend/services/strategies/paperTrader.js
   ───────────────────────────────────────────
   Permanent dry‑run clone of Sniper

   • Runs *identical* filters, safety checks, quotes & logs
   • Forces dryRun → simulateBuy()
   • Trades logged like real ones (strategy:"Paper Trader")
   • Sell = open‑trades ➜ closed‑trades (handled elsewhere)
*/

const fs            = require("fs");
const pLimit        = require("p-limit");
const { v4: uuid }  = require("uuid");
const prisma        = require("../../prisma/prisma");

/* ── paid‑API helpers ─────────────────────────────── */
const getTokenShortTermChange = require("./paid_api/getTokenShortTermChanges");
const getTokenCreationTime    = require("./paid_api/getTokenCreationTime");
const resolveTokenFeed        = require("./paid_api/tokenFeedResolver");

/* ── safety + logging ─────────────────────────────── */
const { isSafeToBuyDetailed }          = require("../utils/safety/safetyCheckers/botIsSafeToBuy");
const { logSafetyResults }             = require("./logging/logSafetyResults");
const { strategyLog }                  = require("./logging/strategyLogger");
const { lastTickTimestamps, runningProcesses }
      = require("../utils/strategy_utils/activeStrategyTracker");

/* ── core helpers ─────────────────────────────────── */
const wm              = require("./core/walletManager");
const guards          = require("./core/tradeGuards");
const createCooldown  = require("./core/cooldown");
const { getSafeQuote }  = require("./core/quoteHelper");
const { simulateBuy }   = require("./core/tradeExecutor");   // 💯 always simulate
// ✨ Added in paper-sim-upgrade
// We introduce a paper execution adapter that can perform more realistic
// simulations including slippage, latency and partial fills.  The adapter
// is only used when execModel !== "ideal" (default) so that existing
// behavior remains unchanged.  See core/paperExecutionAdapter.js for
// implementation details.
const { executePaperTrade } = require("./core/paperTrader/paperExecutionAdapter");
const { passes, explainFilterFail }  = require("./core/passes");
const { createSummary, tradeExecuted } = require("./core/alerts");
const runLoop          = require("./core/loopDriver");
const { initTxWatcher }= require("./core/txTracker");

/* ── misc ─────────────────────────────────────────── */
const { getWalletBalance, isAboveMinBalance } = require("../utils");

/* ── constants ────────────────────────────────────── */
const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

module.exports = async function paperTrader(cfg = {}) {
  console.log("🚀 paperTrader loaded", cfg);

  /* ── logger / rate‑limit helpers ────────────────── */
  const limitBirdeye = pLimit(2);
  const botId  = cfg.botId || "paperTrader";
  const log    = strategyLog("paperTrader", botId, cfg);

  /* ── force permanent dry‑run ────────────────────── */
  cfg.dryRun = true;

  // ✨ Added in paper-sim-upgrade
  // Determine whether to use the new paper execution adapter.  The
  // `execModel` config option controls the simulation style.  When
  // absent or set to "ideal" we fall back to the existing simulateBuy
  // implementation to preserve legacy behaviour.  Otherwise we
  // construct a wrapper around the adapter that accepts the quote,
  // mint and meta values and forwards simulation parameters.
  const execModel = cfg.execModel || "ideal";
  const paperParams = {
    execModel,
    seed: cfg.seed || null,
    latency: cfg.latency || null,
    slippageBpsCap: cfg.slippageBpsCap || cfg.slippageBps || null,
    failureRates: cfg.failureRates || null,
    partials: cfg.partials || null,
    priorityFeeLamports: cfg.priorityFeeLamports || null,
    enableShadowMode: cfg.enableShadowMode || false,
  };

  let execBuy;
  if (execModel && execModel !== "ideal") {
    execBuy = async ({ quote, mint, meta }) => {
      // Generate a deterministic paper run identifier for each run
      const runId = cfg.paperRunId || uuid();
      const result = await executePaperTrade({ quote, mint, meta, config: paperParams });
      // Attach the run id to the result for downstream consumers
      result.paperRunId = runId;
      // Log the simulation result for debugging.  In a future
      // enhancement this data could be persisted to the DB.
      console.log("[paperExecutionAdapter]", JSON.stringify(result));
      // Mimic the behaviour of simulateBuy() by returning a
      // synthetic txHash.  Downstream code uses the return value as
      // the txHash.  We prefix with "paper:" so any viewers can
      // distinguish it from a real hash.
      return `paper:${runId}`;
    };
  } else {
    execBuy = simulateBuy;           // never liveBuy()
  }

  /* ── config mirroring Sniper ────────────────────── */
  const BASE_MINT        = cfg.buyWithUSDC ? USDC_MINT : (cfg.inputMint || SOL_MINT);
  const LIMIT_USD        = +cfg.targetPriceUSD || null;
  const SNIPE_LAMPORTS   = (+cfg.snipeAmount || +cfg.amountToSpend || 0) *
                           (BASE_MINT === USDC_MINT ? 1e6 : 1e9);
  const ENTRY_THRESHOLD  = (+cfg.entryThreshold >= 1
                              ? +cfg.entryThreshold / 100
                              : +cfg.entryThreshold) || 0.03;
  const VOLUME_THRESHOLD = +cfg.volumeThreshold || 50_000;
  const SLIPPAGE         = +cfg.slippage        || 1.0;
  const MAX_SLIPPAGE     = +cfg.maxSlippage     || 0.15;
  const INTERVAL_MS      = Math.round((+cfg.interval || 30) * 1_000);
  const TAKE_PROFIT      = +cfg.takeProfit      || 0;
  const STOP_LOSS        = +cfg.stopLoss        || 0;
  const MAX_DAILY_SOL    = +cfg.maxDailyVolume  || 9999;
  const MAX_OPEN_TRADES  = +cfg.maxOpenTrades   || 9999;
  const MAX_TRADES       = +cfg.maxTrades       || 9999;
  const HALT_ON_FAILS    = +cfg.haltOnFailures  || 3;

  /* token‑age / mcap gates */
  const MIN_TOKEN_AGE_MIN = cfg.minTokenAgeMinutes != null ? +cfg.minTokenAgeMinutes : null;
  const MAX_TOKEN_AGE_MIN = cfg.maxTokenAgeMinutes != null ? +cfg.maxTokenAgeMinutes : null;
  const MIN_MARKET_CAP    = cfg.minMarketCap != null ? +cfg.minMarketCap : null;
  const MAX_MARKET_CAP    = cfg.maxMarketCap != null ? +cfg.maxMarketCap : null;

  /* UX niceties */
  const COOLDOWN_MS  = cfg.cooldown != null ? +cfg.cooldown * 1000 : 60_000;
  const DELAY_MS     = +cfg.delayBeforeBuyMs      || 0;
  const PRIORITY_FEE = +cfg.priorityFeeLamports   || 0;

  /* safety toggle */
const SAFETY_DISABLED =
  botCfg.safetyEnabled === false ||    // NEW explicit master toggle
  botCfg.disableSafety === true ||     // legacy support
  (botCfg.safetyChecks &&
   Object.keys(botCfg.safetyChecks).length > 0 &&
   Object.values(botCfg.safetyChecks).every(v => v === false));

  /* ── runtime state ───────────────────────────────── */
  const cd         = createCooldown(COOLDOWN_MS);
  const summary    = createSummary("Paper Sniper", log, cfg.userId);
  const snipedMint = new Set();
  let   todaySol   = 0;
  let   trades     = 0;
  let   fails      = 0;

  initTxWatcher("PaperTrader");          // purely for parity (no live txs)

  /* ── TICK LOOP ───────────────────────────────────── */
  async function tick() {
    if (trades >= MAX_TRADES) return;

    const pumpWin = cfg.priceWindow  || "5m";
    const volWin  = cfg.volumeWindow || "1h";

    log("loop", `\n PaperTrader Tick @ ${new Date().toLocaleTimeString()}`);
    lastTickTimestamps[botId] = Date.now();
    log("info", `[CONFIG] DELAY_MS:${DELAY_MS}  PRIORITY_FEE:${PRIORITY_FEE}  MAX_SLIPPAGE:${MAX_SLIPPAGE}`);
    log("info", `[CONFIG] pumpWin:${pumpWin}  volWin:${volWin}`);

    if (fails >= HALT_ON_FAILS) {
      log("error", "🛑 halted (too many errors)");
      await summary.printAndAlert("PaperTrader halted on errors");
      if (runningProcesses[botId]) runningProcesses[botId].finished = true;
      clearInterval(loopHandle);
      return;
    }

    try {
      guards.assertTradeCap(trades, MAX_TRADES);
      guards.assertOpenTradeCap("paperTrader", botId, MAX_OPEN_TRADES);

      /* fetch token list */
      const targets = await resolveTokenFeed("paperTrader", cfg);
      log("info", `Scanning ${targets.length} tokens…`);
      summary.inc("scanned", targets.length);

      for (const mint of targets) {
        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – sniper shutting down");
          log("summary", "✅ Sniper completed (max-trades reached)");
          await summary.printAndAlert("Sniper");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }

        /* cooldown gate */
        const cooldownMs = cd.hit(mint);
        if (cooldownMs > 0) continue;

        /* token‑age gates */
        if (MIN_TOKEN_AGE_MIN || MAX_TOKEN_AGE_MIN) {
          const cData  = await getTokenCreationTime(null, mint);
          const ageMin = cData?.blockUnixTime
            ? Math.floor((Date.now()/1e3 - cData.blockUnixTime) / 60)
            : null;

          if (MIN_TOKEN_AGE_MIN != null && ageMin < MIN_TOKEN_AGE_MIN) {
            summary.inc("ageSkipped");
            log("warn", `Age ${ageMin}m < min — skip`);
            continue;
          }
          if (MAX_TOKEN_AGE_MIN != null && ageMin > MAX_TOKEN_AGE_MIN) {
            summary.inc("ageSkipped");
            log("warn", `Age ${ageMin}m > max — skip`);
            continue;
          }
        }

        /* —— price / volume filter —— */
        log("info", `Token detected: ${mint}`);
        log("info",   "Fetching price change + volume…");

        let res;
        try {
          res = await limitBirdeye(() =>
            passes(mint, {
              entryThreshold     : ENTRY_THRESHOLD,
              volumeThresholdUSD : VOLUME_THRESHOLD,
              pumpWindow         : pumpWin,
              volumeWindow       : volWin,
              limitUsd           : LIMIT_USD,
              minMarketCap       : MIN_MARKET_CAP,
              maxMarketCap       : MAX_MARKET_CAP,
              dipThreshold       : null,
              volumeSpikeMult    : null,
              fetchOverview      : (m) =>
                getTokenShortTermChange(null, m, pumpWin, volWin),
            })
          );
        } catch (err) {
          log("error", `🔥 passes() crashed: ${err.stack || err}`);
          summary.inc("passesError");
          continue;
        }

        if (!res?.ok) {
          log("warn", explainFilterFail(
            {
              reason: res.reason,
              pct   : res.pct,
              vol   : res.vol,
              price : res.overview?.price,
              mcap  : res.overview?.marketCap
            },
            {
              entryTh     : ENTRY_THRESHOLD,
              pumpWin,
              volTh       : VOLUME_THRESHOLD,
              volWin,
              limitUsd    : LIMIT_USD,
              minMarketCap    : MIN_MARKET_CAP,
              maxMarketCap    : MAX_MARKET_CAP,
              dipThreshold: null,
              recoveryWindow: pumpWin,
              volumeSpikeMult: null
            }
          ));
          summary.inc(res.reason || "filterFail");
          continue;
        }

        const overview = res.overview;
        log("info", "✅ Passed price/volume/mcap checks");
        log("info", `[🎯 TARGET FOUND] ${mint}`);
        summary.inc("filters");

        /* —— safety checks —— */
        if (!SAFETY_DISABLED) {
          const safeRes = await isSafeToBuyDetailed(mint, cfg.safetyChecks || {});
          if (logSafetyResults(mint, safeRes, log, "paperTrader")) {
            summary.inc("safetyFail");
            continue;
          }
          summary.inc("safety");
        } else {log("info", "⚠️ Safety checks DISABLED – proceeding un‑vetted");}

        /* daily cap */
        guards.assertDailyLimit(SNIPE_LAMPORTS / 1e9, todaySol, MAX_DAILY_SOL);

        /* —— quote —— */
        log("info", "Getting swap quote…");
        let quote;
        try {log("info",
            `🔍 getSafeQuote — in:${BASE_MINT}, out:${mint}, amt:${SNIPE_LAMPORTS}, slip:${SLIPPAGE}, impact max:${MAX_SLIPPAGE}`
          );
          const resQ = await getSafeQuote({
            inputMint    : BASE_MINT,
            outputMint   : mint,
            amount       : SNIPE_LAMPORTS,
            slippage     : SLIPPAGE,
            maxImpactPct : MAX_SLIPPAGE,
          });
          if (!resQ.ok) {
            log("warn", `❌ Quote failed (${resQ.reason}) — ${resQ.message}`);
            summary.inc(resQ.reason || "quoteFail");
            continue;
          }
          quote = resQ.quote;
        } catch (err) {
          log("error", `❌ getSafeQuote() threw: ${err.message}`);
          summary.inc("quoteException");
          continue;
        }

        if (PRIORITY_FEE > 0) {
          quote.prioritizationFeeLamports = PRIORITY_FEE;
          log("info", `Adding priority fee of ${PRIORITY_FEE} lamports`);
        }

        quote.priceImpactPct = Number(quote.priceImpactPct);
        log("info", `Quote received – impact ${(quote.priceImpactPct * 100).toFixed(2)}%`);

        log("info",
          `[🐛 TP/SL DEBUG] tp=${cfg.takeProfit ?? "null"}, sl=${cfg.stopLoss ?? "null"}, ` +
          `tpPercent=${cfg.tpPercent ?? "null"}, slPercent=${cfg.slPercent ?? "null"}`
        );

        /* —— meta build & buy attempt —— */
        const meta = {
          strategy   : "Paper Trader",
          walletId   : cfg.walletId,
          userId     : cfg.userId,
          slippage   : SLIPPAGE,
          category   : "PaperTrader",
          tpPercent  : cfg.tpPercent ?? TAKE_PROFIT,
          slPercent  : cfg.slPercent ?? STOP_LOSS,
        };

        try {
          if (snipedMint.has(mint)) {
            log("warn", `⚠️ Already sniped ${mint} — skipping dup`);
            continue;
          }
          snipedMint.add(mint);
         let txHash;

                   // txHash = await execBuy({ quote, wallet, mint, meta });
          txHash = await execBuy({ quote, mint, meta });
          console.log("🎯 execBuy returned:", txHash);
        } catch (err) {
          const errMsg = err?.message || JSON.stringify(err) || String(err);

          // Log to structured logs
          log("error", "❌ execBuy failed:");
          log("error", errMsg);
          log("error", `❌ execBuy failed: ${err.message}`);
          summary.inc("execBuyFail");
          continue;
        }
        log("info", `[🎆 SIMULATED BUY] ${mint}`);


        /* stats banner */
        const volKey   = `volume${cfg.volumeWindow || "1h"}`;
        const stats    =
          `[STATS] price=${(overview?.price ?? 0).toFixed(6)}, ` +
          `mcap=${(overview?.[volKey] ?? 0).toFixed(0)}, ` +
          `change5m=${((overview?.priceChange5m ?? 0) * 100).toFixed(2)}%`;
        log("info", stats);

        /* bookkeeping */
        todaySol += SNIPE_LAMPORTS / 1e9;
        trades++;
        summary.inc("buys");
        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – sniper shutting down");
          // ✅ print summary first
          await summary.printAndAlert("Sniper");
          // ✅ then mark completion after summary
          log("summary", "✅ Sniper completed (max-trades reached)");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }
        cd.hit(mint);

        if (trades >= MAX_TRADES) break;
      }

      fails = 0;                      // reset error streak
    } catch (err) {
     /* otherwise count the failure and let the normal
         HALT_ON_FAILS logic decide */
      fails++;
          if (fails >= HALT_ON_FAILS) {
          log("error", "🛑 Error limit hit — sniper shutting down");
          await summary.printAndAlert("Sniper halted on errors");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          return;                       // bail out cleanly
        }
          summary.inc("errors");
          log("error", err?.message || String(err));
            await tradeExecuted({
              userId     : cfg.userId,
              mint,
              tx         : txHash,
              wl         : cfg.walletLabel || "default",
              category   : "PaperTrader",
              simulated  : DRY_RUN,
              amountFmt  : `${(SNIPE_LAMPORTS / 1e9).toFixed(3)} ${BASE_MINT === SOL_MINT ? "SOL" : "USDC"}`,
              impactPct  : (quote?.priceImpactPct || 0) * 100,
            });
        }

  } /* end tick */

  /* banner */
  const feedName = cfg.overrideMonitored
    ? "custom token list (override)"
    : (cfg.tokenFeed || "new listings");
  log("info", `Token feed in use → ${feedName}`);

  /* scheduler */
  const loopHandle = runLoop(
    tick,
    cfg.loop === false ? 0 : INTERVAL_MS,
    { label: "paperTrader", botId }
  );
};

/* CLI helper (dev only) */
if (require.main === module) {
  const fp = process.argv[2];
  if (!fp || !fs.existsSync(fp)) {
    console.error("❌ Pass config JSON path");
    process.exit(1);
  }
  module.exports(JSON.parse(fs.readFileSync(fp, "utf8")));
}