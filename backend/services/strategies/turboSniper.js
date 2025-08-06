/* backend/services/strategies/sniper.js
 *
 * Simplified sniper strategy extended with turbo mode and automatic risk
 * management. This file is based off the original sniper strategy in the
 * repository but only includes the pieces necessary to demonstrate how
 * turbo mode and auto‑tuning are integrated. For a full view of the
 * original strategy logic (token feed handling, safety checks, etc.)
 * consult the upstream repository.
 */

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

/* core helpers */
const wm                       = require("./core/walletManager");
const guards                   = require("./core/tradeGuards");
const createCooldown           = require("./core/cooldown");
const { getSafeQuote }         = require("./core/quoteHelper");
// Import the trade executor. In this simplified integration the same
// executor is used for live and simulated runs. In a full build the
// executor exposes separate liveBuy and simulateBuy functions.
const execTrade = require("./core/tradeExecutor");
const { passes, explainFilterFail }               = require("./core/passes");
const { createSummary, tradeExecuted }        = require("./core/alerts");
const runLoop                  = require("./core/loopDriver");
const { initTxWatcher }        = require("./core/txTracker");

/* misc utils */
const { getWalletBalance,  isAboveMinBalance, } = require("../utils");
const { sendAlert }            = require("../../telegram/alerts");

/* import our new risk manager */
const { autoTuneRisk }         = require("../../utils/riskManager");

/* constants */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT  = "So11111111111111111111111111111111111111112";

