/** Breakout Strategy Module 
 * - Monitors token price and volume spikes. 
 * - Detects breakout opportunities using thresholds.
 * - Executes swap when breakout conditions are met. 
 * 
 * Configurable: 
 * - Token list to monitor
 * - Price threshold (% increase)
 * - Volume threshold
 * 
 * Eventually Support: 
 * - Timeframe-based candles (e.g. 1m/5m)
 * - Telegram alerts
 * - Multi-token monitoring via dynamic feeds. 
 */


/** Breakout Strategy Module 
 * - Monitors tokens for % price increase + volume spike.
 * - Enters position on breakout signal.
 * 
 * Includes:
 * - Token list config
 * - Honeypot protection
 * - Telegram alerts
 * - Analytics logging
 * - Wallet rotation
 * 
 * 
 *  * Finalized:
 * ✅ Runtime config: mint list, thresholds, wallet, volume
 * ✅ Honeypot + slippage protection
 * ✅ DRY_RUN + max volume cap
 * ✅ Telegram alerts + cooldowns
 * ✅ Unified logging via handleSuccessTrade
 */

// backend/services/strategies/breakout.js
/* Breakout Strategy – refactored to use core helpers */

/* Breakout Strategy – refactored to shared helper stack */
/* backend/services/strategies/breakout.js
 * ──────────────────────────────────────── */

/* Breakout v2 – parity-upgraded (Sniper/DipBuyer style) */
const fs = require("fs");
// const pLimit = require("p-limit");
// const limitBirdeye = pLimit(2);   // 2 concurrent
const pLimit = require("p-limit");
const prisma = require("../../prisma/prisma");
const { v4: uuid } = require("uuid");
/* paid API helpers */
const getTokenShortTermChange = require("./paid_api/getTokenShortTermChanges");
const getTokenCreationTime    = require("./paid_api/getTokenCreationTime");
const resolveTokenFeed        = require("./paid_api/tokenFeedResolver");

/* safety + logging */
const { isSafeToBuyDetailed } = require("../utils/safety/safetyCheckers/botIsSafeToBuy");
const { logSafetyResults }    = require("./logging/logSafetyResults");
const { strategyLog }         = require("./logging/strategyLogger");
const { lastTickTimestamps, runningProcesses }
      = require("../utils/strategy_utils/activeStrategyTracker");

/* ── core helpers ─────────────────────────────────────── */
const wm                       = require("./core/walletManager");
const guards                   = require("./core/tradeGuards");
const createCooldown           = require("./core/cooldown");
const { getSafeQuote } = require("./core/quoteHelper");
const { liveBuy, simulateBuy } = require("./core/tradeExecutor");
const { passes, explainFilterFail }               = require("./core/passes");
const { createSummary, tradeExecuted }        = require("./core/alerts");
const runLoop                  = require("./core/loopDriver");
const { initTxWatcher }        = require("./core/txTracker");

/* misc utils still needed directly */
const {
  getWalletBalance,
  isAboveMinBalance,
} = require("../utils");
const registerTpSl       = require("./core/tpSlRegistry");
/* constants */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT  = "So11111111111111111111111111111111111111112";

