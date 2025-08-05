// /** Scalper Strategy Module
//  * - Executes trades at regular intervals.
//  * - Designed for fast in-n-out trades on volatile pairs. 
//  * - Use pre-configuredd token pairs and trade size. 
//  * 
//  * Configurable: 
//  * - Input/Output tokens (via .env)
//  * - Trade Amount (in SOL or token) 
//  * - Slippage tolerance (ms) 
//  * 
//  * 
//  * Eventually Support:
//  * - Take Profit (TP)/ Stop Loss (SL) logic
//  * - Telegram alerts on trade success/fail
//  * - Profit/loss tracking om SQLit or flat file
//  * - Multi-token scalping rotation or prioritization
//  * 
//  * /**
//  * Scalper Strategy Module
//  * - Trades monitored tokens at fixed intervals
//  * - Designed for volatile token entry/exit
//  *
//  * Finalized:
//  * ✅ Config-driven via JSON runtime file
//  * ✅ Multi-wallet rotation support
//  * ✅ Cooldown + safety + volume + pump filters
//  * ✅ Honeypot and slippage protection
//  * ✅ Telegram alerts, DRY_RUN mode
//  * ✅ Trade logging with TP/SL evaluation
//  */

// /* backend/services/strategies/scalper.js
//  * ———————————————————————————————————————— */

// const fs               = require("fs");
// const { EventEmitter } = require("events");
// const { PublicKey }    = require("@solana/web3.js");
// const pLimit           = require("p-limit");
// const { z }            = require("zod");

// const createLRU        = require("./core/lruCache");
// const resolveFeed            = require("./paid_api/tokenFeedResolver");
// const getTokenShortTermChange= require("./paid_api/getTokenShortTermChanges");
// const { getWalletBalance, isAboveMinBalance } = require("../utils");
// const { isSafeToBuyDetailed } = require("../utils/safety/safetyCheckers/botIsSafeToBuy");
// const { logSafetyResults }    = require("./logging/logSafetyResults");
// const { strategyLog }         = require("./logging/strategyLogger");
// const { createSummary, tradeExecuted } = require("./core/alerts");
// const { lastTickTimestamps, runningProcesses }
//       = require("../utils/strategy_utils/activeStrategyTracker");
// const wm                 = require("./core/walletManager");
// const guards             = require("./core/tradeGuards");
// const createCooldown     = require("./core/cooldown");
// const getSafeQuote       = require("./core/quoteHelper");
// const { liveBuy, simulateBuy } = require("./core/tradeExecutor");
// const { passes, explainFilterFail } = require("./core/passes");
// const runLoop            = require("./core/loopDriver");
// const { initTxWatcher }  = require("./core/txTracker");
// const registerTpSl       = require("./core/tpSlRegistry");

// /* ─────── Tunable constants (inline) ───────────────── */
// const DEFAULT_COOLDOWN_MS = 60_000;
// const DEFAULT_INTERVAL_MS = 10_000;
// const DEFAULT_CONCURRENCY = 4;
// const BIRDEYE_TIMEOUT_MS  = 5_000;
// const BIRDEYE_FAIL_WINDOW = 30_000;
// const BIRDEYE_FAIL_CAP    = 6;

// /* ─────── Metrics hook (optional) ──────────────────── */
// const scalperEvents = new EventEmitter();

// /* ─────── Config schema (basic) ────────────────────── */
// const cfgSchema = z.object({
//   scalpAmount     : z.number().positive().optional(),
//   amountToSpend   : z.number().positive().optional(),
//   entryThreshold  : z.number().optional(),
//   volumeThreshold : z.number().optional(),
//   interval        : z.number().positive().optional(),
//   cooldown        : z.number().positive().optional(),
//   concurrency     : z.number().positive().optional(),
//   maxTrades       : z.number().positive().optional(),
//   maxOpenTrades   : z.number().positive().optional(),
// }).strict();

// /* ─────── Strategy export ──────────────────────────── */
// module.exports = async function scalperStrategy(cfg = {}) {
//   cfgSchema.parse(cfg);                 // validate upfront

//   const botId   = cfg.botId || "manual";
//   const log     = strategyLog("scalper", botId, cfg);
//   const summary = createSummary("Scalper", log);

