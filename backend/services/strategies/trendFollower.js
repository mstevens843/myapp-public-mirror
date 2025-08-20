/* backend/services/strategies/sniper.js
 * ───────────────────────────────────── */
const fs = require("fs");
const prisma = require("../../prisma/prisma");
const { v4: uuid } = require("uuid");
const pLimit = require("p-limit");
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
// Include extended execution helpers for TWAP and atomic scalping
const {
  liveBuy,
  simulateBuy,
  executeTWAP,
  executeAtomicScalp,
} = require("./core/tradeExecutor");
const { passes, explainFilterFail }               = require("./core/passes");
const { createSummary, tradeExecuted }        = require("./core/alerts");
const runLoop                  = require("./core/loopDriver");
const { initTxWatcher }        = require("./core/txTracker");

/* misc utils still needed directly */
const { getWalletBalance,  isAboveMinBalance, } = require("../utils");

/* constants */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT  = "So11111111111111111111111111111111111111112";

// ----------------------------------------------------------------------
// Extended helper imports (signals + risk)
//
// These optional modules provide stubbed signal generation and risk
// policies for the Trend Follower.  They will only be used when
// enabled via botCfg.useSignals or botCfg.executionShape.
const trendSignals = require("./core/signals/trendFollower");
const trendRisk    = require("./core/risk/trendFollowerPolicy");