/* ──────────────────────────────────────────────────── */
module.exports = async function breakoutStrategy(botCfg = {}) {
  const limitBirdeye = pLimit(2);
  const botId = botCfg.botId || "manual";
  const log   = strategyLog("breakout", botId, botCfg);

  /* ── config ─────────────────────────────────────────── */
  const BASE_MINT        = botCfg.buyWithUSDC ? USDC_MINT : (botCfg.inputMint || SOL_MINT);
  const LIMIT_USD        = +botCfg.targetPriceUSD || null;
  const SNIPE_LAMPORTS   = (+botCfg.snipeAmount || +botCfg.amountToSpend || 0) *
                           (BASE_MINT === USDC_MINT ? 1e6 : 1e9);
  const ENTRY_THRESHOLD  = (+botCfg.entryThreshold >= 1
                              ? +botCfg.entryThreshold / 100
                              : +botCfg.entryThreshold) || 0.03;
  const VOLUME_THRESHOLD = +botCfg.volumeThreshold || 50_000;
  const SLIPPAGE         = +botCfg.slippage        || 1.0;
  const MAX_SLIPPAGE     = +botCfg.maxSlippage     || 0.15;
  const INTERVAL_MS      = Math.round((+botCfg.interval || 30) * 1_000);
  const TAKE_PROFIT      = +botCfg.takeProfit      || 0;
  const STOP_LOSS        = +botCfg.stopLoss        || 0;
  const MAX_DAILY_SOL    = +botCfg.maxDailyVolume  || 9999;
  const MAX_OPEN_TRADES  = +botCfg.maxOpenTrades   || 9999;
  const MAX_TRADES       = +botCfg.maxTrades       || 9999;
  const HALT_ON_FAILS    = +botCfg.haltOnFailures  || 3;
  const MIN_BALANCE_SOL = 0.05; 
  const MAX_TOKEN_AGE_MIN= botCfg.maxTokenAgeMinutes != null
                              ? +botCfg.maxTokenAgeMinutes
                              : null;
const MIN_TOKEN_AGE_MIN= botCfg.minTokenAgeMinutes != null
                              ? +botCfg.minTokenAgeMinutes
                              : null;
                              
                              
  const MIN_MARKET_CAP   = botCfg.minMarketCap != null ? +botCfg.minMarketCap : null;
  const MAX_MARKET_CAP   = botCfg.maxMarketCap != null ? +botCfg.maxMarketCap : null;
  const DRY_RUN          = botCfg.dryRun === true;
  const execBuy = DRY_RUN ? simulateBuy : liveBuy;
  const COOLDOWN_MS    = botCfg.cooldown != null
    ? +botCfg.cooldown * 1000            // UI sends SECONDS
    : 60_000;                            // fallback: 60 000 ms 
    
    // ── universal mode extensions ─────────────────────────
    const DIP_THRESHOLD = +botCfg.dipThreshold || 0;  // < 0 triggers dip mode
    const dipMode = DIP_THRESHOLD > 0;
;

    const DELAY_MS = +botCfg.delayBeforeBuyMs || 0;
    const PRIORITY_FEE = +botCfg.priorityFeeLamports || 0;

    const VOLUME_SPIKE = +botCfg.volumeSpikeMult || 0;

  /* safety toggle */
  const SAFETY_DISABLED =
    botCfg.disableSafety === true ||
    (botCfg.safetyChecks && Object.values(botCfg.safetyChecks).every(v => v === false));

  const snipedMints = new Set();

  /* ── bootstrap ─────────────────────────────────────── */
  log("info", `🔗 Loading single wallet from DB (walletId: ${botCfg.walletId})`);
  await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
  const cd        = createCooldown(COOLDOWN_MS);
  const summary   = createSummary("Breakout", log, botCfg.userId);
  let   todaySol  = 0;
  let   trades    = 0;
  let   fails     = 0;
  /* start background confirmation loop (non-blocking) */
  initTxWatcher("Breakout");




  /* ── tick ─────────────────────────────────────────── */
  async function tick() {
    if (trades >= MAX_TRADES) return;
    const pumpWin = botCfg.priceWindow  || "5m";
    const volWin  = botCfg.volumeWindow || "1h";
    
    log("loop", `\nBreakout Tick @ ${new Date().toLocaleTimeString()}`);
    lastTickTimestamps[botId] = Date.now();

    /* NEW: stop instantly if we already blew past the fail cap */
    if (fails >= HALT_ON_FAILS) {
      log("error", "🛑 halted (too many errors)");
      await summary.printAndAlert("Breakout halted on errors");
      if (runningProcesses[botId]) runningProcesses[botId].finished = true;
      clearInterval(loopHandle);
      return;
    }

    try {
      guards.assertTradeCap(trades, MAX_TRADES);
      guards.assertOpenTradeCap("Breakout", botId, MAX_OPEN_TRADES);

        await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
        if (!(await wm.ensureMinBalance(MIN_BALANCE_SOL, getWalletBalance, isAboveMinBalance))) {
          log("warn", "Balance below min – skipping");
          return;
        }



      /* fetch token list via resolver */
      const targets = await resolveTokenFeed("Breakout", botCfg);
      summary.inc("scanned", targets.length);
      log("info", `Scanning ${targets.length} tokens…`);
      for (const mint of targets) {
        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – breakout shutting down");
          log("summary", "✅ Breakout completed (max-trades reached)");
          await summary.printAndAlert("Breakout");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }

        const cooldownMs = cd.hit(mint);
        if (cooldownMs > 0) {
          // log("info", `⏳ Skipping ${mint}, still in cooldown for ${(cooldownMs / 1000).toFixed(0)}s`);
          continue;
        }
        

        log("info", `Token detected: ${mint}`);
        log("info", "Fetching price change + volume…");

        const pumpWin = botCfg.priceWindow  || "30m";
        const volWin  = botCfg.volumeWindow || "1h";

     const res = await limitBirdeye(() =>
       passes(mint, {
      entryThreshold     : ENTRY_THRESHOLD,
      volumeThresholdUSD : VOLUME_THRESHOLD,
      pumpWindow         : pumpWin,
      volumeWindow       : volWin,
      limitUsd           : LIMIT_USD,
      minMarketCap       : MIN_MARKET_CAP,
      maxMarketCap       : MAX_MARKET_CAP,
      fetchOverview: (mint) =>
      getTokenShortTermChange(null, mint, pumpWin, volWin),
    }));


        if (!res.ok) {
          log("warn", explainFilterFail(res, { 
            avg: res.avg, 
            entryTh: ENTRY_THRESHOLD, pumpWin,
            volTh: VOLUME_THRESHOLD, volWin,
            minMarketCap: MIN_MARKET_CAP, maxMarketCap: MAX_MARKET_CAP,
            volumeSpikeMult: VOLUME_SPIKE,
          }));
          summary.inc(res.reason || "filterFail");
          continue;
        }

     const overview = res.overview;
    log("info", "Passed price/volume check");
    log("info", `[🎯 TARGET FOUND] ${mint}`);
    summary.inc("filters");
        /* safety checks */
        if (!SAFETY_DISABLED) {
           const safeRes = await isSafeToBuyDetailed(mint, botCfg.safetyChecks || {});
           if (logSafetyResults(mint, safeRes, log, "breakout")) {
             summary.inc("safetyFail");
             continue;
           }
           summary.inc("safety");
       } else {
          log("info", "⚠️ Safety checks DISABLED – proceeding un-vetted");
         }

        /* daily cap */
        guards.assertDailyLimit(SNIPE_LAMPORTS / 1e9, todaySol, MAX_DAILY_SOL);


        /* quote */
        log("info", "Getting swap quote…");
        let quote;
        try {
          log("info", `🔍 Calling getSafeQuote — in: ${BASE_MINT}, out: ${mint}, amt: ${SNIPE_LAMPORTS}, slip: ${SLIPPAGE}, impact max: ${MAX_SLIPPAGE}`);
          const result = await getSafeQuote({
            inputMint    : BASE_MINT,
            outputMint   : mint,
            amount       : SNIPE_LAMPORTS,
            slippage     : SLIPPAGE,
            maxImpactPct : MAX_SLIPPAGE,
          });

        if (!result.ok) {
          const {
            reason = "quoteFail",
            message = "no message",
            inputMint,
            outputMint,
            rawQuote,
            quoteDebug
          } = result;

                  log("warn", `❌ Quote failed: ${reason.toUpperCase()} — ${message}`);
          log("warn", `↳ Input: ${inputMint}`);
          log("warn", `↳ Output: ${outputMint}`);
          if (quoteDebug) log("warn", `↳ Debug: ${JSON.stringify(quoteDebug, null, 2)}`);
          if (rawQuote) log("warn", `↳ Raw Quote: ${JSON.stringify(rawQuote, null, 2)}`);
          
          summary.inc(reason);
          continue;
        }
          quote = result.quote;

        } catch (err) {
          log("error", `❌ getSafeQuote() threw: ${err.message}`);
          summary.inc("quoteException");
          continue;
        }



        // chad mode (priority fee)
        if (PRIORITY_FEE > 0) {
          quote.prioritizationFeeLamports = PRIORITY_FEE;
          log("info", `Adding priority fee of ${PRIORITY_FEE} lamports`);
        }
               
        log("info", `Quote impact ${(quote.priceImpactPct * 100).toFixed(2)} %`);
        log("info", "[🚀 BUY ATTEMPT] Executing breakout buy…");

        /* build meta */
        const meta = {
          strategy        : "Breakout",
          walletId        : botCfg.walletId,
          // publicKey: wallet?.publicKey || null, 
          userId          : botCfg.userId,
          slippage        : SLIPPAGE,
          category        : "Breakout",
          tpPercent       : botCfg.tpPercent ?? TAKE_PROFIT,
          slPercent       : botCfg.slPercent ?? STOP_LOSS,
          tp: botCfg.takeProfit,  
          sl: botCfg.stopLoss,
          openTradeExtras : { strategy: "breakout" },
        };

        /* 3️⃣  execute (or simulate) the buy */
        // const execFn  = DRY_RUN ? simulateBuy : liveBuy;
        let txHash;
        try {
          console.log("🔁 Sending to execBuy now…");


          if (snipedMints.has(mint)) {
        log("warn", `⚠️ Already executed breakout ${mint} — skipping duplicate`);
        continue;
      }
      snipedMints.add(mint);

          // txHash = await execBuy({ quote, wallet, mint, meta });
          txHash = await execBuy({ quote, mint, meta });
          console.log("🎯 execBuy returned:", txHash);
        } catch (err) {
          const errMsg = err?.message || JSON.stringify(err) || String(err);

          // Log to structured logs
          log("error", "❌ execBuy failed:");
          log("error", errMsg);

          // Print directly to user terminal
          console.error("❌ execBuy FAILED [UX]:", errMsg);

          // Print error object raw (only in terminal)
          console.error("🪵 Full error object:", err);

          summary.inc("execBuyFail");
          continue;
        }

        const buyMsg  = DRY_RUN
          ? `[🎆 BOUGHT SUCCESS] ${mint}`
          : `[🎆 BOUGHT SUCCESS] ${mint} Tx: https://solscan.io/tx/${txHash}`;
        log("info", buyMsg);

        /* console stats banner ─ same as legacy */
        const volKey   = `volume${botCfg.volumeWindow || "1h"}`;
        const statsLine =
          `[STATS] price=${(overview?.price ?? 0).toFixed(6)}, ` +
          `mcap=${(overview?.[volKey] ?? 0).toFixed(0)}, ` +
          `change5m=${((overview?.priceChange5m ?? 0) * 100).toFixed(2)}%`;
        log("info", statsLine);


     /* bookkeeping */
        /* 📍 Inside the token loop, after bookkeeping */
        todaySol += SNIPE_LAMPORTS / 1e9;
        trades++;
        summary.inc("buys");


        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – breakout shutting down");
          // ✅ print summary first
          await summary.printAndAlert("Breakout");
          // ✅ then mark completion after summary
          log("summary", "✅ Breakout completed (max-trades reached)");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }
        cd.hit(mint);                         // start cooldown

        /* stop if trade cap hit mid-loop */
        if (trades >= MAX_TRADES) break;
      }


            fails = 0;                                        // reset error streak
              /* 📍 End of tick() */
              } catch (err) {
                   /* ────────────────────────────────────────────────
       * Hard-stop if the RPC or swap returns an
       * “insufficient lamports / balance” error.
       * This skips the normal retry counter and
       * shuts the bot down immediately.
       * ──────────────────────────────────────────────── */
      if (/insufficient.*lamports|insufficient.*balance/i.test(err.message)) {
        log("error", "🛑 Not enough SOL – breakout shutting down");
        await summary.printAndAlert("Breakout halted: insufficient SOL");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        return;                // <── bail right here
      }

     /* otherwise count the failure and let the normal
         HALT_ON_FAILS logic decide */
      fails++;
          if (fails >= HALT_ON_FAILS) {
          log("error", "🛑 Error limit hit — breakout shutting down");
          await summary.printAndAlert("Breakout halted on errors");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          return;                       // bail out cleanly
        }
          summary.inc("errors");
          log("error", err?.message || String(err));
            await tradeExecuted({
              userId     : botCfg.userId,
              mint,
              tx         : txHash,
              wl         : botCfg.walletLabel || "default",
              category   : "Breakout",
              simulated  : DRY_RUN,
              amountFmt  : `${(SNIPE_LAMPORTS / 1e9).toFixed(3)} ${BASE_MINT === SOL_MINT ? "SOL" : "USDC"}`,
              impactPct  : (quote?.priceImpactPct || 0) * 100,
            });
        }

        /* early-exit outside the for-loop */
        if (trades >= MAX_TRADES) {
          // ✅ summary before completion flag
          await summary.printAndAlert("Breakout");
          log("summary", "✅ Breakout completed (max-trades reached)");

          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }
  }

  // ── token-feed banner ───────────────────────────────
