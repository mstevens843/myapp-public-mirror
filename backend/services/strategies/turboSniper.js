/* backend/services/strategies/sniper.js  – Turbo-ready (updated)
 * ------------------------------------------------------------------
 *  • Keeps swap path ultra-fast (tradeExecutorTurbo)
 *  • Restores advanced flags and plumbs Turbo extras end-to-end:
 *        – ghostMode / coverWalletId
 *        – autoRug
 *        – prewarmAccounts
 *        – multiBuy 1-3 parallel routes
 *        – useJitoBundle / jitoTipLamports / jitoRelayUrl
 *        – autoPriorityFee OR fixed priorityFeeLamports
 *        – routing prefs: multiRoute / splitTrade / allowedDexes / excludedDexes
 *        – rpcEndpoints failover + rpcMaxErrors
 *        – killSwitch / killThreshold
 *        – poolDetection flag
 *        – exits: tpLadder, trailingStopPct
 *  • All post-swap work (ghost forward, rug-exit, TP/SL, alerts) is
 *    handled inside turboTradeExecutor; we just pass the meta flags.
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
const execTrade                = require("./core/tradeExecutorTurbo"); // <-- turbo executor
const { passes }               = require("./core/passes");
const { createSummary }        = require("./core/alerts");
const runLoop                  = require("./core/loopDriver");
const { initTxWatcher }        = require("./core/txTracker");

/* Ghost utils + quote for multi-buy */
const { prewarmTokenAccount }  = require("../../utils/ghost");
const { Connection }           = require("@solana/web3.js");
const { getSwapQuote }         = require("../../utils/swap");

/* misc utils */
const { getWalletBalance,  isAboveMinBalance, } = require("../utils");

/* constants */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT  = "So11111111111111111111111111111111111111112";

/* helpers */
function normalizeList(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    return val.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
}
function normalizeNumber(val, fallback = 0) {
  const n = +val;
  return Number.isFinite(n) ? n : fallback;
}