module.exports = async function trendFollowerStrategy(botCfg = {}) {
  console.log("🚀 Trend Follower Strategy loaded", botCfg);
  const limitBirdeye = pLimit(2);
  const botId = botCfg.botId || "manual";
  const log   = strategyLog("trendFollower", botId, botCfg);

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
  const DELAY_MS = +botCfg.delayBeforeBuyMs || 0;
  const PRIORITY_FEE = +botCfg.priorityFeeLamports || 0;

  /* ── NEW (add-only): trend-specific knobs ─────────── */
  const emaPeriods      = botCfg.emaPeriods || [10, 30, 60];   // short/med/long
  const trailingPct     = +botCfg.trailingPct || 0.02;         // 2% trail
  const sarEnabled      = botCfg.sarEnabled === true;          // stop-and-reverse
  const pyramidEnabled  = botCfg.pyramidEnabled === true;      // allow adds
  const riskPerAdd      = +botCfg.riskPerAdd || 0.01;          // 1% risk unit
  const maxRisk         = +botCfg.maxRisk   || 0.05;           // 5% cap

  /* ── compatibility aliases for a buggy catch block ── */
  // (These ensure that the existing catch { tradeExecuted({cfg, label, spendLamports …}) }
  // doesn’t throw due to undefined identifiers. No removals.)
  const cfg = botCfg;
  const label = botCfg.walletLabel || "default";
  const spendLamports = SNIPE_LAMPORTS;

  /* safety toggle */
  const SAFETY_DISABLED =
    botCfg.disableSafety === true ||
    (botCfg.safetyChecks && Object.values(botCfg.safetyChecks).every(v => v === false));

  const snipedMints = new Set();
  const cd        = createCooldown(COOLDOWN_MS);
  const summary   = createSummary("trendFollower", log, botCfg.userId);
  let   todaySol  = 0;
  let   trades    = 0;
  let   fails     = 0;
  /* start background confirmation loop (non-blocking) */
  log("info", `🔗 Loading single wallet from DB (walletId: ${botCfg.walletId})`);
  await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
  initTxWatcher("trendFollower");

  /* ── NEW (add-only): position state for SAR/pyramiding ── */
  // track a single open position for simplicity:
  // { mint, direction(1 long / -1 short / 0 flat), entryPrice, highWater, lowWater, currentRisk }
  let openPosition = null;
  let prevDir = 0;

  /* ── tick ──────────────────────────────────────────── */

  async function tick() {
   /* hard-exit quick guard (handle leftover queued ticks) */
   if (trades >= MAX_TRADES) return;         // nothing to do
    const pumpWin = botCfg.priceWindow  || "5m";
    const volWin  = botCfg.volumeWindow || "1h";
    
   log("loop", `\n Trend Follower Tick @ ${new Date().toLocaleTimeString()}`);
   lastTickTimestamps[botId] = Date.now();

   // Optionally precompute trend signals.  Invoking the signal
   // generator synchronously ensures that any thrown errors are
   // caught locally rather than bubbling into the loop.  No cfg is
   // passed to encourage the helper to consult internal caches.
   if (botCfg?.useSignals) {
     try {
       trendSignals({});
     } catch (_) {
       /* suppress errors from the signal generator */
     }
   }
   log("info", `[CONFIG] DELAY_MS: ${DELAY_MS}, PRIORITY_FEE: ${PRIORITY_FEE}, MAX_SLIPPAGE: ${MAX_SLIPPAGE}`);
   log("info", `[CONFIG] pumpWin: ${pumpWin}, volWin: ${volWin}`);

   if (fails >= HALT_ON_FAILS) {
     log("error", "🛑 halted (too many errors)");
     await summary.printAndAlert("trend follower halted on errors");
     if (runningProcesses[botId]) runningProcesses[botId].finished = true;
     clearInterval(loopHandle);
     return;
   }

   try {
      guards.assertTradeCap(trades, MAX_TRADES);
      guards.assertOpenTradeCap("trendFollower", botId, MAX_OPEN_TRADES);

      await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
      if (!(await wm.ensureMinBalance(MIN_BALANCE_SOL, getWalletBalance, isAboveMinBalance))) {
        log("warn", "Balance below min – skipping");
        return;
      }

      /* fetch token list via resolver */
      const targets = await resolveTokenFeed("trendFollower", botCfg);
      log("info", `💡 resolveTokenFeed returned:`, targets);

      summary.inc("scanned", targets.length);
      log("info", `Scanning ${targets.length} tokens…`);
      for (const mint of targets) {
        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – Trend Follower shutting down");
          log("summary", "✅ Trend follower completed (max-trades reached)");
          await summary.printAndAlert("trendFollower");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }

        const cooldownMs = cd.hit(mint);
        if (cooldownMs > 0) {
          // log("info", `⏳ Skipping ${mint}, still in cooldown for ${(cooldownMs / 1000).toFixed(0)}s`);
          continue;
        }

        if (MIN_TOKEN_AGE_MIN != null) {
          const cData = await getTokenCreationTime(null, mint);
          const ageMin = cData?.blockUnixTime
            ? Math.floor((Date.now()/1e3 - cData.blockUnixTime) / 60)
            : null;
          if (ageMin != null && ageMin < MIN_TOKEN_AGE_MIN) {
            summary.inc("ageSkipped");
            log("warn", `Age ${ageMin}m < min – skip`);
            continue;
          }
        }

        /* token-age gate */
        if (MAX_TOKEN_AGE_MIN != null) {
          const cData = await getTokenCreationTime(null, mint);
          const ageMin = cData?.blockUnixTime
            ? Math.floor((Date.now()/1e3 - cData.blockUnixTime) / 60)
            : null;
          if (ageMin != null && ageMin > MAX_TOKEN_AGE_MIN) {
            summary.inc("ageSkipped");
            log("warn", `Age ${ageMin}m > max – skip`);
            continue;
          }
        }

        //  price / volume gate
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
              minMarketCap       : MIN_MARKET_CAP,
              maxMarketCap       : MAX_MARKET_CAP,
              dipThreshold       : null, // 🛡️ safely ignored inside passes
              volumeSpikeMult    : null,  
              fetchOverview      : (mint) =>
                getTokenShortTermChange(null, mint, pumpWin, volWin),
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
              pct: res.pct,
              vol: res.vol,
              price: res.overview?.price,
              mcap: res.overview?.marketCap
            },
            {
              entryTh: ENTRY_THRESHOLD,
              pumpWin,
              volTh: VOLUME_THRESHOLD,
              volWin,
              limitUsd: LIMIT_USD,
              minMarketCap: MIN_MARKET_CAP,
              maxMarketCap: MAX_MARKET_CAP,
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

        /* safety checks */
        if (!SAFETY_DISABLED) {
           const safeRes = await isSafeToBuyDetailed(mint, botCfg.safetyChecks || {});
           if (logSafetyResults(mint, safeRes, log, "trendFollower")) {
             summary.inc("safetyFail");
             continue;
           }
           summary.inc("safety");
        } else {
          log("info", "⚠️ Safety checks DISABLED – proceeding un-vetted");
        }

        /* ── NEW (add-only): multi-timeframe EMA alignment & SAR ── */
        let dir = 0; // 1 = long, -1 = short, 0 = flat/mixed
        try {
          const tfData = await getTokenShortTermChange(null, mint, "30m", volWin);
          let prices = [];
          if (tfData) {
            if (Array.isArray(tfData.prices)) prices = tfData.prices;
            else if (Array.isArray(tfData.candles)) prices = tfData.candles.map(c => +c.close).filter(Boolean);
          }
          if (prices.length >= Math.max(...emaPeriods)) {
            dir = trendSignals.trendAlignment(prices, emaPeriods);
          } else {
            log("info", `Insufficient price history for EMA alignment (${prices.length} < ${Math.max(...emaPeriods)})`);
          }
        } catch (e) {
          log("warn", `EMA alignment failed: ${e.message}`);
        }

        const shouldFlip = sarEnabled && trendRisk && typeof trendRisk.shouldSAR === "function"
          ? trendRisk.shouldSAR(prevDir, dir)
          : false;
        prevDir = dir;

        // trailing stop bookkeeping on the tracked position (no sells wired here)
        // trailing stop bookkeeping on the tracked position; enforce exits when stop breached
        if (openPosition && openPosition.mint === mint) {
          if (overview?.price) {
            // update high/low water marks
            if (openPosition.direction === 1) {
              openPosition.highWater = Math.max(openPosition.highWater, overview.price);
            } else if (openPosition.direction === -1) {
              openPosition.lowWater  = Math.min(openPosition.lowWater,  overview.price);
            }
            const extreme = openPosition.direction === 1 ? openPosition.highWater : openPosition.lowWater;
            const stop = trendSignals.trailingStop(extreme, trailingPct, openPosition.direction === 1);
            log("info", `Trailing stop recalculated @ ${stop.toFixed ? stop.toFixed(6) : stop}`);
            // Check if trailing stop is hit for long (direction=1) or short (direction=-1)
            const priceNow = overview.price;
            let stopHit = false;
            if (openPosition.direction === 1 && priceNow <= stop) stopHit = true;
            if (openPosition.direction === -1 && priceNow >= stop) stopHit = true;
            if (stopHit) {
              log("info", `Trailing stop hit on ${mint} (price ${priceNow.toFixed(6)} vs stop ${stop.toFixed ? stop.toFixed(6) : stop})`);
              try {
                // Determine swap direction: for long position we sell token to BASE; for short skip
                if (openPosition.direction === 1 && openPosition.quantity) {
                  const sellRes = await getSafeQuote({
                    inputMint    : mint,
                    outputMint   : BASE_MINT,
                    amount       : openPosition.quantity,
                    slippage     : SLIPPAGE,
                    maxImpactPct : MAX_SLIPPAGE,
                  });
                  if (sellRes.ok) {
                    const exec = (botCfg?.executionShape || "") === "TWAP"
                      ? executeTWAP
                      : (botCfg?.executionShape || "") === "ATOMIC"
                      ? executeAtomicScalp
                      : (DRY_RUN ? simulateBuy : liveBuy);
                    await exec({ quote: sellRes.quote, mint, meta: {
                      strategy : "TrendFollowerExit",
                      walletId : botCfg.walletId,
                      userId   : botCfg.userId,
                      slippage : SLIPPAGE,
                      category : "Trendfollower",
                      executionShape: botCfg?.executionShape || "",
                      riskPolicy: trendRisk,
                      position: openPosition,
                    }});
                    summary.inc("sells");
                    openPosition = null;
                    // After exit we should not evaluate further on this token in this tick
                    continue;
                  } else {
                    log("warn", `Unable to get exit quote for ${mint}: ${sellRes.reason}`);
                  }
                } else {
                  // For short positions we simply clear the position without on-chain action
                  log("info", `Closing short position on ${mint} (direction -1)`);
                  openPosition = null;
                }
              } catch (e) {
                log("error", `Failed to exit position on ${mint}: ${e.message}`);
              }
            }
          }
        }

        // If no clear alignment, skip entry
        if (!openPosition && dir === 0) {
          log("info", "Trend mixed/flat — skip");
          continue;
        }

        // If we have a position and SAR says flip, exit the current position and allow a new entry
        if (openPosition && shouldFlip) {
          log("info", `SAR flip on ${openPosition.mint} (dir ${openPosition.direction} → ${dir}) — closing tracked position`);
          try {
            // For long positions perform an on‑chain exit; for short just drop tracking
            if (openPosition.direction === 1 && openPosition.quantity) {
              const sellRes = await getSafeQuote({
                inputMint    : openPosition.mint,
                outputMint   : BASE_MINT,
                amount       : openPosition.quantity,
                slippage     : SLIPPAGE,
                maxImpactPct : MAX_SLIPPAGE,
              });
              if (sellRes.ok) {
                const exec = (botCfg?.executionShape || "") === "TWAP"
                  ? executeTWAP
                  : (botCfg?.executionShape || "") === "ATOMIC"
                  ? executeAtomicScalp
                  : (DRY_RUN ? simulateBuy : liveBuy);
                await exec({ quote: sellRes.quote, mint: openPosition.mint, meta: {
                  strategy : "TrendFollowerExit",
                  walletId : botCfg.walletId,
                  userId   : botCfg.userId,
                  slippage : SLIPPAGE,
                  category : "Trendfollower",
                  executionShape: botCfg?.executionShape || "",
                  riskPolicy: trendRisk,
                  position: openPosition,
                }});
                summary.inc("sells");
              } else {
                log("warn", `SAR flip exit quote failed: ${sellRes.reason}`);
              }
            }
          } catch (e) {
            log("error", `SAR flip exit failed: ${e.message}`);
          }
          // Clear the position regardless of execution outcome
          openPosition = null;
        }

        // Pyramiding: if enabled and same direction, schedule an add (soft)
        if (openPosition && pyramidEnabled && dir === openPosition.direction) {
          try {
            // Determine how much additional equity (in SOL) can be risked.  We pass
            // the nominal equity (SNIPE_LAMPORTS → SOL) into nextPyramidAdd, which
            // returns a SOL amount to add.  If currentRisk already exceeds
            // maxRisk, this returns 0.
            const equitySol = SNIPE_LAMPORTS / 1e9;
            const additionalRiskSol = trendRisk.nextPyramidAdd(
              equitySol,
              riskPerAdd,
              openPosition.currentRisk,
              maxRisk
            );
            if (additionalRiskSol > 0) {
              const lamportsToSpend = Math.round(additionalRiskSol * 1e9);
              const addResult = await getSafeQuote({
                inputMint    : BASE_MINT,
                outputMint   : mint,
                amount       : lamportsToSpend,
                slippage     : SLIPPAGE,
                maxImpactPct : MAX_SLIPPAGE,
              });
              if (addResult.ok) {
                const exec = (botCfg?.executionShape || "") === "TWAP"
                  ? executeTWAP
                  : (botCfg?.executionShape || "") === "ATOMIC"
                  ? executeAtomicScalp
                  : (DRY_RUN ? simulateBuy : liveBuy);
                await exec({ quote: addResult.quote, mint, meta: {
                  strategy: "Trend Follower (Pyramid Add)",
                  walletId: botCfg.walletId,
                  userId  : botCfg.userId,
                  slippage: SLIPPAGE,
                  category: "Trendfollower",
                  openTradeExtras: { strategy: "trendFollower", pyramidAdd: true },
                }});
                // Increase our position risk proportionally; riskPerAdd is the fraction of equity used per add
                openPosition.currentRisk += riskPerAdd;
                log("info", `Pyramiding into ${mint}, added risk ${riskPerAdd}`);
              }
            }
          } catch (e) {
            log("warn", `Pyramid add failed: ${e.message}`);
          }
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
                
        quote.priceImpactPct = Number(quote.priceImpactPct);

        if (
          (quote.priceImpactPct !== 0 && !quote.priceImpactPct) ||
          typeof quote.priceImpactPct !== "number" ||
          isNaN(quote.priceImpactPct)
        ) {
          log("error", "❌ Invalid quote: priceImpactPct is missing or not a number");
          summary.inc("quoteFail");
          continue;
        }

        log("info", `Quote received – impact ${(quote.priceImpactPct * 100).toFixed(2)}%`);
        log("info", `[🐛 TP/SL DEBUG] tp=${botCfg.takeProfit ?? "null"}, sl=${botCfg.stopLoss ?? "null"}, tpPercent=${botCfg.tpPercent ?? "null"}, slPercent=${botCfg.slPercent ?? "null"}`);

        /* build meta */
        const meta = {
          strategy        : "Trend Follower",
          walletId        : botCfg.walletId,
          // publicKey: wallet?.publicKey || null,
          userId          : botCfg.userId,
          slippage        : SLIPPAGE,
          category        : "Trendfollower",
          tpPercent       : botCfg.tpPercent ?? TAKE_PROFIT,
          slPercent       : botCfg.slPercent ?? STOP_LOSS,
          tp              : botCfg.takeProfit,
          sl              : botCfg.stopLoss,
          openTradeExtras : { strategy: "trendFollower" },
          // NEW: allow specifying a custom execution shape (e.g. "TWAP").
          // Undefined or falsy shapes default to a single-shot swap.  We
          // coerce falsy values to an empty string for easier comparisons.
          executionShape  : botCfg?.executionShape || "",
          // NEW: attach trend follower risk policy for future use
          riskPolicy      : trendRisk,
        };

        /* execute or simulate */
        /* 3️⃣  execute (or simulate) the buy */
        let txHash;
        try {
          log("info", "[🚀 BUY ATTEMPT] Executing buy…");
          console.log("🔁 Sending to execBuy now…");

          if (snipedMints.has(mint)) {
            log("warn", `⚠️ Already sniped ${mint} — skipping duplicate`);
            continue;
          }
          snipedMints.add(mint);
          
          // Choose appropriate executor based on requested execution shape.
          const exec = meta.executionShape === "TWAP"
            ? executeTWAP
            : meta.executionShape === "ATOMIC"
            ? executeAtomicScalp
            : (DRY_RUN ? simulateBuy : liveBuy);
          txHash = await exec({ quote, mint, meta });
          console.log("🎯 exec returned:", txHash);
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

        /* NEW (add-only): initialize tracked position for trailing & adds */
        if (!openPosition && (prevDir === 1 || prevDir === -1)) {
          const entryPrice = quote.price;
          openPosition = {
            mint,
            direction: prevDir,
            entryPrice,
            highWater: entryPrice,
            lowWater : entryPrice,
            currentRisk: riskPerAdd,
            // capture the quantity of tokens purchased (for longs) so we can exit appropriately
            quantity: quote && quote.outAmount != null ? BigInt(quote.outAmount) : 0n,
          };
          log("info", `Tracking position ${prevDir === 1 ? "LONG" : "SHORT"} on ${mint} @ ${entryPrice}`);
        }

        /* bookkeeping */
        /* 📍 Inside the token loop, after bookkeeping */
        todaySol += SNIPE_LAMPORTS / 1e9;
        trades++;
        summary.inc("buys");

        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – trend follower shutting down");
          // ✅ print summary first
          await summary.printAndAlert("trendFollower");
          // ✅ then mark completion after summary
          log("summary", "✅ Trend follower completed (max-trades reached)");
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
        log("error", "🛑 Not enough SOL – trend follower shutting down");
        await summary.printAndAlert("Trend follower halted: insufficient SOL");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        return;                // <── bail right here
      }

      /* otherwise count the failure and let the normal
         HALT_ON_FAILS logic decide */
      fails++;
      if (fails >= HALT_ON_FAILS) {
        log("error", "🛑 Error limit hit — trend follower shutting down");
        await summary.printAndAlert("Trend follower halted on errors");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        return;                       // bail out cleanly
      }
      summary.inc("errors");
      log("error", err?.message || String(err));
      await tradeExecuted({
        userId     : botCfg.userId,
        mint       : mint,
        wl         : botCfg.walletLabel || "default",
        category   : "TrendFollower",
        simulated  : DRY_RUN,
        amountFmt  : `${(SNIPE_LAMPORTS / 1e9).toFixed(3)} SOL`,
        impactPct  : null,
        usdValue   : null,
        entryPriceUSD : null,
        tpPercent  : null,
        slPercent  : null,
      });
    }

    /* early-exit outside the for-loop */
    if (trades >= MAX_TRADES) {
      // ✅ summary before completion flag
      await summary.printAndAlert("trendFollower");
      log("summary", "✅ Trend follower completed (max-trades reached)");

      if (runningProcesses[botId]) runningProcesses[botId].finished = true;
      clearInterval(loopHandle);
      process.exit(0);
    }
  }

  // ── token-feed banner ───────────────────────────────
  const feedName = botCfg.overrideMonitored
    ? "custom token list (override)"
    : (botCfg.tokenFeed || "new listings");   // falls back to sniper default
  log("info", `Token feed in use → ${feedName}`);

  /* scheduler */
  const loopHandle = runLoop(tick, botCfg.loop === false ? 0 : INTERVAL_MS, {
    label: "trendFollower",
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