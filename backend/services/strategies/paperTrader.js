/* backend/services/strategies/paperTrader.js
   ───────────────────────────────────────────
   Paper Trader — Sniper-parity, permanent dry-run

   • Runs identical filters, safety checks, quotes & logs as Sniper
   • Forces dryRun → simulateBuy() from tradeExecutorSniper
   • Trades logged like real ones with strategy:"Paper Trader"
   • Smart-Exit watcher is booted and performs simulated SELLs only
*/

"use strict";

const fs            = require("fs");
const pLimit        = require("p-limit");
const { v4: uuid }  = require("uuid");
const prisma        = require("../../prisma/prisma");

/* paid API helpers */
const getTokenShortTermChange = require("./paid_api/getTokenShortTermChanges");
const getTokenCreationTime    = require("./paid_api/getTokenCreationTime");
const resolveTokenFeed        = require("./paid_api/tokenFeedResolver");
const { getPriceAndLiquidity }= require("./paid_api/getTokenPrice");

/* safety + logging */
const { isSafeToBuyDetailed }  = require("../utils/safety/safetyCheckers/botIsSafeToBuy");
const { logSafetyResults }     = require("./logging/logSafetyResults");
const { strategyLog }          = require("./logging/strategyLogger");
const { lastTickTimestamps, runningProcesses } =
  require("../utils/strategy_utils/activeStrategyTracker");

/* core helpers (mirror Sniper) */
const wm                       = require("./core/walletManager");
const guards                   = require("./core/tradeGuards");
const createCooldown           = require("./core/cooldown");
const { getSafeQuote }         = require("./core/quoteHelper");
const { passes, explainFilterFail } = require("./core/passes");
const { createSummary, tradeExecuted } = require("./core/alerts");
const runLoop                  = require("./core/loopDriver");
const { initTxWatcher }        = require("./core/txTracker");

/* execution:
 * - use Sniper's executor so FE/DB/watchers behave identically
 * - OPTIONAL paper execution adapter to pre-simulate fills/slippage/etc.
 */
const { simulateBuy: simulateBuySniper } = require("./core/tradeExecutorSniper");
const { executePaperTrade }              = require("./core/paperTrader/paperExecutionAdapter");

/* misc */
const { getWalletBalance, isAboveMinBalance } = require("../utils");

/* constants */
const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