module.exports = async function sniperStrategy(botCfg = {}) {
  console.log(" sniperStrategy loaded", botCfg);
  const limitBirdeye = pLimit(2);
  const botId = botCfg.botId || "manual";
  const log   = strategyLog("sniper", botId, botCfg);

  /* ── derive base config values ── */
  const BASE_MINT        = botCfg.buyWithUSDC ? USDC_MINT : (botCfg.inputMint || SOL_MINT);
  const LIMIT_USD        = +botCfg.targetPriceUSD || null;
  // snipeAmount and amountToSpend are in SOL or USDC units; convert to lamports
  let SNIPE_LAMPORTS   = (+botCfg.snipeAmount || +botCfg.amountToSpend || 0) *
                          (BASE_MINT === USDC_MINT ? 1e6 : 1e9);
  const ENTRY_THRESHOLD  = (+botCfg.entryThreshold >= 1 ? +botCfg.entryThreshold / 100 : +botCfg.entryThreshold) || 0.03;
  const VOLUME_THRESHOLD = +botCfg.volumeThreshold || 50_000;
  const SLIPPAGE         = +botCfg.slippage        || 1.0;
  const MAX_SLIPPAGE     = +botCfg.maxSlippage     || 0.15;
  const INTERVAL_MS      = Math.round((+botCfg.interval || 30) * 1_000);
  let TAKE_PROFIT      = +botCfg.takeProfit      || 0;
  let STOP_LOSS        = +botCfg.stopLoss        || 0;
  const MAX_DAILY_SOL    = +botCfg.maxDailyVolume  || 9999;
  const MAX_OPEN_TRADES  = +botCfg.maxOpenTrades   || 9999;
  const MAX_TRADES       = +botCfg.maxTrades       || 9999;
  const HALT_ON_FAILS    = +botCfg.haltOnFailures  || 3;
  const MIN_BALANCE_SOL = 0.05;
  const MAX_TOKEN_AGE_MIN= botCfg.maxTokenAgeMinutes != null ? +botCfg.maxTokenAgeMinutes : null;
  const MIN_TOKEN_AGE_MIN= botCfg.minTokenAgeMinutes != null ? +botCfg.minTokenAgeMinutes : null;
  const MIN_MARKET_CAP   = botCfg.minMarketCap != null ? +botCfg.minMarketCap : null;
  const MAX_MARKET_CAP   = botCfg.maxMarketCap != null ? +botCfg.maxMarketCap : null;
  const DRY_RUN          = botCfg.dryRun === true;
  // Use a unified execBuy function. In the simplified implementation we
  // delegate both simulated and live trades to execTrade. A full
  // implementation would choose between simulateBuy and liveBuy.
  const execBuy = async ({ quote, mint, meta }) => {
    return await execTrade({ quote, mint, meta, simulated: DRY_RUN });
  };
  let COOLDOWN_MS    = botCfg.cooldown != null ? +botCfg.cooldown * 1000 : 60_000;
  const DELAY_MS     = +botCfg.delayBeforeBuyMs || 0;
  const PRIORITY_FEE = +botCfg.priorityFeeLamports || 0;
  const SAFETY_DISABLED = botCfg.disableSafety === true || (botCfg.safetyChecks && Object.values(botCfg.safetyChecks).every(v => v === false));

  /* ── new flags for turbo and auto risk ── */
  const TURBO_MODE       = botCfg.turboMode === true;
  const AUTO_RISK        = botCfg.autoRiskManage === true;
  const PRIVATE_RPC_URL  = botCfg.privateRpcUrl || process.env.PRIVATE_SOLANA_RPC_URL;

  /* ── apply auto risk adjustments at startup ── */
  if (AUTO_RISK) {
    try {
      const adj = await autoTuneRisk(botCfg, BASE_MINT);
      if (adj && typeof adj === 'object') {
        if (adj.amountLamports) {
          SNIPE_LAMPORTS = adj.amountLamports;
        }
        if (adj.cooldownMs) {
          COOLDOWN_MS = adj.cooldownMs;
        }
        if (adj.takeProfit != null) {
          TAKE_PROFIT = adj.takeProfit;
        }
        if (adj.stopLoss != null) {
          STOP_LOSS = adj.stopLoss;
        }
        log("info", `[AUTO RISK] factor=${(adj.riskFactor || 1).toFixed(2)}, ROI=${((adj.avgRoi || 0)*100).toFixed(2)}%, volatility=${((adj.volatility || 0)*100).toFixed(2)}%`);
      }
    } catch (err) {
      log("warn", `Auto risk tuning failed: ${err.message}`);
    }
  }

  /* initialise cooldown and other state */
  const cd        = createCooldown(COOLDOWN_MS);
  const summary   = createSummary("Sniper",  log, botCfg.userId);
  let   todaySol  = 0;
  let   trades    = 0;
  let   fails     = 0;

  /* start background confirmation loop */
  log("info", ` Loading single wallet from DB (walletId: ${botCfg.walletId})`);
  await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
  initTxWatcher("Sniper");

  /* ── simplified tick ── */
  async function tick() {
    if (trades >= MAX_TRADES) return;
    log("loop", `\n Sniper Tick @ ${new Date().toLocaleTimeString()}`);
    lastTickTimestamps[botId] = Date.now();
    log("info", `[CONFIG] DELAY_MS: ${DELAY_MS}, PRIORITY_FEE: ${PRIORITY_FEE}, MAX_SLIPPAGE: ${MAX_SLIPPAGE}`);

    try {
      // Basic trade guard checks
      guards.assertTradeCap(trades, MAX_TRADES);
      guards.assertOpenTradeCap("sniper", botId, MAX_OPEN_TRADES);
      await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
      if (!(await wm.ensureMinBalance(MIN_BALANCE_SOL, getWalletBalance, isAboveMinBalance))) {
        log("warn", "Balance below min – skipping");
        return;
      }

      // Placeholder: In the full implementation this would resolve which
      // token to buy (based on feeds, filters, etc.). For brevity we skip
      // those details and assume `mint` and `overview` are provided.
      const mint = botCfg.mint;
      if (!mint) {
        log("warn", "No target mint specified in simplified demo config");
        return;
      }

      // Fetch a safe quote
      log("info", "Getting swap quote…");
      const result = await getSafeQuote({
        inputMint    : BASE_MINT,
        outputMint   : mint,
        amount       : SNIPE_LAMPORTS,
        slippage     : SLIPPAGE,
        maxImpactPct : MAX_SLIPPAGE,
      });
      if (!result.ok) {
        log("warn", `❌ Quote failed: ${result.reason} — ${result.message}`);
        return;
      }
      const quote = result.quote;
      if (PRIORITY_FEE > 0) {
        quote.prioritizationFeeLamports = PRIORITY_FEE;
        log("info", `Adding priority fee of ${PRIORITY_FEE} lamports`);
      }
      quote.priceImpactPct = Number(quote.priceImpactPct);
      log("info", `Quote received – impact ${(quote.priceImpactPct * 100).toFixed(2)}%`);

      // Build meta with turbo fields
      const meta = {
        strategy        : "Sniper",
        walletId        : botCfg.walletId,
        userId          : botCfg.userId,
        slippage        : SLIPPAGE,
        category        : "Sniper",
        tpPercent       : botCfg.tpPercent ?? TAKE_PROFIT,
        slPercent       : botCfg.slPercent ?? STOP_LOSS,
        tp              : botCfg.takeProfit,
        sl              : botCfg.stopLoss,
        botId           : botId,
        priorityFeeLamports: PRIORITY_FEE,
        turboMode       : TURBO_MODE,
        privateRpcUrl   : PRIVATE_RPC_URL,
        skipPreflight   : TURBO_MODE,
      };

      let txHash;
      try {
        log("info", "[ BUY ATTEMPT] Sniping token…");
        txHash = await execBuy({ quote, mint, meta });
      } catch (err) {
        log("error", "❌ execBuy failed:");
        log("error", err?.message || String(err));
        fails++;
        return;
      }
      const buyMsg  = DRY_RUN
        ? `[ BOUGHT SUCCESS] ${mint}`
        : `[ BOUGHT SUCCESS] ${mint} Tx: https://solscan.io/tx/${txHash}`;
      log("info", buyMsg);
      todaySol += SNIPE_LAMPORTS / 1e9;
      trades++;
      summary.inc("buys");
      cd.hit(mint);
      if (trades >= MAX_TRADES) {
        log("info", " Trade cap reached – sniper shutting down");
        await summary.printAndAlert("Sniper");
        log("summary", "✅ Sniper completed (max-trades reached)");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        process.exit(0);
      }
    } catch (err) {
      if (/insufficient.*lamports|insufficient.*balance/i.test(err.message)) {
        log("error", " Not enough SOL – sniper shutting down");
        await summary.printAndAlert("Sniper halted: insufficient SOL");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        return;
      }
      fails++;
      if (fails >= HALT_ON_FAILS) {
        log("error", " Error limit hit — sniper shutting down");
        await summary.printAndAlert("Sniper halted on errors");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        return;
      }
      summary.inc("errors");
      log("error", err?.message || String(err));
    }
  }

  // start the loop
  const loopHandle = runLoop(tick, INTERVAL_MS, {
    label: "sniper",
    botId,
  });
};