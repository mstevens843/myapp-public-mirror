// /** Dip Buyer Strategy Module
//  * - Buys tokens when price drops by a configured % ina short window. 
//  * - Ideal for bounce trading on hyped or volatile tokens.
//  * - Useful to catch panic dips or exit scams with bounce potential. 
//  * 
//  * Configurable:
//  * - Token list
//  * - Dip % Threshold
//  * - Useful to catch panic dips or exit scams with bounce potential 
//  * 
//  * 
//  * - Configurable: 
//  * - Token list 
//  * - Dip % threshold 
//  * - Timeframe (ms) to compare price 
//  * - Trade amount, slippage
//  * 
//  * Eventually Support:
//  * - Telegram alerts on dip trigger
//  * - Combine with candle-based patterns
//  * - Log rebound success/fail rate
//  * 
//  *  * Finalized:
//  * ✅ Config-driven
//  * ✅ Honeypot + volume filters
//  * ✅ DRY_RUN mode
//  * ✅ Telegram alerts
//  * ✅ Wallet rotation
//  */


// /** BAsicallty a contrarian to Sniper Mode */



// // backend/services/strategies/dipBuyer.js
// // backend/services/strategies/dipBuyer.js
// /* DipBuyer – waits for a sharp % drop within a look-back window, then buys */

// /* backend/services/strategies/dipbuyer.js
//  * ─────────────────────────────────────── */

// // backend/services/strategies/dipBuyer.js
// /* DipBuyer v2 – refactor aligned with new-standard Sniper
//  * Buys a token after an intraday %-drop inside LOOKBACK_MS.
//  * Now includes: market-cap filters, passes banner, tradeExecuted alerts,
//  * configurable fail-halt, stricter defaults, and window-edge fix.
//  * -------------------------------------------------------------- */

// const fs = require("fs");
// const { PublicKey }   = require("@solana/web3.js");
// const resolveFeed     = require("./paid_api/tokenFeedResolver");   // 🆕
// /* ── paid-API helpers ────────────────────────────────────────── */
// const getTokenShortTermChange = require("./paid_api/getTokenShortTermChanges");

// /* ── safety / logging / alerts ───────────────────────────────── */
// const { isSafeToBuyDetailed } = require("../utils/safety/safetyCheckers/botIsSafeToBuy");
// const { logSafetyResults }    = require("./logging/logSafetyResults");
// const { strategyLog }         = require("./logging/strategyLogger");
// const { createSummary, tradeExecuted } = require("./core/alerts");

// /* ── watchdog / status ───────────────────────────────────────── */
// const { lastTickTimestamps, runningProcesses }
//       = require("../utils/strategy_utils/activeStrategyTracker");

// /* ── shared helpers ──────────────────────────────────────────── */
// const wm                       = require("./core/walletManager");
// const guards                   = require("./core/tradeGuards");
// const createCooldown           = require("./core/cooldown");
// const getSafeQuote             = require("./core/quoteHelper");
// const { liveBuy, simulateBuy } = require("./core/tradeExecutor");
// const registerTpSl             = require("./core/tpSlRegistry");
// const { initTxWatcher }        = require("./core/txTracker");
// const runLoop                  = require("./core/loopDriver");
// const {
//   getWalletBalance,
//   isAboveMinBalance,
// } = require("../utils");





// /* ───────────────────────────────────────────────────────────── */
// module.exports = async function dipBuyerStrategy(cfg = {}) {
//   const botId   = cfg.botId || "manual";
//   const log     = strategyLog("dipbuyer", botId, cfg);
//   const summary = createSummary("DipBuyer", log);

//   /* ── config -------------------------------------------------- */
//   const TOKENS = cfg.tokenMint
//     ? [new PublicKey(cfg.tokenMint)]
//     : (cfg.watchedTokens || []).map((m) => new PublicKey(m));

//   /* positive % (e.g. 5 → 0.05, 0.05 → 0.05) */
//   const DIP_THRESHOLD = Math.abs(+cfg.dipThreshold || 20) /        // fallback 20 %
//                         (+cfg.dipThreshold >= 1 ? 100 : 1);

//   const recWin = cfg.recoveryWindow || "5m";          // string like "5m"
//   const volWin = cfg.volumeWindow || "1h";