//   /* ---------- User-level settings ------------------- */
//   const BASE_MINT = cfg.inputMint ||
//     "So11111111111111111111111111111111111111112";
//   const SIZE_LAMPORTS   = (+cfg.scalpAmount || +cfg.amountToSpend || 0.005) * 1e9;
//   const ENTRY_THRESHOLD = (+cfg.entryThreshold ?? 0.5) / 100;     // as ratio
//   const VOLUME_THRESHOLD= +cfg.volumeThreshold || 0;
//   const SLIPPAGE        = +cfg.slippage    || 0.2;
//   const MAX_SLIPPAGE    = +cfg.maxSlippage || 0.05;

//   let   INTERVAL_MS     = Math.round((+cfg.interval || DEFAULT_INTERVAL_MS/1000) * 1000);
//   const COOLDOWN_MS     = cfg.cooldown != null ? +cfg.cooldown*1000 : DEFAULT_COOLDOWN_MS;
//   const MAX_TRADES      = +cfg.maxTrades      || 9999;
//   const MAX_OPEN_TRADES = +cfg.maxOpenTrades  || 2;
//   const HALT_ON_FAILS   = +cfg.haltOnFailures || 5;

//   const DRY_RUN  = cfg.dryRun === true;
//   const execBuy  = DRY_RUN ? simulateBuy : liveBuy;
//   const MIN_BAL  = 0.2;

//   const SAFETY_DISABLED =
//     cfg.disableSafety === true ||
//     (cfg.safetyChecks && typeof cfg.safetyChecks === "object" &&
//      Object.values(cfg.safetyChecks).every(v => v === false));

//   const concLimit = pLimit(cfg.concurrency || DEFAULT_CONCURRENCY);

//   /* ---------- Runtime state ------------------------- */
//   wm.initWallets(cfg.walletLabels);
//   const cd   = createCooldown(COOLDOWN_MS);
//   initTxWatcher("Scalper");

//   let trades = 0;
//   const fail = { net:0, quote:0, exec:0, safety:0 };
//   let todaySol = 0;  

//   /* ---------- Helpers -------------------------------- */
//   const withTimeout = (p,ms=BIRDEYE_TIMEOUT_MS)=>
//     Promise.race([p,new Promise((_,r)=>setTimeout(()=>r(new Error("timeout")),ms))]);

//   async function guardBirdeye(fn){
//     birdeyeFails = birdeyeFails.filter(t=>Date.now()-t < BIRDEYE_FAIL_WINDOW);
//     if (birdeyeFails.length>=BIRDEYE_FAIL_CAP){
//       log("warn","⏸ Birdeye breaker 30 s");
//       await new Promise(r=>setTimeout(r, BIRDEYE_FAIL_WINDOW));
//       birdeyeFails=[];
//     }
//     try{ return await fn(); }
//     catch(e){ birdeyeFails.push(Date.now()); throw e; }
//   }




  
//   /* ───────────── Tick loop ─────────────────────────── */
//   async function tick(){
//     if (trades >= MAX_TRADES) return;
//   log("loop", `\n Sniper Tick @ ${new Date().toLocaleTimeString()}`);
//    lastTickTimestamps[botId] = Date.now();


//    if (fails >= HALT_ON_FAILS) {
//     log("error", "🛑 halted (too many errors)");
//     await summary.printAndAlert("Sniper halted on errors");
//     if (runningProcesses[botId]) runningProcesses[botId].finished = true;
//     clearInterval(loopHandle);
//     return;
//   }


//    try {
//   /* ----- guards & balance ----- */
//   guards.assertTradeCap(trades, MAX_TRADES);
//   guards.assertOpenTradeCap("scalper", botId, MAX_OPEN_TRADES);
//   if (!(await wm.ensureMinBalance(
//         MIN_BAL, getWalletBalance, isAboveMinBalance))) {
//     log("warn", "Balance below min – skipping");
//     return;
//   }
//   const wallet = wm.current();

//     const mints  = await resolveFeed("scalper", cfg);
//     const TOKENS = mints.map(m=>new PublicKey(m));
//     summary.inc("scanned", TOKENS.length);
//     log("info", `Scanning ${TOKENS.length} tokens…`);

//     log("loop",`Scalper Tick @ ${new Date().toLocaleTimeString()} — ${TOKENS.length} tokens`);
//     lastTickTimestamps[botId]=Date.now();

//     let hitsThisTick = 0;
//     const cache = createLRU(200);
//     let tradesThisTick = 0;

//       await Promise.all(
//         TOKENS.map(pk => concLimit(() => tokenWorker(pk, cache).catch(() => {})))
//       );