const feedName = botCfg.overrideMonitored
  ? "custom token list (override)"
  : (botCfg.tokenFeed || "new listings");   // falls back to breakout default
log("info", `Token feed in use → ${feedName}`);

  /* scheduler */
  const loopHandle = runLoop(tick, botCfg.loop === false ? 0 : INTERVAL_MS, {
    label: "breakout",
    botId,
  });
};

/* ── CLI helper ─────────────────────────────────────── */
if (require.main === module) {
  const fp = process.argv[2];
  if (!fp || !fs.existsSync(fp)) {
    console.error("❌ Pass config JSON path");
    process.exit(1);
  }
  module.exports(JSON.parse(fs.readFileSync(fp, "utf8")));
}

/** 
 * Additions :
 * - Wallet rotation
 * - Honeypot protection
 * - Telegram alerts
 * - Analytics logging
 * - Flexible config via .env
 * - Better price & volume detection falback
 */


/** Additions 04/17 
 * ✅ inputMint, slippage, positionSize, interval	Swap hardcoded .env fallbacks for config
✅ breakoutThreshold	Rename and apply to priceChange check
✅ volumeSpikeMultiplier	Compare current volume to average
✅ confirmationCandles	Stub logic now — future implementation
✅ minLiquidity	Apply to volume threshold
✅ takeProfit, stopLoss	Include in trade log for future exit logic
✅ dryRun, maxDailyVolume, haltOnFailures	Add runtime behavior controls
✅ cooldown	Prevent double-entry too fast
*/

/**
 * Adding volumeSpikeMultiplier
What it does
passes() already receives volumeWindow (e.g., "1h").
volumeSpikeMultiplier compares the current window’s 
volume to the average of the previous N windows (N is whatever your overview endpoint returns;
 Birdeye gives 24 samples for 1-hour windows):
 */