// const LOOKBACK_MS =
//   (typeof recWin === "string" ? parseFloat(recWin) : +recWin) * 60_000;            // 5 min
//   const INTERVAL_MS   = Math.round((+cfg.interval || 20) * 1000);
//   const VOL_USD       = +cfg.volumeThreshold || 10_000;

//   const MIN_MCAP      = +cfg.minMarketCap || 0;
//   const MAX_MCAP      = +cfg.maxMarketCap || 0;

//   const BASE_MINT     = cfg.inputMint ||
//     "So11111111111111111111111111111111111111112";

//   const POSITION_LAMPORTS = (+cfg.positionSize ||
//                              +cfg.amountToSpend ||
//                              0.01) * 1e9;

//   const SLIPPAGE      = +cfg.slippage    || 0.40;
//   const MAX_SLIPPAGE  = +cfg.maxSlippage || 0.05;                  // stricter 5 %

//   const TAKE_PROFIT   = +cfg.takeProfit  || 0;
//   const STOP_LOSS     = +cfg.stopLoss    || 0;

//   const MAX_DAILY_SOL   = +cfg.maxDailyVolume || 3;
//   const MAX_OPEN_TRADES = +cfg.maxOpenTrades  || 2;
//   const MAX_TRADES      = +cfg.maxTrades      || 9999;
//   const HALT_ON_FAILS   = +cfg.haltOnFailures || 3;
//   const COOLDOWN_MS     = +cfg.cooldown       || 60_000;

//   const DRY_RUN        = cfg.dryRun === true;
//   const execBuy        = DRY_RUN ? simulateBuy : liveBuy;
//   const MIN_BALANCE_SOL = 0.20;

//   /* safety toggle */
//   const SAFETY_DISABLED =
//     cfg.disableSafety === true ||
//     (cfg.safetyChecks && Object.values(cfg.safetyChecks).every((v) => v === false));

//   /* ── bootstrap ----------------------------------------------- */
//   wm.initWallets(cfg.walletLabels);
//   const cd        = createCooldown(COOLDOWN_MS);
//   /* mint → { peak: number, ts: number } */
//   const priceHist = new Map();                                  // mint → {price, ts}
//   initTxWatcher("DipBuyer");

//   /* state */
//   let todaySol = 0;
//   let trades   = 0;
//   let fails    = 0;
//   const passes = { dip: 0, volume: 0, mcap: 0, safety: 0 };

//   /* ── tick ----------------------------------------------------- */
//   async function tick() {
// if (trades >= MAX_TRADES) return;
// log("loop", `\nDipBuyer Tick @ ${new Date().toLocaleTimeString()}`);
// lastTickTimestamps[botId] = Date.now();

// /* NEW: stop instantly if we already blew past the fail cap */
// if (fails >= HALT_ON_FAILS) {
//   log("error", "🛑 halted (too many errors)");
//   await summary.printAndAlert("DipBuyer halted on errors");
//   if (runningProcesses[botId]) runningProcesses[botId].finished = true;
//   clearInterval(loopHandle);
//   return;
// }

// try {
      

//       guards.assertTradeCap(trades, MAX_TRADES);
//       guards.assertOpenTradeCap("dipbuyer", botId, MAX_OPEN_TRADES);

//       if (!(await wm.ensureMinBalance(MIN_BALANCE_SOL, getWalletBalance, isAboveMinBalance))) {
//         log("warn", "Balance below min – skipping");
//         return;
//       }
//       const wallet = wm.current();

//      const mints = await resolveFeed("dipbuyer", cfg);
//         /* ---------- rolling-peak tracking inside the look-back window ---------- */
//         const now   = Date.now();
//         let   rec   = priceHist.get(mint);

//         /* window expired → start a brand-new one */
//         if (!rec || now - rec.ts > LOOKBACK_MS) {
//           rec = { peak: priceNow, ts: now };        // initialise at current price
//           priceHist.set(mint, rec);
//           continue;                                 // need another pass to measure a drop
//         }

//         /* still inside the window → update the peak if we made a new high */
//         if (priceNow > rec.peak) rec.peak = priceNow;
//         priceHist.set(mint, rec);                   // persist any peak update

        
  