//       emptyTicks = hitsThisTick ? 0 : emptyTicks + 1;
//       if (emptyTicks >= 6 && INTERVAL_MS < 60_000) {
//         INTERVAL_MS = 60_000;
//         loopHandle.setInterval(60_000);
//       }
//       if (emptyTicks === 0 && loopHandle.interval > INTERVAL_MS) {
//         loopHandle.setInterval(INTERVAL_MS);
//       }

//       summary.inc("ticks");

//       /* ✅ restored post-loop trade-cap guard (KEEP THIS ONE) */
//       if (trades >= MAX_TRADES) {
//         log("info", "🎯 Trade cap reached – scalper shutting down (post-loop)");
//         await summary.printAndAlert("Scalper finished (max-trades)");
//         log("summary", "✅ Scalper completed (max-trades reached)");
//         if (runningProcesses[botId]) runningProcesses[botId].finished = true;
//         clearInterval(loopHandle);
//         return;
//       }

//       /* 🧼 remove this duplicated MAX_TRADES block below ↓↓↓ */
//       // if (trades >= MAX_TRADES) {
//       //   await summary.printAndAlert("Scalper finished (max-trades)");
//       //   if (runningProcesses[botId]) runningProcesses[botId].finished = true;
//       //   clearInterval(loopHandle);
//       // }

//       /* ✅ error-based shutdown (KEEP this block) */
//       if (Object.values(fail).some(c => c >= HALT_ON_FAILS)) {
//         log("error", "🛑 Halt: consecutive failures");
//         await summary.printAndAlert("Scalper halted on errors");
//         if (runningProcesses[botId]) runningProcesses[botId].finished = true;
//         clearInterval(loopHandle);
//       }

//     /* ------------- per-token worker ------------------ */
//     async function tokenWorker(pk,cache){
//       if (trades>=MAX_TRADES) return;
//       const mint = pk.toBase58();

//       if (cd.peek && cd.peek(mint)>0) {
//         log("info",`⏳ Cooldown ${mint}`);
//         return;
//       }

//       try{
//         log("info",`Token detected: ${mint}`);
//         log("info","Fetching price/volume…");

//         /* PRICE/VOLUME pass */
//         let res = cache.get(mint);
//         if(!res){
//           res = await guardBirdeye(()=>withTimeout(
//             passes(mint,{
//               entryThreshold:ENTRY_THRESHOLD,
//               volumeThresholdUSD:VOLUME_THRESHOLD,
//               pumpWindow:cfg.priceWindow||"1m",
//               volumeWindow:cfg.volumeWindow||"1h",
//               volumeSpikeMult:cfg.volumeSpikeMultiplier,
//               minMarketCap:cfg.minMarketCap,
//               maxMarketCap:cfg.maxMarketCap,
//               fetchOverview:getTokenShortTermChange,
//             })));
//           cache.set(mint,res);
//         }

//         if(!res.ok){
//           log("warn",explainFilterFail(res,{entryTh:ENTRY_THRESHOLD,volTh:VOLUME_THRESHOLD}));
//           summary.inc(res.reason||"filterFail");
//           return;
//         }

//         log("info","Passed price/volume check");
//         log("info",`[🎯 TARGET FOUND] ${mint}`);
//         summary.inc("filters");

//         /* SAFETY */
//         if(!SAFETY_DISABLED){
//           const safe = await isSafeToBuyDetailed(mint,cfg.safetyChecks||{});
//           if(logSafetyResults(mint,safe,log,"scalper")){
//             fail.safety++; return;
//           }
//           summary.inc("safety");
//         } else log("info","⚠️ Safety checks DISABLED");

//       /* ──────── QUOTE ───────────────────────────── */
//       log("info", "Getting swap quote…");
//       const { ok, quote, reason } = await withTimeout(
//         getSafeQuote({
//           inputMint: BASE_MINT,
//           outputMint: mint,
//           amount: SIZE_LAMPORTS,
//           slippage: SLIPPAGE,
//           maxImpactPct: MAX_SLIPPAGE,
//         })
//       );
//       if (!ok) { fail.quote++; summary.inc(reason || "quoteFail"); return; }

//       /* 👇 **RESTORED VERBOSE BANNER** */
//       log(
//         "info",
//         `Quote received – impact ${(quote.priceImpactPct * 100).toFixed(2)}%`
//       );
//       log("info", "[🚀 BUY ATTEMPT] Executing scalp buy…");