module.exports = async function paperTrader(cfg = {}) {
  console.log("🚀 paperTrader loaded", cfg);

  const limitBirdeye = pLimit(2);
  const botId = cfg.botId || "paperTrader";
  const log   = strategyLog("paperTrader", botId, cfg);

  /* ── permanent dry-run ───────────────────────────── */
  cfg.dryRun = true; // critical: informs executor & watcher

  /* ── config parity with Sniper ───────────────────── */
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
  const DELAY_MS         = +cfg.delayBeforeBuyMs || 0;
  const PRIORITY_FEE     = +cfg.priorityFeeLamports || 0;
  const MIN_POOL_USD     = cfg.minPoolUsd != null ? +cfg.minPoolUsd : 50_000;

  /* safety toggle (parity with Sniper) */
  const SAFETY_DISABLED =
    cfg.safetyEnabled === false ||
    cfg.disableSafety  === true  ||
    (cfg.safetyChecks &&
     Object.keys(cfg.safetyChecks).length > 0 &&
     Object.values(cfg.safetyChecks).every(v => v === false));

  /* exec model (optional simulation enhancer before DB persist) */
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
    // Pre-simulate fills/slippage/latency; then persist via Sniper's simulateBuy
    execBuy = async ({ quote, mint, meta }) => {
      const runId = cfg.paperRunId || uuid();
      const sim = await executePaperTrade({ quote, mint, meta, config: paperParams });
      const adjusted = { ...quote };
      if (sim && Array.isArray(sim.fills) && sim.fills.length > 0) {
        const avgSlipPct = (Number(sim.slippage_bps || 0) / 10_000);
        adjusted.outAmount = String(Math.floor(Number(quote.outAmount) / (1 + avgSlipPct)));
        adjusted._paperLatencyMs = sim.latency_ms;
        adjusted._paperModel = String(paperParams.execModel || "ideal");
      }
      const tx = await simulateBuySniper({ quote: adjusted, mint, meta });
      console.log("[paperExecutionAdapter->Sniper.simulateBuy] tx:", tx);
      return `paper:${runId}`;
    };
  } else {
    // “ideal” model = straight Sniper simulateBuy (DB+watcher parity)
    execBuy = simulateBuySniper;
  }

  /* runtime */
  const cd         = createCooldown(cfg.cooldown != null ? +cfg.cooldown * 1000 : 60_000);
  const summary    = createSummary("Paper Trader", log, cfg.userId);
  const snipedMint = new Set();
  let   todaySol   = 0;
  let   trades     = 0;
  let   fails      = 0;

  initTxWatcher("PaperTrader"); // parity; no live tx expected

  async function tick() {
    if (trades >= MAX_TRADES) return;

    const pumpWin = cfg.priceWindow  || "5m";
    const volWin  = cfg.volumeWindow || "1h";

    log("loop", `\n PaperTrader Tick @ ${new Date().toLocaleTimeString()}`);
    lastTickTimestamps[botId] = Date.now();
    log("info", `[CONFIG] DELAY_MS:${DELAY_MS} PRIORITY_FEE:${PRIORITY_FEE} MAX_SLIPPAGE:${MAX_SLIPPAGE}`);
    log("info", `[CONFIG] pumpWin:${pumpWin} volWin:${volWin}`);

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

      // (optional) minimal balance check parity — not strictly needed for dry-run,
      // but harmless and keeps logs aligned with Sniper
      try { await wm.initWalletFromDb(cfg.userId, cfg.walletId); } catch {}
      if (!(await wm.ensureMinBalance(0.01, getWalletBalance, isAboveMinBalance))) {
        log("warn", "Balance below min (soft check) – continuing (paper)");
      }

      /* fetch token list */
      const targets = await resolveTokenFeed("paperTrader", cfg);
      summary.inc("scanned", targets.length);
      log("info", `Scanning ${targets.length} tokens…`);

      for (const mint of targets) {
        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – paperTrader shutting down");
          log("summary", "✅ PaperTrader completed (max-trades reached)");
          await summary.printAndAlert("PaperTrader");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }

        /* cooldown */
        if (cd.hit(mint) > 0) continue;

        /* token-age limits (min/max) */
        const minAge = cfg.minTokenAgeMinutes != null ? +cfg.minTokenAgeMinutes : null;
        const maxAge = cfg.maxTokenAgeMinutes != null ? +cfg.maxTokenAgeMinutes : null;
        if (minAge != null || maxAge != null) {
          const createdAtUnix = await getTokenCreationTime(mint, cfg.userId);
          const ageMin = createdAtUnix
            ? Math.floor((Date.now()/1e3 - createdAtUnix) / 60)
            : null;
          if (minAge != null && ageMin != null && ageMin < minAge) {
            summary.inc("ageSkipped");
            log("warn", `Age ${ageMin}m < min — skip`);
            continue;
          }
          if (maxAge != null && ageMin != null && ageMin > maxAge) {
            summary.inc("ageSkipped");
            log("warn", `Age ${ageMin}m > max — skip`);
            continue;
          }
        }

        /* price/volume/mcap filters */
        log("info", `Token detected: ${mint}`);
        log("info", "Fetching price change + volume…");

        let res;
        try {
          res = await limitBirdeye(() =>
            passes(mint, {
              entryThreshold     : ENTRY_THRESHOLD,
              volumeThresholdUSD : VOLUME_THRESHOLD,
              pumpWindow         : pumpWin,
              volumeWindow       : volWin,
              limitUsd           : LIMIT_USD,
              minMarketCap       : cfg.minMarketCap != null ? +cfg.minMarketCap : null,
              maxMarketCap       : cfg.maxMarketCap != null ? +cfg.maxMarketCap : null,
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
              minMarketCap: cfg.minMarketCap != null ? +cfg.minMarketCap : null,
              maxMarketCap: cfg.maxMarketCap != null ? +cfg.maxMarketCap : null,
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

        /* liquidity check (parity with Sniper) */
        try {
          const { liquidity = 0 } = await getPriceAndLiquidity(cfg.userId, mint);
          const liqNum = Number(liquidity);
          if (Number.isFinite(liqNum)) {
            if (liqNum >= MIN_POOL_USD) {
              log("info", `Liquidity: $${liqNum.toFixed(0)} >= $${MIN_POOL_USD.toFixed(0)} ✅ PASS`);
            } else {
              log("warn", `Liquidity: $${liqNum.toFixed(0)} < $${MIN_POOL_USD.toFixed(0)} ❌ FAIL — skip`);
              summary.inc("liqSkipped");
              continue;
            }
          } else {
            log("warn", "⚠️ Liquidity non-finite — skip");
            summary.inc("liqCheckFail");
            continue;
          }
        } catch (e) {
          log("warn", `⚠️ Liquidity check failed (${e.message}) — skip`);
          summary.inc("liqCheckFail");
          continue;
        }

        log("info", `[🎯 TARGET FOUND] ${mint}`);
        summary.inc("filters");

        /* safety checks (if enabled) */
        if (!SAFETY_DISABLED) {
          const safeRes = await isSafeToBuyDetailed(mint, cfg.safetyChecks || {});
          if (logSafetyResults(mint, safeRes, log, "paperTrader")) {
            summary.inc("safetyFail");
            continue;
          }
          summary.inc("safety");
        } else {
          log("info", "⚠️ Safety checks DISABLED – proceeding un-vetted (paper)");
        }

        /* daily SOL cap (by config) */
        guards.assertDailyLimit(SNIPE_LAMPORTS / 1e9, todaySol, MAX_DAILY_SOL);

        /* quote */
        log("info", "Getting swap quote…");
        let quote;
        try {
          log("info",
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

        /* meta (IMPORTANT: keep strategy label = "Paper Trader") */
        const meta = {
          strategy        : "Paper Trader",      // ← stays "Paper Trader"
          category        : "PaperTrader",
          walletId        : cfg.walletId,
          userId          : cfg.userId,
          slippage        : SLIPPAGE,
          tpPercent       : cfg.tpPercent ?? TAKE_PROFIT,
          slPercent       : cfg.slPercent ?? STOP_LOSS,
          dryRun          : true,                // ← informs executor + watcher
          // so charts can exclude paper rows; also helps UI filters
          openTradeExtras : { strategy: "paperTrader", isPaper: true, simulated: true },
          // smart-exit parity
          ...(cfg.smartExitMode ? { smartExitMode: String(cfg.smartExitMode).toLowerCase() } : {}),
          ...(cfg.smartExit     ? { smartExit: cfg.smartExit } : {}),
          ...(cfg.postBuyWatch  ? { postBuyWatch: cfg.postBuyWatch } : {}),
          // optional idempotency knobs pass-through (if you use them)
          ...(cfg.idempotencyKey   ? { idempotencyKey: cfg.idempotencyKey } : {}),
          ...(cfg.idempotencyTtlMs ? { idempotencyTtlMs: cfg.idempotencyTtlMs } : {}),
          // rpc pool (optional; executor understands these)
          ...(cfg.rpcEndpoints ? { rpcEndpoints: cfg.rpcEndpoints } : {}),
          ...(cfg.rpcQuorum    ? { rpcQuorum: cfg.rpcQuorum } : {}),
          ...(cfg.rpcMaxFanout ? { rpcMaxFanout: cfg.rpcMaxFanout } : {}),
          ...(cfg.rpcStaggerMs ? { rpcStaggerMs: cfg.rpcStaggerMs } : {}),
          ...(cfg.rpcTimeoutMs ? { rpcTimeoutMs: cfg.rpcTimeoutMs } : {}),
        };

        /* execute (dry-run) via Sniper executor */
        try {
          if (snipedMint.has(mint)) {
            log("warn", `⚠️ Already sniped ${mint} — skipping dup`);
            continue;
          }
          snipedMint.add(mint);

          const txHash = await execBuy({ quote, mint, meta });
          console.log("🎯 execBuy (paper) returned:", txHash);
        } catch (err) {
          const errMsg = err?.message || JSON.stringify(err) || String(err);
          log("error", "❌ execBuy failed:");
          log("error", errMsg);
          summary.inc("execBuyFail");
          continue;
        }

        log("info", `[🎆 SIMULATED BUY] ${mint}`);

        /* stats banner */
        const volKey = `volume${cfg.volumeWindow || "1h"}`;
        log("info",
          `[STATS] price=${(overview?.price ?? 0).toFixed(6)}, ` +
          `mcap=${(overview?.[volKey] ?? 0).toFixed(0)}, ` +
          `change5m=${((overview?.priceChange5m ?? 0) * 100).toFixed(2)}%`
        );

        /* bookkeeping */
        todaySol += SNIPE_LAMPORTS / 1e9;
        trades++;
        summary.inc("buys");

        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – paperTrader shutting down");
          await summary.printAndAlert("PaperTrader");
          log("summary", "✅ PaperTrader completed (max-trades reached)");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }

        cd.hit(mint); // start cooldown
        if (trades >= MAX_TRADES) break;
      }

      fails = 0;
    } catch (err) {
      fails++;
      if (fails >= HALT_ON_FAILS) {
        log("error", "🛑 Error limit hit — paperTrader shutting down");
        await summary.printAndAlert("PaperTrader halted on errors");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        return;
      }
      summary.inc("errors");
      log("error", err?.message || String(err));
    }

    if (trades >= MAX_TRADES) {
      await summary.printAndAlert("PaperTrader");
      log("summary", "✅ PaperTrader completed (max-trades reached)");
      if (runningProcesses[botId]) runningProcesses[botId].finished = true;
      clearInterval(loopHandle);
      process.exit(0);
    }
  }

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