//         // const mint = pk.toBase58();
//         // if (cd.hit(mint)) continue;                               // per-mint cooldown

//         /* overview fetch */
//         log("info", `Token detected: ${mint}`);
//         log("info", "Fetching price change + volume…");
//         const ov = await getTokenShortTermChange(mint, "1m", volWin);
//         if (!ov) continue;

//         const priceNow = ov.price ?? 0;
//         const volumeField = `volume${volWin}`;
//         const volume = ov[volumeField] ?? 0;
//         const mcapUSD = ov.marketCapUSD ?? 0;

//         /* volume gate */
//         if (!priceNow) {
//           log("info", `Skipped ${mint} — no price data`);
//           continue;
//         }
//         if (volume < VOL_USD) {
//           log("info", `Skipped ${mint} — volume (${volWin}) ${volume} < ${VOL_USD}`);
//           continue;
//         }

//         /* market-cap gates (optional) */
//         if (MIN_MCAP && mcapUSD < MIN_MCAP) {
//           log("info", `Skipped ${mint} — mcap ${mcapUSD} < min ${MIN_MCAP}`);
//           summary.inc("mcapMin");
//           continue;
//         }
//         if (MAX_MCAP && mcapUSD > MAX_MCAP) {
//           log("info", `Skipped ${mint} — mcap ${mcapUSD} > max ${MAX_MCAP}`);
//           summary.inc("mcapMax");
//           continue;
//         }
//         passes.mcap++;

//         /* look-back price logic -------------------------------- */
//         const prevRec = priceHist.get(mint);
//         if (!prevRec || Date.now() - prevRec.ts > LOOKBACK_MS) {
//           // start / reset window
//           priceHist.set(mint, { price: priceNow, ts: Date.now() });
//           continue;
//         }

//         const drop = (prevRec.price - priceNow) / prevRec.price;

//         /* still inside the window → update the peak if we made a new high */
//         if (priceNow > rec.peak) rec.peak = priceNow;
//         priceHist.set(mint, rec);                   // persist any peak update

//         const drop = (rec.peak - priceNow) / rec.peak;
//         if (drop < DIP_THRESHOLD) {

//           log(
//             "info",
//             `Skipped ${mint} — dip ${(drop * 100).toFixed(2)}% < ` +
//             `${(DIP_THRESHOLD * 100).toFixed(2)}% (peak=$${rec.peak.toFixed(6)})`
//           );
//           continue;     
//       passes.dip++;

//         log("info", `📉 Dip ${(drop * 100).toFixed(2)} % detected (${mint})`);

//         /* safety checks */
//         if (!SAFETY_DISABLED) {
//           const safeRes = await isSafeToBuyDetailed(mint, cfg.safetyChecks || {});
//           if (logSafetyResults(mint, safeRes, log, "dipbuyer")) {
//           log("info", `Skipped ${mint} — failed safety checks`);
//           summary.inc("safetyFail");
//           continue;
//         }
//           passes.safety++;
//         } else {
//           log("info", "⚠️ Safety checks DISABLED – proceeding un-vetted");
//         }

//         /* daily cap */
//         guards.assertDailyLimit(POSITION_LAMPORTS / 1e9, todaySol, MAX_DAILY_SOL);

//         /* quote ------------------------------------------------ */
//         log("info", "Getting swap quote…");
//         const { ok: qOK, quote, reason: qReason } = await getSafeQuote({
//           inputMint    : BASE_MINT,
//           outputMint   : mint,
//           amount       : POSITION_LAMPORTS,
//           slippage     : SLIPPAGE,
//           maxImpactPct : MAX_SLIPPAGE,
//         });
//         if (!qOK) { summary.inc(qReason || "quoteFail"); continue; }

//         log("info", `Quote impact ${(quote.priceImpactPct * 100).toFixed(2)} %`);
//         log("info", "[🚀 BUY ATTEMPT] Executing dip buy…");

//         /* trade meta */
//         const meta = {
//           strategy        : "dipbuyer",
//           walletLabel     : cfg.walletLabels?.[0] || "default",
//           slippage        : SLIPPAGE,
//           category        : "DipBuyer",
//           takeProfitPct   : TAKE_PROFIT,
//           stopLossPct     : STOP_LOSS,
//           openTradeExtras : { strategy: "dipbuyer" },
//         };