module.exports = async function turboSniperStrategy(botCfg = {}) {
  const limitBirdeye = pLimit(2);
  const botId = botCfg.botId || "manual";
  const log   = strategyLog("sniper", botId, botCfg);

  /* ── config ───────────────────────────────────────── */
  const BASE_MINT        = botCfg.buyWithUSDC ? USDC_MINT : (botCfg.inputMint || SOL_MINT);
  const LIMIT_USD        = +botCfg.targetPriceUSD || null;
  let   SNIPE_LAMPORTS   = (+botCfg.snipeAmount || +botCfg.amountToSpend || 0) *
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
  const MIN_BALANCE_SOL  = 0.05;
  const MAX_TOKEN_AGE_MIN= botCfg.maxTokenAgeMinutes != null ? +botCfg.maxTokenAgeMinutes : null;
  const MIN_TOKEN_AGE_MIN= botCfg.minTokenAgeMinutes != null ? +botCfg.minTokenAgeMinutes : null;
  const MIN_MARKET_CAP   = botCfg.minMarketCap != null ? +botCfg.minMarketCap : null;
  const MAX_MARKET_CAP   = botCfg.maxMarketCap != null ? +botCfg.maxMarketCap : null;
  const DRY_RUN          = botCfg.dryRun === true;

  /* ── turbo + perf flags (from turbo wrapper defaults) ──────────────── */
  // fees
  const PRIORITY_FEE       = normalizeNumber(botCfg.priorityFeeLamports, 0);
  const AUTO_PRIORITY_FEE  = botCfg.autoPriorityFee === true;

  // Jito
  const USE_JITO_BUNDLE    = botCfg.useJitoBundle === true;
  const JITO_TIP_LAMPORTS  = normalizeNumber(botCfg.jitoTipLamports, 0);
  const JITO_RELAY_URL     = botCfg.jitoRelayUrl || null;

  // routing
  const MULTI_ROUTE        = botCfg.multiRoute === true;
  const SPLIT_TRADE        = botCfg.splitTrade === true;
  const ALLOWED_DEXES      = normalizeList(botCfg.allowedDexes);
  const EXCLUDED_DEXES     = normalizeList(botCfg.excludedDexes);

  // rpc failover & safety
  const RPC_ENDPOINTS      = normalizeList(botCfg.rpcEndpoints);
  const RPC_MAX_ERRORS     = normalizeNumber(botCfg.rpcMaxErrors, 3);
  const KILL_SWITCH        = botCfg.killSwitch === true;
  const KILL_THRESHOLD     = normalizeNumber(botCfg.killThreshold, 3);
  const POOL_DETECTION     = botCfg.poolDetection === true;

  // exits
  const TP_LADDER          = normalizeList(botCfg.tpLadder);
  const TRAILING_STOP_PCT  = (botCfg.trailingStopPct != null) ? +botCfg.trailingStopPct : 0;

  // turbo QoL
  const TURBO_MODE         = true; // always true here
  const PRIVATE_RPC_URL    = botCfg.privateRpcUrl || process.env.PRIVATE_SOLANA_RPC_URL;

  /* advanced flags (restored) */
  const GHOST_MODE       = botCfg.ghostMode === true;
  const COVER_WALLET_ID  = botCfg.coverWalletId || null;
  const AUTO_RUG         = botCfg.autoRug === true;
  const PREWARM_ACCS     = botCfg.prewarmAccounts === true;
  const MULTI_BUY        = botCfg.multiBuy === true;
  const MULTI_BUY_COUNT  = Math.max(1, parseInt(botCfg.multiBuyCount || 0));
  const DELAY_MS         = +botCfg.delayBeforeBuyMs || 0;

  /* cooldown & summary */
  const COOLDOWN_MS  = (+botCfg.cooldown || 60) * 1000;
  const cd        = createCooldown(COOLDOWN_MS);
  const summary   = createSummary("Sniper-Turbo", log, botCfg.userId);

  let todaySol = 0, trades = 0, fails = 0;
  const EFFECTIVE_HALT = KILL_SWITCH ? KILL_THRESHOLD : HALT_ON_FAILS;

  await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
  initTxWatcher("Sniper-Turbo");

  /* ── TICK ────────────────────────────────────────── */
  async function tick() {
    if (trades >= MAX_TRADES) return;
    lastTickTimestamps[botId] = Date.now();

    try {
      guards.assertTradeCap(trades, MAX_TRADES);
      guards.assertOpenTradeCap("sniper", botId, MAX_OPEN_TRADES);
      await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
      if (!(await wm.ensureMinBalance(MIN_BALANCE_SOL, getWalletBalance, isAboveMinBalance))) {
        return;
      }

      /* token feed resolution (kept minimal for perf) */
      const mint = botCfg.mint || (await resolveTokenFeed("sniper", botCfg))[0];
      if (!mint) return;

      /* filters / passes */
      const res = await limitBirdeye(() =>
        passes(mint, {
          entryThreshold     : ENTRY_THRESHOLD,
          volumeThresholdUSD : VOLUME_THRESHOLD,
          pumpWindow         : botCfg.priceWindow  || "5m",
          volumeWindow       : botCfg.volumeWindow || "1h",
          limitUsd           : LIMIT_USD,
          minMarketCap       : MIN_MARKET_CAP,
          maxMarketCap       : MAX_MARKET_CAP,
          // (token age filters can be added in passes() impl if supported)
          dipThreshold       : null,
          volumeSpikeMult    : null,
          fetchOverview      : (m) =>
            getTokenShortTermChange(null, m, "5m", "1h"),
        })
      );
      if (!res?.ok) return;

      /* safety check */
      if (!(botCfg.disableSafety === true)) {
        const safeRes = await isSafeToBuyDetailed(mint, botCfg.safetyChecks || {});
        if (logSafetyResults(mint, safeRes, log, "sniper-turbo")) return;
      }

      guards.assertDailyLimit(SNIPE_LAMPORTS / 1e9, todaySol, MAX_DAILY_SOL);

      /* quote helper */
      const quoteRes = await getSafeQuote({
        inputMint    : BASE_MINT,
        outputMint   : mint,
        amount       : SNIPE_LAMPORTS,
        slippage     : SLIPPAGE,
        maxImpactPct : MAX_SLIPPAGE,
      });
      if (!quoteRes.ok) return;
      const baseQuote = quoteRes.quote;

      if (PRIORITY_FEE > 0) {
        baseQuote.prioritizationFeeLamports = PRIORITY_FEE;
      }
      // If AUTO_PRIORITY_FEE is true, executor will compute best fee; we only pass the flag.

      /* meta for executor */
      const baseMeta = {
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

        // turbo / fees
        turboMode       : TURBO_MODE,
        privateRpcUrl   : PRIVATE_RPC_URL,
        skipPreflight   : TURBO_MODE,
        priorityFeeLamports: PRIORITY_FEE,
        autoPriorityFee : AUTO_PRIORITY_FEE,

        // Jito / relay
        useJitoBundle   : USE_JITO_BUNDLE,
        jitoTipLamports : JITO_TIP_LAMPORTS,
        jitoRelayUrl    : JITO_RELAY_URL,

        // routing & dex prefs
        multiRoute      : MULTI_ROUTE,
        splitTrade      : SPLIT_TRADE,
        allowedDexes    : ALLOWED_DEXES,
        excludedDexes   : EXCLUDED_DEXES,

        // rpc failover & safety
        rpcEndpoints    : RPC_ENDPOINTS,
        rpcMaxErrors    : RPC_MAX_ERRORS,
        killSwitch      : KILL_SWITCH,
        killThreshold   : KILL_THRESHOLD,
        poolDetection   : POOL_DETECTION,

        // exits
        tpLadder        : TP_LADDER,
        trailingStopPct : TRAILING_STOP_PCT,

        // advanced
        ghostMode       : GHOST_MODE,
        coverWalletId   : COVER_WALLET_ID,
        autoRug         : AUTO_RUG,
        prewarmAccounts : PREWARM_ACCS,
      };

      /* optional delay before buy */
      if (DELAY_MS > 0) await new Promise(r => setTimeout(r, DELAY_MS));

      /* optional pre-warm */
      if (PREWARM_ACCS) {
        try {
          const conn = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
          const currentWallet = wm.current();
          await prewarmTokenAccount(conn, baseQuote.outputMint, currentWallet);
        } catch (_) {/* ignore */}
      }

      /* Multi-buy logic (max 3) */
      let txHash;
      if (MULTI_BUY && MULTI_BUY_COUNT > 1) {
        const attempt = Math.min(MULTI_BUY_COUNT, 3);
        const slips = Array.from({ length: attempt }).map((_, i) =>
          +(SLIPPAGE + (i / (attempt - 1 || 1)) * (MAX_SLIPPAGE - SLIPPAGE)).toFixed(4)
        );
        const tasks = slips.map(async (s) => {
          try {
            const q = await getSwapQuote({
              inputMint : baseQuote.inputMint,
              outputMint: baseQuote.outputMint,
              amount    : baseQuote.inAmount,
              slippage  : s,
            });
            if (q) {
              return await execTrade({
                quote: { ...q, prioritizationFeeLamports: PRIORITY_FEE },
                mint,
                meta : { ...baseMeta, slippage: s },
                simulated: DRY_RUN,
              });
            }
          } catch { return null; }
          return null;
        });
        for (const p of tasks) {
          const sig = await p;
          if (sig) { txHash = sig; break; }
        }
      } else {
        txHash = await execTrade({
          quote: baseQuote,
          mint,
          meta : baseMeta,
          simulated: DRY_RUN,
        });
      }

      if (txHash) {
        trades++; todaySol += SNIPE_LAMPORTS / 1e9;
        cd.hit(mint);
      }
      if (trades >= MAX_TRADES) {
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
      }
    } catch (err) {
      fails++;
      if (fails >= EFFECTIVE_HALT) {
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
      }
    }
  }

  /* scheduler */
  const loopHandle = runLoop(tick, INTERVAL_MS, { label: "sniper-turbo", botId });
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
