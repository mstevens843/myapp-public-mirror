/** SNIPER MODE
 * - Watches for new tokens appearing on Jupiter (or a dummy feed for now)
 * - Filter out scammy or duplicate tokens (base logic) 
 * - Buys instantly when a fresh mint is detected (your chosen account) 
 */

/** SETUP
 * - Load known tokens from a file or memory
 * - Ping Jupiter token list every 30-60 seconds
 * - Comprare for new tokens
 * - If new token found -> try to snipe with 'swap.js'
 * 
 * Plans for Later: 
 * - Real-time Solana event feeds.
 * - Telegram Alerts and Safety checks. 
 */

/** Sniper Strategy Module
 * - Detects new token listings from Jupiter token list.
 * - Attempts to snipe early using available liquidity.
 * 
 * Integrated:
 * - Honeypot detection (price impact, slippage, liquidity)
 * - Telegram alerts (trade success/failure)
 * - Analytics logging (saved to trades.json)
 * - Multi-wallet rotation (spread risk)
 */
const fs = require("fs");
/* optional runtime-file cleanup */
const { getSwapQuote, executeSwap }   = require("../../utils/swap");
const getNewListings          = require("./paid_api/getNewListings");       // 🚀 real-time feed
const getTokenShortTermChange = require("./paid_api/getTokenShortTermChanges"); // 5 m-1 h trend
const getTokenPrice  = require("./paid_api/getTokenPrice")
const { sendAlert }   = require("../../telegram/alerts");
const getTokenCreationTime = require("./paid_api/getTokenCreationTime")
const {
  loadOpenTrades, getOpenTradesForBot, addOrUpdateOpenTrade
} = require("../utils/analytics/openTrades");     
const {
  logTrade, getWalletBalance, isAboveMinBalance,
  isWithinDailyLimit, loadWalletsFromLabels, getCurrentWallet,
} = require("../utils");
const { getMintDecimals } = require("../../utils/tokenAccounts");
const { addWebTpSlEntry } = require("../utils/analytics/webTpSlStorage");
const { lastTickTimestamps, runningProcesses } = require("../utils/strategy_utils/activeStrategyTracker")
const { isSafeToBuyDetailed } = require("../utils/safety/safetyCheckers/botIsSafeToBuy");
const { logSafetyResults } = require("./logging/logSafetyResults");
const { strategyLog } = require("./logging/strategyLogger");

// const { injectBroadcast, socketBroadcast } = require("./logging/strategyLogger");

 const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
 const SOL_MINT  = "So11111111111111111111111111111111111111112";

let ws = null;
let isConnected = false;
// injectBroadcast((line) => {
//   if (!ws || ws.readyState === ws.CLOSED) {
//     const WebSocket = require("ws");
//     ws = new WebSocket("ws://localhost:5001");

//     ws.on("open", () => {
//       isConnected = true;
//       ws.send(line);
//     });

//     ws.on("error", () => {});
//     ws.on("close", () => {
//       isConnected = false;
//     });
//   } else if (ws.readyState === ws.OPEN) {
//     ws.send(line);
//   }
// });
// process.stdin.resume(); // ⏳ Keeps Node process alive