//       /* build full meta (was inlined before) */
//       const meta = {
//         strategy: "scalper",
//         walletLabel: cfg.walletLabels?.[0] || "default",
//         category: "Scalper",
//         slippage: SLIPPAGE,
//         takeProfitPct: cfg.takeProfit || 0,
//         stopLossPct: cfg.stopLoss || 0,
//         openTradeExtras: { strategy: "scalper" },
//       };

//       /* BUY with 15 s abort-guard */
//       const ac = new AbortController();
//       const txHash = await withTimeout(
//         execBuy({ quote, wallet: wm.current(), mint, meta }, { signal: ac.signal }),
//         15_000
//       ).catch((e) => {
//         ac.abort();
//         throw e;
//       });

//       /* ──────── SUCCESS LOGS (restored) ─────────── */
//       const buyMsg = DRY_RUN
//         ? `[🎆 BOUGHT SUCCESS] ${mint}`
//         : `[🎆 BOUGHT SUCCESS] ${mint} Tx: https://solscan.io/tx/${txHash}`;
//       log("info", buyMsg);

//       log(
//         "info",
//         `[STATS] price=${(res.overview?.price ?? 0).toFixed(6)}, ` +
//           `vol1h=$${(res.overview?.volume1h ?? 0).toLocaleString()}, ` +
//           `change1m=${((res.overview?.priceChange ?? 0) * 100).toFixed(2)}%`
//       );

//       await registerTpSl(mint, {
//           tp: cfg.takeProfit || 0,
//           sl: cfg.stopLoss   || 0,
//           walletLabel: cfg.walletLabels?.[0] || "default",
//           strategy: "scalper",
//         });

//         todaySol += SIZE_LAMPORTS / 1e9;         // only if you still chart it
//         fails.net = fails.quote = fails.exec = fails.safety = 0;

//       /* bookkeeping stays unchanged */
//       cd.hit(mint);
//       trades++;
//       hitsThisTick++;
//       summary.inc("buys");
//       scalperEvents.emit("trade", {
//         mint,
//         txHash,
//         price: res.overview?.price,
//       });
//       await tradeExecuted({
//         mint,
//         price: res.overview?.price || 0,
//         strategy: "Scalper",
//         txHash,
//       });

//         /* SUCCESS */
//         cd.hit(mint);
//         trades++; hitsThisTick++; tradesThisTick++; summary.inc("buys");
//         scalperEvents.emit("trade",{mint,txHash,price:res.overview?.price});
//         await tradeExecuted({mint,price:res.overview?.price||0,strategy:"Scalper",txHash});

//         const msg = DRY_RUN ? `[🎆 BOUGHT] ${mint}` :
//           `[🎆 BOUGHT] ${mint} Tx: https://solscan.io/tx/${txHash}`;
//         log("info",msg);


//         const statsLine =
//           `[STATS] price=${(overview?.price ?? 0).toFixed(6)}, ` +
//           `mcap=${(overview?.[volKey] ?? 0).toFixed(0)}, ` +
//           `change5m=${((overview?.priceChange5m ?? 0) * 100).toFixed(2)}%`;
//         log("info", statsLine);

//         /* mid-loop trade-cap shutdown */
//         if(trades>=MAX_TRADES){
//           log("info","🎯 Trade cap hit – shutting down mid-loop");
//           await summary.printAndAlert("Scalper finished (max-trades)");
//           if(runningProcesses[botId]) runningProcesses[botId].finished=true;
//           clearInterval(loopHandle);
//         }
//       }
//       catch(err){
//         log("error",`${mint}: ${err.message}`);
//         fail.net++;
//       }
//     }
//   }

//   // ── token-feed banner ───────────────────────────────
// const feedName = botCfg.overrideMonitored
//   ? "custom token list (override)"
//   : (botCfg.tokenFeed || "new listings");   // falls back to sniper default
// log("info", `Token feed in use → ${feedName}`);

//   /* scheduler */
//   const loopHandle = runLoop(tick, botCfg.loop === false ? 0 : INTERVAL_MS, {
//     label: "scalper",
//     botId,
//   });
// };

// /* CLI helper (unchanged) */
// if (require.main === module) {
//   const path = process.argv[2];
//   if (!path){ console.error("pass cfg path"); process.exit(1);}
//   module.exports(JSON.parse(fs.readFileSync(path,"utf8")));
// }


// /** 
//  * Additions: 
//  * - Multi-wallet rotation
//  * - Honeypot Protection Check
//  * - Telegram trade alerts 
//  * - Analytics Logging
//  * - Clean error handling + structure
//  */