//         const txHash = await execBuy({ quote, wallet, mint, meta });

//         /* alert + mini-console toast -------------------------- */
//         await tradeExecuted({ mint, price: priceNow, strategy: "DipBuyer", txHash });
//         log("summary", `[PASSES] dip/vol/mcap/safety = ${Object.values(passes).join("/")}`);

//         const msg = DRY_RUN
//           ? `[🧪 SIM BUY] ${mint}`
//           : `[🎆 BOUGHT] ${mint}  →  https://solscan.io/tx/${txHash}`;
//         log("info", msg);

//         /* stats banner */
//         log(
//           "info",
//           `[STATS] price=${priceNow.toFixed(6)}, vol1h=$${vol1h.toLocaleString()}, ` +
//           `mcap=$${mcapUSD.toLocaleString()}, drop=${(drop * 100).toFixed(2)} %`
//         );

//         /* TP/SL registry */
//         await registerTpSl(mint, {
//           tp          : TAKE_PROFIT,
//           sl          : STOP_LOSS,
//           walletLabel : cfg.walletLabels?.[0] || "default",
//           strategy    : "dipbuyer",
//         });

//         /* bookkeeping */
//         todaySol += POSITION_LAMPORTS / 1e9;
//         trades++; summary.inc("buys");
//         cd.hit(mint);
//         // reset window after buy
//         priceHist.set(mint, { price: priceNow, ts: Date.now() });

//         if (trades >= MAX_TRADES) break;
//       } // end for-mints

//       fails = 0;                                               // reset streak
//     } catch (err) {
//       fails++; summary.inc("errors");
//       log("error", err?.message || String(err));
//       if (fails >= HALT_ON_FAILS) {
//         log("error", "🛑 Error limit hit — dipbuyer shutting down");
//         await summary.printAndAlert("DipBuyer halted on errors");
//         if (runningProcesses[botId]) runningProcesses[botId].finished = true;
//         clearInterval(loopHandle);
//         return;
//       }
//     }

//     /* exit check ---------------------------------------------- */
//     if (trades >= MAX_TRADES) {
//       await summary.printAndAlert("DipBuyer");
//       log("summary", "✅ DipBuyer completed (max-trades reached)");
//       if (runningProcesses[botId]) runningProcesses[botId].finished = true;
//       clearInterval(loopHandle);
//       process.exit(0);
//     }
//   }

//   // ── token-feed banner ───────────────────────────────
// // Show the feed we actually resolved (aligns with DEFAULTS in tokenFeedResolver)
//  const resolvedFeed =
//    cfg.tokenFeed || require("../utils/tokenFeedResolver").DEFAULTS.dipbuyer;
//  const feedName = cfg.overrideMonitored
//    ? "custom token list (override)"
//    : resolvedFeed;



//   /* scheduler -------------------------------------------------- */
//   const loopHandle = runLoop(tick, cfg.loop === false ? 0 : INTERVAL_MS, {
//     label: "dipbuyer",
//     botId,
//   });
// };

// /* ── CLI helper (dev) ────────────────────────────────────────── */
// if (require.main === module) {
//   const fp = process.argv[2];
//   if (!fp || !fs.existsSync(fp)) {
//     console.error("❌ Pass config JSON path");
//     process.exit(1);
//   }
//   module.exports(JSON.parse(fs.readFileSync(fp, "utf8")));
// }







// /** Additions"
//  * - wallet rotation
//  * - Honeypot Protection
//  * - Trade logging
//  * - Telegram LAerts
//  * - Smarter Price Money
//  */


// /** Additions:
//  * Feature	Status
// watchedTokens → replaces tokens ✅	
// dipThreshold ✅	
// recoveryWindow 🟡 stubbed (for later TP logic)	
// confirmationCandles 🟡 stubbed	
// volumeThreshold ✅	
// positionSize ✅	
// takeProfit, stopLoss ✅	
// dryRun ✅	
// maxDailyVolume ✅	
// haltOnFailures ✅	
// cooldown ✅
//  */