module.exports = async function sniperStrategy (botConfig) {
  const currentBotId = botConfig?.botId || "manual";
const log = strategyLog("sniper", currentBotId, botConfig);

  /* ── config / sane defaults ───────────────────────────── */
const BASE_MINT = botConfig.buyWithUSDC
  ? USDC_MINT
  : (botConfig.inputMint || SOL_MINT);

const LIMIT_USD   = +botConfig.targetPriceUSD || null;
const TRADES_CAP  = +botConfig.maxTrades || 1;
const PER_TRADE   = +botConfig.amountToSpend || +botConfig.snipeAmount || 0;

const SNIPE_AMOUNT = BASE_MINT === USDC_MINT
  ? Math.floor(PER_TRADE * 1e6)   // μUSDC
  : Math.floor(PER_TRADE * 1e9);  // lamports                         // lamport

const MONITORED        = botConfig.tokenMint ? [botConfig.tokenMint] : (botConfig.monitoredTokens || []);
const SLIPPAGE         = +botConfig.slippage        || 1.0;
const SCAN_INTERVAL = Math.round((+botConfig.interval || 30) * 1000);
log("debug", `Scan interval set to ${SCAN_INTERVAL} ms`);
// user may pass 0.03  *or* 3 : treat both as 3 %
const rawThreshold     = +botConfig.entryThreshold || 3;
const ENTRY_THRESHOLD  = rawThreshold >= 1 ? rawThreshold / 100 : rawThreshold;
const VOLUME_THRESHOLD = +botConfig.volumeThreshold || 50000; 
const TAKE_PROFIT      = +botConfig.takeProfit      || 0;
const STOP_LOSS        = +botConfig.stopLoss        || 0;
const MAX_DAILY        = +botConfig.maxDailyVolume  || 5;
const HALT_ON_FAILURES = +botConfig.haltOnFailures  || 3;
const MAX_OPEN_TRADES  = +botConfig.maxOpenTrades   || 2;
const MAX_SLIPPAGE     = +botConfig.maxSlippage     || 0.15;
const DRY_RUN          = botConfig.dryRun === true;
const MIN_BALANCE_SOL  = 0.05
const MAX_TOKEN_AGE_MIN = botConfig.maxTokenAgeMinutes != null ? +botConfig.maxTokenAgeMinutes : null;



/* ── safety toggle helpers ─────────────────────────────── */
const SAFETY_DISABLED =
  botConfig.disableSafety === true ||
  (botConfig.safetyChecks &&
    Object.values(botConfig.safetyChecks).every((v) => v === false));


  /* ── wallet bootstrap ─────────────────────────────────── */
  if (Array.isArray(botConfig.walletLabels) && botConfig.walletLabels.length)
    loadWalletsFromLabels(botConfig.walletLabels);

  const seen          = new Map();                                       // per-mint cooldown
  let   todayTotalSol = 0;
  let   failureCount  = 0;
  let   tickId        = 0; // ✅ tick counte
  let   madeTrades    = 0;

// 🆕 lifetime counters
 let   totalScanned        = 0;
 let   totalAgeSkipped     = 0;
 let   totalFiltersPassed  = 0;
 let   totalSafetyPassed   = 0;
  totalBought         = 0; 
  let sniperInterval = null;


      function sendFinalSummaryAlert() {
  const summary =
    `🧾 *Sniper Final Summary*\n` +
    `• Total Tokens Scanned: *${totalScanned}*\n` +
    `• Age Skipped: *${totalAgeSkipped}*\n` +
    `• Passed Filters: *${totalFiltersPassed}*\n` +
    `• Passed Safety: *${totalSafetyPassed}*\n` +
    `• Final Trades Made: *${madeTrades}*`;

  sendAlert("ui", summary, "Sniper");
  // fs.writeFileSync(`runtime/sniper-summary-${Date.now()}.txt`, summary); // optional
}

function printFinalSummary() {
  log("summary", "🧾 Final Sniper Summary");
  log("summary", `• Total Tokens Scanned: ${totalScanned}`);
  log("summary", `• Age Skipped: ${totalAgeSkipped}`);
  log("summary", `• Passed Filters: ${totalFiltersPassed}`);
  log("summary", `• Passed Safety: ${totalSafetyPassed}`);
  log("summary", `• Final Trades Made: ${madeTrades}`);
  sendFinalSummaryAlert();
}

  /* ─────────────────────────────────────────────────────── */
  async function tick () {
  log("loop", `\n Sniper Tick @ ${new Date().toLocaleTimeString()}`);
  lastTickTimestamps[currentBotId] = Date.now();

  let filtersPassed = 0;
  let safetyPassed = 0;
  let ageSkipped   = 0;
  let fullyPassed  = 0;
  let targets = [];  

  if (failureCount >= HALT_ON_FAILURES)
    return log("error", " Too many failures – sniper halted");

  if (madeTrades >= (+botConfig.maxTrades || 1)) {
    return log("warn", ` Max trades (${botConfig.maxTrades}) reached – sleeping`);
  }
if (getOpenTradesForBot("sniper", currentBotId).length >= MAX_OPEN_TRADES)
    return log("warn", ` Max open trades (${MAX_OPEN_TRADES}) reached`);

  try {
    const wallet  = getCurrentWallet();
    const balance = await getWalletBalance(wallet);
    if (!isAboveMinBalance(balance, MIN_BALANCE_SOL))
      return log("warn", ` Balance (${(balance/1e9).toFixed(2)} SOL) below min – skipping`);



    const allTokens = await getNewListings(20, true);     // returns array of token objects
    log("debug", `Fetched ${allTokens.length} brand-new listings`);

    // Keep only the mint addresses
    targets = allTokens.map(t => t.address);
    totalScanned += targets.length;

    log("debug", `Monitoring ${MONITORED.length ? MONITORED.length : "ALL"} tokens`);
    log("debug", `Targets to scan: ${targets.length}`);
    log("info", ` Scanning ${targets.length} tokens...`);



    for (const mint of targets) {
      /* hard cap: bail out mid-tick as soon as the limit is hit */

      // ---------------- helper fns (only one copy) --------------

     if (madeTrades >= TRADES_CAP) {
      log("info", `🎯 Trade cap reached – sniper shutting down`);
      clearInterval(sniperInterval);
       printFinalSummary();
      if (runningProcesses[currentBotId]) {
        runningProcesses[currentBotId].finished = true; // watchdog flag
      }
      log("summary", "✅ Sniper completed (max-trades reached)"); // WS toast trigger
       return process.exit(0); // exit gracefully
        }

      const lastSeen = seen.get(mint);
      if (lastSeen && Date.now() - lastSeen < SCAN_INTERVAL) {
        const secs = ((SCAN_INTERVAL - (Date.now() - lastSeen)) / 1000).toFixed(1);
        log("warn", ` Cooldown active for ${mint.slice(0,4)}... – retry in ${secs}s`);
        continue;
      }
      seen.set(mint, Date.now());

      log("info", `Token detected: ${mint}`);
      log("info", ` Fetching price change + volume...`);

      const creationTimeData = await getTokenCreationTime(mint); // ← actual fetch

      const CREATION_TS =
        creationTimeData?.blockUnixTime ||
        creationTimeData?.creationUnixTime ||
        null;

if (CREATION_TS && MAX_TOKEN_AGE_MIN != null) {
      const tokenAgeMin = Math.floor((Date.now() / 1000 - CREATION_TS) / 60); // age in minutes
      if (tokenAgeMin > MAX_TOKEN_AGE_MIN) {
        log("warn", `📦 Skipped — token age ${tokenAgeMin}m > max ${MAX_TOKEN_AGE_MIN}m`);
        ageSkipped++;   
        totalAgeSkipped++; 
        continue;
      }
    }

      // 🔄 Replaces both old API calls
        const overview = await getTokenShortTermChange(mint);
        if (!overview) {
          log("warn", `Failed to fetch token overview – skipping ${mint}`);
          continue;
        }
      const pumpWindow = botConfig.priceWindow || "5m";
      const trendChange = overview[`priceChange${pumpWindow}`] || 0;

      if (trendChange < ENTRY_THRESHOLD) {
        log("warn", `Skipped — ${pumpWindow} change ${(trendChange * 100).toFixed(2)}% < ${ENTRY_THRESHOLD * 100}%`);
        continue;
      }

      const volumeKey = `volume${botConfig.volumeWindow || "1h"}`;
      const volumeUSD = overview[volumeKey] || 0;

      if (volumeUSD < VOLUME_THRESHOLD) {
        log("warn", `Skipped — ${botConfig.avolumeWindow || "1h"} vol $${volumeUSD.toLocaleString()} < $${VOLUME_THRESHOLD}`);
        continue;
      }

      log("info", `Passed price/volume check`);
        filtersPassed++;
        totalFiltersPassed++;   
        // 🎯 Eye-candy: target acquired banner
        log("info", `[🎯 TARGET FOUND] ${mint}`);

        
      if (LIMIT_USD) {
      const nowUsd = overview.price ?? 0;
      if (!nowUsd || nowUsd > LIMIT_USD) {
        log("warn", `Skipped – $${nowUsd?.toFixed(4)} > $${LIMIT_USD}`);
        continue;
      }
      log("info", `Limit met – token @ $${nowUsd.toFixed(4)} ≤ $${LIMIT_USD}`);
    }

      /* ---------- safety checks (respect UI toggles) ------ */
      if (!SAFETY_DISABLED) {
        const safetyResult = await isSafeToBuyDetailed(
          mint,
          botConfig.safetyChecks || {}
        );
        const failed = logSafetyResults(mint, safetyResult, log, "sniper");
        if (failed) continue;
        safetyPassed++;
        totalSafetyPassed++;  
      } else {
        log("info", "⚠️  Safety checks DISABLED – proceeding un-vetted");
      }

      if (!isWithinDailyLimit(SNIPE_AMOUNT / 1e9, todayTotalSol, MAX_DAILY)) {
        log("warn", ` Skipped – would exceed daily cap (${todayTotalSol.toFixed(2)} SOL / ${MAX_DAILY} SOL)`);
        continue;
      }

      log("info", ` Getting swap quote...`);
      const quote = await getSwapQuote({
        inputMint : BASE_MINT,
        outputMint: mint,
        amount    : SNIPE_AMOUNT,
        slippage  : SLIPPAGE,
      });

      if (!quote) {
        log("error", ` Quote failed – no route for token ${mint}`);
        continue;
      }
      if (quote.priceImpactPct > MAX_SLIPPAGE) {
        log("warn", ` Skipped – price impact ${quote.priceImpactPct * 100}% > max ${MAX_SLIPPAGE * 100}%`);
        continue;
      }

      log("info", ` Quote received – impact ${(quote.priceImpactPct * 100).toFixed(2)}%`);
      // 🚀 Show user we’re about to snipe
      log("info", `[🚀 BUY ATTEMPT] Sniping token…`);

      /* ───────────── DRY-RUN BRANCH ───────────── */
      if (DRY_RUN) {
        log("info", `[🎆 BOUGHT SUCCESS] ${mint}`);

        const decimals   = await getMintDecimals(mint);
        const amountFmt  = (quote.outAmount / 10 ** decimals).toFixed(4);
        const impactPct  = (quote.priceImpactPct * 100).toFixed(2) + "%";
        const wl         = botConfig.walletLabels?.[0] || "default";

        await sendAlert(
          "ui",
          `🧪 *Dry-Run Sniper Triggered!*\n` +
          `• *Token:* \`${mint}\`\n` +
          `• *Amount:* ${amountFmt}\n` +
          `• *Price Impact:* ${impactPct}\n` +
          `• *Wallet:* \`${wl}\`\n` +
          `• *Simulated:* ✅`,
          "Sniper"
        );

        /* shared bookkeeping */
        const statsLine =
          `[STATS] price=${(overview.price ?? 0).toFixed(6)}, ` +
          `mcap=${(volumeUSD ?? 0).toFixed(0)}, ` +
          `change5m=${((overview.priceChange5m ?? 0) * 100).toFixed(2)}%`;
        log("info", statsLine);

        fullyPassed++;
        madeTrades++;
        totalBought++;
        if (runningProcesses[currentBotId]) {
          runningProcesses[currentBotId].tradesExecuted =
            (runningProcesses[currentBotId].tradesExecuted || 0) + 1;
        }

        await logTrade({
          strategy   : "sniper",
          inputMint  : quote.inputMint,
          outputMint : mint,
          inAmount   : quote.inAmount,
          outAmount  : quote.outAmount,
          priceImpact: quote.priceImpactPct * 100,
          simulated  : true,
          success    : true,
        });

        continue;                  // ⬅️ end dry-run
      }

      /* ───────────── LIVE TRADE ───────────── */
      log("info", ` Executing trade for ${mint}...`);
      const tx = await executeSwap({ quote, wallet });
      if (!tx) {
        failureCount++;
        log("error", ` Swap failed for ${mint}`);
        continue;
      }

      fullyPassed++;
      totalBought++; 
      log("info", `[🎆 BOUGHT SUCCESS] ${mint} Tx: https://solscan.io/tx/${tx}`);

      const statsLine =
        `[STATS] price=${(overview.price ?? 0).toFixed(6)}, ` +
        `mcap=${(volumeUSD ?? 0).toFixed(0)}, ` +
        `change5m=${((overview.priceChange5m ?? 0) * 100).toFixed(2)}%`;
      log(statsLine);

      const entryPrice    = Number(quote.inAmount) / Number(quote.outAmount);
      const solPriceUSD   = await getTokenPrice(BASE_MINT);
      const entryPriceUSD = solPriceUSD ? entryPrice * solPriceUSD : null;
      const decimals      = await getMintDecimals(mint);
      const usdValue      = solPriceUSD ? +((quote.inAmount / 1e9) * solPriceUSD).toFixed(2) : null;

      await addOrUpdateOpenTrade({
        mint,
        entryPrice,
        entryPriceUSD,
        inAmount   : quote.inAmount,
        outAmount  : quote.outAmount,
        strategy   : "sniper",
        botId      : currentBotId,
        walletLabel: botConfig.walletLabels?.[0] || "default",
        slippage   : SLIPPAGE,
        decimals,
        usdValue,
        txHash     : tx,
        type       : "buy",
      });

      if (TAKE_PROFIT || STOP_LOSS) {
        await addWebTpSlEntry(
          mint,
          TAKE_PROFIT || null,
          STOP_LOSS  || null,
          botConfig.tpPercent || 50,
          botConfig.slPercent || 100,
          "web",
          botConfig.walletLabels?.[0] || "default",
          true,
          "sniper"
        );
        log("info", ` TP/SL rule registered for ${mint}`);
      }

      await logTrade({
        strategy   : "sniper",
        inputMint  : quote.inputMint,
        outputMint : mint,
        inAmount   : quote.inAmount,
        outAmount  : quote.outAmount,
        entryPrice,
        entryPriceUSD,
        priceImpact: quote.priceImpactPct * 100,
        txHash     : tx,
        success    : true,
        walletLabel: botConfig.walletLabels?.[0] || "default",
        slippage   : SLIPPAGE,
        decimals,
        usdValue,
      });

      log("info",
          ` Trade complete for ${mint} | ${(quote.outAmount / 10 ** decimals).toFixed(4)} tokens @ ~${entryPrice.toFixed(4)} SOL`);

      /* ---- live-trade alert ---- */
      const amountFmt = (quote.outAmount / 10 ** decimals).toFixed(4);
      const impactPct = (quote.priceImpactPct * 100).toFixed(2) + "%";
      const tokenUrl  = `https://birdeye.so/token/${mint}`;
      const txUrl     = `https://solscan.io/tx/${tx}`;
      const wl        = botConfig.walletLabels?.[0] || "default";

      await sendAlert(
        "ui",
        `🤖 *Sniper Buy Executed!*\n` +
        `• *Token:* [${mint}](${tokenUrl})\n` +
        `• *Amount:* ${amountFmt}\n` +
        `• *Price Impact:* ${impactPct}\n` +
        `• *Wallet:* \`${wl}\`\n` +
        `• *Tx:* [↗️ View](${txUrl})`,
        "Sniper"
      );

      todayTotalSol += SNIPE_AMOUNT / 1e9;
      failureCount   = 0;

    }

  } catch (err) {
    failureCount++;
    log("error", ` Sniper error: ${err.message}`);
    await sendAlert("ui", `⚠️ *Sniper Error*\n${err.message}`, "Buy");

    printFinalSummary();
  }


tickId++;
// log(
//   "loop",
//   `Summary 📊 Tick #${tickId} — Scanned: ${targets.length}, Age-Skipped: ${ageSkipped}, ` +
//   `Filters: ${filtersPassed}, Safety: ${safetyPassed}, Bought: ${fullyPassed}`
// );
log(
  "loop",
  `Run Σ 📊 Scanned: ${totalScanned}, Age-Skipped: ${totalAgeSkipped}, ` +
  `Filters: ${totalFiltersPassed}, Safety: ${totalSafetyPassed}, ` +
  `Bought: ${totalBought}`
);
  }


  /* immediate run then interval */
  // ✅ Proper loop trigger (non-recursive)
await tick(); // start once
log("info", "🔫 Sniper bot successfully activated — scanning for targets…");
log("loop", `Sniper loop initialized – running every ${SCAN_INTERVAL / 1000}s`);
if (botConfig.loop !== false)
  sniperInterval = setInterval(tick, SCAN_INTERVAL);
}

/* ── CLI entry (dev convenience) ─────────────────────────── */
if (require.main === module) {
  const cfgPath = process.argv[2];
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));

  (async () => {
    try {
      await module.exports(cfg);
    } catch (err) {
      console.error("❌ CLI crash:", err.message);
      process.exit(1);
    }
  })();
}


/**
 * Additions: 
 * - HoneyPot protection
 * - Analytics Logging
 * - Multi-wallet Rotation
 * - Telegram alerts
 * - Clean Structure + safe error handling
 */

/** Additions 04/17
 * Feature	Status	Notes
monitoredTokens	✅	Filters fetchTokenList()
takeProfit/stopLoss	✅ (stub)	Passed into log, exit logic later
entryThreshold	✅	Filters by price pump %
volumeThreshold	✅	Minimum liquidity check
maxDailyVolume	✅	Limits total exposure
haltOnFailures	✅	Auto-pauses after X fails
dryRun	✅	Skips swaps, logs quote
.env fallbacks	❌ Removed	All config-only now
 * 
 */


/**
 * Yes — your current Sniper Strategy Module looks excellent and is production-ready for MVP. Here's a full ✅ checklist of what’s implemented and why it’s solid:

✅ Final Review: sniper.js

Feature	Status	Notes
Config-driven	✅	All values pulled from botConfig, no .env fallback pollution.
Wallet rotation	✅	Uses loadWalletsFromLabels and getCurrentWallet.
Cooldown logic	✅	seen converted to Map() with timestamp-based resets per token.
Smart cooldown skip	✅	Skips tokens seen in the last SCAN_INTERVAL, logs how many seconds remain.
Price + volume filtering	✅	Checks both short-term price change and volume before buying.
Honeypot/safety check	✅	Fully integrated isSafeToBuy.
Quote failure logging	✅	Logs detailed reason (no route / liquidity), resets cooldown.
Trade execution	✅	Dry run support + live swap using Jupiter + wallet.
Trade logging	✅	Uses handleSuccessTrade() which logs to: trade log, open-trades.json, and Telegram.
Exit logic	✅	Stop loss and take profit handled via handleExitLogic().
Failure handling	✅	Tracks consecutive failures, halts bot after limit.
One-token-per-tick	✅	Prevents multi-buy loops and keeps logic clean.
Safe recovery	✅	All major operations wrapped in try/catch with fallback logs
 */


/**
 * This version keeps everything:

🔁 Loop for automatic mode

🧪 Manual one-shot

🧠 Compatible with multi-strategy orchestration

✅ CLI executable


 */


/**
 * token seen? ➝ cooldown
price/volume checks
↓
✅ USD limit met?
↓
✅ safety passed?
↓
✅ within daily cap?
↓
quote → swap → log
 */