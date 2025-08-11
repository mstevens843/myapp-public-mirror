// backend/services/strategies/turboSniper.js
//
// Entry point for the Turbo Sniper strategy. Wires together
// configuration, executor, pump.fun listener and airdrop sniffer.
// Individual components are kept small so that the main strategy
// file remains easy to audit. All asynchronous work is pushed
// outside of the synchronous hot path. To start the strategy
// instantiate TurboSniper with a connection, validator identity
// and configuration then call `start()`.

'use strict';

const { Connection, clusterApiUrl } = require('@solana/web3.js');
const TradeExecutorTurbo = require('./core/tradeExecutorTurbo');
const pumpfunListener = require('./pumpfun/listener');
const airdropSniffer = require('./airdrops/sniffer');
const { incCounter, observeHistogram } = require('./logging/metrics');

/**
 * Lightweight orchestrator wrapping the turbo trade executor, pump.fun
 * listener and airdrop sniffer. This class is intended for simple
 * integrations where you want to snipe pump events or auto‑sell
 * airdrops with minimal configuration. More advanced usage such as
 * automated token selection, safety checks and iceberg orders can
 * leverage the `turboSniperStrategy` function exported from this
 * module.
 */
class TurboSniper {
  /**
   * Construct a new Turbo Sniper strategy.
   *
   * @param {Object} opts
   * @param {Connection} [opts.connection] Solana connection. If omitted a new connection
   *   will be created using clusterApiUrl('mainnet-beta').
   * @param {string} opts.validatorIdentity The public key of your validator for leader scheduling.
   * @param {Object} opts.config Strategy configuration. See TurboSniperConfig.jsx for defaults.
   * @param {string[]} opts.walletIds Wallets to sniff for airdrops.
   */
  constructor({ connection, validatorIdentity, config, walletIds = [] }) {
    this.connection = connection || new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');
    this.config = config || {};
    this.walletIds = walletIds;
    this.executor = new TradeExecutorTurbo({ connection: this.connection, validatorIdentity });
    this.running = false;
  }

  /**
   * Start the strategy. Listens for pumpfun events and kicks off
   * airdrop sniffing. Consumer code is expected to call
   * `stop()` when finished.
   */
  start() {
    if (this.running) return;
    this.running = true;
    const cfg = this.config;
    // Start pumpfun listener if enabled
    if (cfg.pumpfun && cfg.pumpfun.enabled) {
      pumpfunListener.on('snipe', async (event) => {
        // On pump event, attempt to snipe using our executor. The
        // trade parameters should be derived from strategy config
        // (e.g. notional size, slippage). Here we use a simple
        // example that buys a fixed amount of SOL worth of the mint.
        const tradeParams = {
          inputMint: cfg.inputMint || 'So11111111111111111111111111111111111111112',
          outputMint: event.mint,
          amount: cfg.notionalAmount || 1 * 10 ** 9, // lamports
          slippage: cfg.slippage || 0.5,
        };
        const userCtx = { userId: cfg.userId || 'pumpfun', walletId: this.walletIds[0] || '0' };
        try {
          await this.executor.executeTrade(userCtx, tradeParams, cfg);
        } catch (e) {
          // Log and continue
        }
      });
      pumpfunListener.start(cfg.pumpfun);
    }
    // Start airdrop sniffer if enabled
    if (cfg.airdrops && cfg.airdrops.enabled) {
      airdropSniffer.start({
        connection: this.connection,
        walletIds: this.walletIds,
        config: cfg.airdrops,
        sellFn: async ({ walletId, mint, amount, idKey, maxSlippage }) => {
          // Leverage executor to perform safe sell; reuse same userCtx but switch input/output
          const tradeParams = { inputMint: mint, outputMint: cfg.inputMint || 'So11111111111111111111111111111111111111112', amount, slippage: maxSlippage };
          const userCtx = { userId: cfg.userId || 'airdrop', walletId };
          await this.executor.executeTrade(userCtx, tradeParams,Object.assign({}, cfg, {
  idempotencyTtlSec: (cfg.idempotency?.ttlSec ?? cfg.idempotencyTtlSec ?? 300)
}));
        },
      });
    }
  }

  /**
   * Stop the strategy and cleanup subscriptions.
   */
  stop() {
    if (!this.running) return;
    this.running = false;
    pumpfunListener.stop();
    airdropSniffer.stop();
  }
}

// Export the orchestrator class on module.exports. The heavy
// strategy runner is attached below as a named export.
module.exports.TurboSniper = TurboSniper;

/*
 * ------------------------------------------------------------------
 * turboSniper.js  – Turbo-ready (updated)
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
// Import the turbo executor's `execTrade` helper from the wrapper.  The
// default export is now a class (see core/tradeExecutorTurbo.js), so we
// destructure the named export to retain function semantics.  Without
// destructuring this would instead resolve to the class itself.
const { execTrade }            = require("./core/tradeExecutorTurbo"); // <-- turbo executor
const { passes }               = require("./core/passes");
const { createSummary }        = require("./core/alerts");
const runLoop                  = require("./core/loopDriver");
const { initTxWatcher }        = require("./core/txTracker");
const createTokenResolver       = require("./core/tokenResolver");

// New core helpers
const { startPoolListener, stopPoolListener } = require("./core/poolCreateListener");
const metricsLogger = require("./logging/metrics");

/* Ghost utils + quote for multi-buy */
const { prewarmTokenAccount }  = require("./core/ghost");
const { Connection: Web3Connection }           = require("@solana/web3.js");
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

async function turboSniperStrategy(botCfg = {}) {
  const limitBirdeye = pLimit(2);
  const botId = botCfg.botId || "manual";
  const log   = strategyLog("sniper", botId, botCfg);

  /* ── config ──────────────────────────────────────────────────── */
  const BASE_MINT        = botCfg.buyWithUSDC ? USDC_MINT : (botCfg.inputMint || SOL_MINT);
  const LIMIT_USD        = +botCfg.targetPriceUSD || null;
  let   SNIPE_LAMPORTS   = (+botCfg.snipeAmount || +botCfg.amountToSpend || 0) *
                           (BASE_MINT === USDC_MINT ? 1e6 : 1e9);
  const ENTRY_THRESHOLD  = (+botCfg.entryThreshold >= 1
                              ? +botCfg.entryThreshold / 100
                              : +botCfg.entryThreshold) || 0.03;
  const VOLUME_THRESHOLD = +botCfg.volumeThreshold || 50_000;
  let SLIPPAGE           = +botCfg.slippage        || 1.0;
  let MAX_SLIPPAGE       = +botCfg.maxSlippage     || 0.15;
  // Fix slippage fan bug: ensure MAX_SLIPPAGE ≥ SLIPPAGE
  if (MAX_SLIPPAGE < SLIPPAGE) {
    // Increase max slippage proportionally; default multiplier 1.5x
    MAX_SLIPPAGE = SLIPPAGE * 1.5;
  }
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

  /*
   * ------------------------------------------------------------------
   * Custom prompt‑added configuration overrides
   *
   * The following overrides map new frontend fields into existing
   * backend configuration properties.  They enable optional features
   * like leader alignment, multi‑wallet fills and static stop losses
   * without modifying the rest of the strategy logic.  If the user
   * supplies one of these fields it will take precedence over the
   * existing defaults.
   */

  // Enable leader timing when alignToLeader is true.  This flips
  // leaderTiming.enabled on regardless of other settings.
  if (botCfg.alignToLeader) {
    botCfg.leaderTiming = botCfg.leaderTiming || {};
    botCfg.leaderTiming.enabled = true;
  }

  // Activate parallel wallets when multiWallet > 1.  This sets
  // parallelWallets.enabled and maxParallel.  The walletIds and
  // splitPct remain user‑supplied via parallelWallets if provided.
  if (botCfg.multiWallet && Number(botCfg.multiWallet) > 1) {
    const mw = Number(botCfg.multiWallet);
    botCfg.parallelWallets = botCfg.parallelWallets || {};
    botCfg.parallelWallets.enabled = true;
    botCfg.parallelWallets.maxParallel = mw;
  }

  // Map stopLossPercent into the existing slPercent field.  This
  // preserves backwards compatibility with Sniper and Turbo Sniper
  // strategies that expect slPercent to define a static stop loss.
  if (botCfg.stopLossPercent != null && botCfg.stopLossPercent !== '') {
    const slPct = Number(botCfg.stopLossPercent);
    if (Number.isFinite(slPct)) {
      botCfg.slPercent = slPct;
    }
  }

  /* ── turbo + perf flags (from turbo wrapper defaults) ──────────────── */
  // fees
  const PRIORITY_FEE       = normalizeNumber(botCfg.priorityFeeLamports, 0);
  const AUTO_PRIORITY_FEE  = botCfg.autoPriorityFee === true;

  // Jito
  const USE_JITO_BUNDLE    = botCfg.useJitoBundle === true;
  const JITO_TIP_LAMPORTS  = normalizeNumber(botCfg.jitoTipLamports, 0);
  const JITO_RELAY_URL     = botCfg.jitoRelayUrl || null;

  // Bundle strategy (topOfBlock | backrun | private) and CU/tip tuning
  const BUNDLE_STRATEGY    = botCfg.bundleStrategy || 'topOfBlock';
  const CU_ADAPT           = botCfg.cuAdapt === true;
  const CU_PRICE_MIN       = normalizeNumber(botCfg.cuPriceMicroLamportsMin, 0);
  const CU_PRICE_MAX       = normalizeNumber(botCfg.cuPriceMicroLamportsMax, 0);
  const TIP_CURVE          = botCfg.tipCurve || 'flat';

  // Direct AMM fallback flags
  const DIRECT_AMM_FALLBACK = botCfg.directAmmFallback === true;
  const DIRECT_AMM_FIRST_PCT= normalizeNumber(botCfg.directAmmFirstPct, 0.3);
  const SKIP_PREFLIGHT      = botCfg.skipPreflight === false ? false : true;

  // Post-buy watcher configuration
  // In addition to the existing LP pull and authority flip exits this
  // object now carries optional smart exit modes.  Smart exits are
  // configured via `smartExitMode` and the corresponding nested
  // config under `smartExit`.  The executor inspects these values
  // and performs time/volume/liquidity exits post-buy.  See
  // services/strategies/core/tradeExecutorTurbo.js for details.
  const POST_BUY_WATCH = {
    durationSec: botCfg.postBuyWatch?.durationSec != null ? +botCfg.postBuyWatch.durationSec : 180,
    lpPullExit: botCfg.postBuyWatch?.lpPullExit !== false,
    authorityFlipExit: botCfg.postBuyWatch?.authorityFlipExit !== false,
    // Rug delay is optional and defaults to zero blocks.  A non-zero
    // delay causes a fixed ms delay before executing a forced exit.
    rugDelayBlocks: botCfg.postBuyWatch?.rugDelayBlocks != null ? +botCfg.postBuyWatch.rugDelayBlocks : 0,
    // Smart exit selection: one of 'time', 'volume', 'liquidity'.  When set
    // the executor will evaluate the chosen mode after purchase and
    // automatically exit when the conditions are met.  Undefined to
    // disable smart exit behaviour.
    smartExitMode: botCfg.smartExitMode || null,
    // Config details for each smart exit mode.  Missing values fall
    // back to sane defaults inside the executor.  See validator for
    // default values and range checks.
    smartExit: {
      time: {
        maxHoldSec: botCfg.smartExit?.time?.maxHoldSec != null ? +botCfg.smartExit.time.maxHoldSec : undefined,
        minPnLBeforeTimeExitPct: botCfg.smartExit?.time?.minPnLBeforeTimeExitPct != null ? +botCfg.smartExit.time.minPnLBeforeTimeExitPct : undefined,
      },
      volume: {
        volWindowSec: botCfg.smartExit?.volume?.volWindowSec != null ? +botCfg.smartExit.volume.volWindowSec : undefined,
        volDropPct: botCfg.smartExit?.volume?.volDropPct != null ? +botCfg.smartExit.volume.volDropPct : undefined,
      },
      liquidity: {
        lpOutflowExitPct: botCfg.smartExit?.liquidity?.lpOutflowExitPct != null ? +botCfg.smartExit.liquidity.lpOutflowExitPct : undefined,
      },
    },
    // Liquidity gate parameters are not used by the executor directly
    // yet but are passed through so the validator can enforce bounds and
    // the UI can persist these values.  minPoolUsd, maxImpactPctAtLarge
    // and the two probe sizes are optional.  When omitted the
    // executor will ignore liquidity gating.
    liqGate: {
      minPoolUsd: botCfg.liqGate?.minPoolUsd != null ? +botCfg.liqGate.minPoolUsd : undefined,
      maxImpactPctAtLarge: botCfg.liqGate?.maxImpactPctAtLarge != null ? +botCfg.liqGate.maxImpactPctAtLarge : undefined,
      liqProbeSmallSol: botCfg.liqGate?.liqProbeSmallSol != null ? +botCfg.liqGate.liqProbeSmallSol : undefined,
      liqProbeLargeSol: botCfg.liqGate?.liqProbeLargeSol != null ? +botCfg.liqGate.liqProbeLargeSol : undefined,
    },
  };

  // Iceberg and impact guard configuration
  const ICEBERG_ENABLED        = botCfg.iceberg?.enabled === true;
  const ICEBERG_TRANCHES       = botCfg.iceberg?.tranches ? Math.max(1, parseInt(botCfg.iceberg.tranches)) : 1;
  const ICEBERG_TRANCHE_DELAY  = botCfg.iceberg?.trancheDelayMs ? +botCfg.iceberg.trancheDelayMs : 0;
  const IMPACT_ABORT_PCT       = normalizeNumber(botCfg.impactAbortPct, 0);
  const DYNAMIC_SLIPPAGE_MAX_PCT = normalizeNumber(botCfg.dynamicSlippageMaxPct, MAX_SLIPPAGE * 100);
    /* new config sections (private relay / idempotency / sizing / probe) */
  const PRIVATE_RELAY_ENABLED = botCfg.privateRelay?.enabled === true;
  const PRIVATE_RELAY_URLS    = normalizeList(botCfg.privateRelay?.urls);
  const PRIVATE_RELAY_MODE    = botCfg.privateRelay?.mode || "bundle"; // "bundle" | "tx"

  const IDEMP_TTL_SEC   = normalizeNumber(
    botCfg.idempotency?.ttlSec ?? botCfg.idempotencyTtlSec,
    90
  );
  const IDEMP_SALT      = botCfg.idempotency?.salt || "";
  const IDEMP_RESUME    = botCfg.idempotency?.resumeFromLast !== false;

  const SIZING_MAX_IMPACT_PCT = (
    botCfg.sizing?.maxImpactPct != null ? +botCfg.sizing.maxImpactPct : null
  );
  const SIZING_MAX_POOL_PCT   = (
    botCfg.sizing?.maxPoolPct   != null ? +botCfg.sizing.maxPoolPct   : null
  );
  const SIZING_MIN_USD        = (
    botCfg.sizing?.minUsd       != null ? +botCfg.sizing.minUsd       : null
  );

  const PROBE_ENABLED         = botCfg.probe?.enabled === true;
  const PROBE_USD             = normalizeNumber(botCfg.probe?.usd, 5);
  const PROBE_SCALE_FACTOR    = normalizeNumber(botCfg.probe?.scaleFactor, 4);
  const PROBE_ABORT_IMPACT_PCT= normalizeNumber(botCfg.probe?.abortOnImpactPct, 2.0);
  const PROBE_DELAY_MS        = normalizeNumber(botCfg.probe?.delayMs, 250);
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

  // Instantiate a cross‑feed token resolver if configured.  Use
  // dev‑provided feed ordering/TTLs; default values are encoded in
  // tokenResolver itself.  The resolver is reused across ticks to
  // benefit from its internal cache.
  const tokenResolver = createTokenResolver(botCfg.feeds || {});

  // If pool detection is enabled, start the pool listener.  This listener
  // emits events whenever a new liquidity pool is initialised on
  // Raydium (or other configured AMMs).  The callback simply logs
  // the detected tokens and signature.  Consumers may extend this
  // behaviour to automatically snipe the detected tokens.
  if (POOL_DETECTION) {
    try {
      const rpcUrl = PRIVATE_RPC_URL || (RPC_ENDPOINTS.length ? RPC_ENDPOINTS[0] : process.env.SOLANA_RPC_URL);
      // Use LaserWatcher when enableLaserStream is true; default debounce 1s
      startPoolListener(
        {
          rpcUrl,
          enableLaserStream: botCfg.enableLaserStream === true,
          debounceMs: 1000,
        },
        async (info) => {
          try {
            // Log detection
            log('info', `Pool detected for ${info.tokenA}/${info.tokenB} via tx ${info.signature}`);
            // Determine candidate mint: pick the token that is not the base mint (SOL or USDC)
            let candidateMint;
            const a = info.tokenA;
            const b = info.tokenB;
            // Skip if either token is undefined
            if (!a || !b) return;
            // Lowercase for comparison
            const aLow = String(a).toLowerCase();
            const bLow = String(b).toLowerCase();
            const baseLow = BASE_MINT.toLowerCase();
            // Skip base mints (SOL/USDC) and pick the other
            if (aLow === baseLow) candidateMint = b;
            else if (bLow === baseLow) candidateMint = a;
            else {
              // If both differ, arbitrarily choose tokenA
              candidateMint = a;
            }
            // Basic guard: must be valid string
            if (!candidateMint || typeof candidateMint !== 'string') return;

            // Heuristic passes (reuse devWatch config)
            const _devWatch = botCfg.enableInsiderHeuristics
              ? Object.assign(
                  {},
                  botCfg.devWatch || {},
                  botCfg.maxHolderPercent != null && botCfg.maxHolderPercent !== ''
                    ? { holderTop5MaxPct: Number(botCfg.maxHolderPercent) }
                    : {}
                )
              : botCfg.devWatch;
            const passRes = await passes(candidateMint, {
              entryThreshold: ENTRY_THRESHOLD,
              volumeThresholdUSD: VOLUME_THRESHOLD,
              pumpWindow: botCfg.priceWindow || '5m',
              volumeWindow: botCfg.volumeWindow || '1h',
              limitUsd: LIMIT_USD,
              minMarketCap: MIN_MARKET_CAP,
              maxMarketCap: MAX_MARKET_CAP,
              dipThreshold: null,
              volumeSpikeMult: null,
              fetchOverview: (m) => getTokenShortTermChange(null, m, '5m', '1h'),
              devWatch: _devWatch,
            });
            if (!passRes?.ok) return;
            // Safety check
            if (!(botCfg.disableSafety === true)) {
              const safeRes = await isSafeToBuyDetailed(candidateMint, botCfg.safetyChecks || {});
              if (logSafetyResults(candidateMint, safeRes, log, 'sniper-turbo')) return;
              if (botCfg.requireFreezeRevoked && safeRes?.authority && safeRes.authority.detail) {
                try {
                  if (safeRes.authority.detail.freeze != null) return;
                } catch (_) {}
              }
            }
            // Quote
            const quoteRes = await getSafeQuote({
              inputMint: BASE_MINT,
              outputMint: candidateMint,
              amount: SNIPE_LAMPORTS,
              slippage: SLIPPAGE,
              maxImpactPct: SIZING_MAX_IMPACT_PCT != null ? SIZING_MAX_IMPACT_PCT : MAX_SLIPPAGE,
            });
            if (!quoteRes.ok) return;
            const quote = quoteRes.quote;
            if (PRIORITY_FEE > 0) {
              quote.prioritizationFeeLamports = PRIORITY_FEE;
            }
            // Record detection->quote latency metric
            try {
              const detTs = info.detectedAt || Date.now();
              metricsLogger.recordTiming?.('detectToQuote', Date.now() - detTs);
            } catch (_) {}
            // Build a meta object similar to baseMeta but scoped for this detection
            const idempotencyKey = uuid();
            const detectionMeta = {
              strategy: 'Sniper',
              walletId: botCfg.walletId,
              userId: botCfg.userId,
              slippage: SLIPPAGE,
              category: 'Sniper',
              tpPercent: botCfg.tpPercent ?? TAKE_PROFIT,
              slPercent: botCfg.slPercent ?? STOP_LOSS,
              tp: botCfg.takeProfit,
              sl: botCfg.stopLoss,
              botId: botId,
              // turbo / fees
              turboMode: TURBO_MODE,
              privateRpcUrl: PRIVATE_RPC_URL,
              skipPreflight: SKIP_PREFLIGHT,
              priorityFeeLamports: PRIORITY_FEE,
              autoPriorityFee: AUTO_PRIORITY_FEE,
              // Jito
              useJitoBundle: USE_JITO_BUNDLE,
              jitoTipLamports: JITO_TIP_LAMPORTS,
              jitoRelayUrl: JITO_RELAY_URL,
              // Bundle tuning
              bundleStrategy: BUNDLE_STRATEGY,
              cuAdapt: CU_ADAPT,
              cuPriceMicroLamportsMin: CU_PRICE_MIN,
              cuPriceMicroLamportsMax: CU_PRICE_MAX,
              tipCurve: TIP_CURVE,
              // Routing
              multiRoute: MULTI_ROUTE,
              splitTrade: SPLIT_TRADE,
              allowedDexes: ALLOWED_DEXES,
              excludedDexes: EXCLUDED_DEXES,
              // Direct AMM fallback
              directAmmFallback: DIRECT_AMM_FALLBACK,
              directAmmFirstPct: DIRECT_AMM_FIRST_PCT,
              // RPC & safety
              rpcEndpoints: RPC_ENDPOINTS,
              rpcMaxErrors: RPC_MAX_ERRORS,
              killSwitch: KILL_SWITCH,
              killThreshold: KILL_THRESHOLD,
              poolDetection: POOL_DETECTION,
              // Exits
              tpLadder: TP_LADDER,
              trailingStopPct: TRAILING_STOP_PCT,
              // Advanced flags
              ghostMode: GHOST_MODE,
              coverWalletId: COVER_WALLET_ID,
              autoRug: AUTO_RUG,
              prewarmAccounts: PREWARM_ACCS,
              // Post buy watcher
              postBuyWatch: POST_BUY_WATCH,
              slippageAuto: botCfg.slippageAuto || {},
              postTx: botCfg.postTx || null,
              devWatch: botCfg.devWatch || null,
              feeds: botCfg.feeds || null,
              iceberg: {
                enabled: ICEBERG_ENABLED,
                tranches: ICEBERG_TRANCHES,
                trancheDelayMs: ICEBERG_TRANCHE_DELAY,
              },
              impactAbortPct: IMPACT_ABORT_PCT,
              dynamicSlippageMaxPct: DYNAMIC_SLIPPAGE_MAX_PCT,
              idempotencyKey: idempotencyKey,
              privateRelay: {
                enabled: PRIVATE_RELAY_ENABLED,
                urls: PRIVATE_RELAY_URLS,
                mode: PRIVATE_RELAY_MODE,
              },
              idempotency: {
                ttlSec: IDEMP_TTL_SEC,
                salt: IDEMP_SALT,
                resumeFromLast: IDEMP_RESUME,
                key: idempotencyKey,
              },
              sizing: {
                maxImpactPct: SIZING_MAX_IMPACT_PCT,
                maxPoolPct: SIZING_MAX_POOL_PCT,
                minUsd: SIZING_MIN_USD,
              },
              probe: {
                enabled: PROBE_ENABLED,
                usd: PROBE_USD,
                scaleFactor: PROBE_SCALE_FACTOR,
                abortOnImpactPct: PROBE_ABORT_IMPACT_PCT,
                delayMs: PROBE_DELAY_MS,
              },
  // Smart exit configuration and liquidity gate parameters are passed
  // through to the executor.  They are kept separate from
  // postBuyWatch to avoid mixing top‑level keys.
  smartExitMode: botCfg.smartExitMode || null,
  smartExit: {
    time: {
      maxHoldSec: botCfg.smartExit?.time?.maxHoldSec != null ? +botCfg.smartExit.time.maxHoldSec : undefined,
      minPnLBeforeTimeExitPct: botCfg.smartExit?.time?.minPnLBeforeTimeExitPct != null ? +botCfg.smartExit.time.minPnLBeforeTimeExitPct : undefined,
    },
    volume: {
      volWindowSec: botCfg.smartExit?.volume?.volWindowSec != null ? +botCfg.smartExit.volume.volWindowSec : undefined,
      volDropPct: botCfg.smartExit?.volume?.volDropPct != null ? +botCfg.smartExit.volume.volDropPct : undefined,
    },
    liquidity: {
      lpOutflowExitPct: botCfg.smartExit?.liquidity?.lpOutflowExitPct != null ? +botCfg.smartExit.liquidity.lpOutflowExitPct : undefined,
    },
  },
  liqGate: {
    minPoolUsd: botCfg.liqGate?.minPoolUsd != null ? +botCfg.liqGate.minPoolUsd : undefined,
    maxImpactPctAtLarge: botCfg.liqGate?.maxImpactPctAtLarge != null ? +botCfg.liqGate.maxImpactPctAtLarge : undefined,
    liqProbeSmallSol: botCfg.liqGate?.liqProbeSmallSol != null ? +botCfg.liqGate.liqProbeSmallSol : undefined,
    liqProbeLargeSol: botCfg.liqGate?.liqProbeLargeSol != null ? +botCfg.liqGate.liqProbeLargeSol : undefined,
  },
  // When enabled, open trades will display the selected smart exit mode
  // instead of TP/SL in the trade table.  This flag is solely for UI
  // purposes and does not impact backend logic.
  stampSmartExit: botCfg.ui?.stampSmartExit !== false,
              quoteLatencyMs: 0,
              cuPriceCurve: botCfg.cuPriceCurve,
              tipCurveCoefficients: botCfg.tipCurveCoefficients,
              detectedAt: info.detectedAt || Date.now(),
            };
            // Execute trade (simulate flag handled by DRY_RUN)
            const txHash = await execTrade({ quote, mint: candidateMint, meta: detectionMeta, simulated: DRY_RUN });
            if (txHash) {
              trades++; todaySol += SNIPE_LAMPORTS / 1e9;
              cd.hit(candidateMint);
              metricsLogger.recordSuccess();
            }
            if (!txHash) {
              metricsLogger.recordFail('no-tx');
            }
          } catch (err) {
            // Ignore errors during pool detection trades
            console.warn('pool detection trade error:', err?.message);
          }
        }
      );
    } catch (e) {
      log('error', `Failed to start pool listener: ${e.message}`);
    }
  }

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

      // Start detection timer
      const phaseStart = Date.now();

      /* token feed resolution (kept minimal for perf) */
      let mint;
      if (botCfg.mint) {
        mint = botCfg.mint;
      } else if (botCfg.feeds) {
        // Use cross‑feed resolver.  It returns an array of candidate
        // mints; pick the first.  If empty, skip this tick.
        const mints = await tokenResolver.resolve('sniper', botCfg, botCfg.userId);
        mint = Array.isArray(mints) && mints.length ? mints[0] : null;
      } else {
        const mints = await resolveTokenFeed('sniper', botCfg);
        mint = Array.isArray(mints) && mints.length ? mints[0] : null;
      }
      if (!mint) return;

      /* filters / passes */
      // Build devWatch parameter based on insider heuristic settings.  When
      // enableInsiderHeuristics is true we merge any existing devWatch
      // options with the maxHolderPercent threshold; otherwise pass the
      // original config through to leave the heuristics disabled.  See
      // passes() in core/passes.js for details.
      const _devWatch = botCfg.enableInsiderHeuristics
        ? Object.assign(
            {},
            botCfg.devWatch || {},
            botCfg.maxHolderPercent != null && botCfg.maxHolderPercent !== ''
              ? { holderTop5MaxPct: Number(botCfg.maxHolderPercent) }
              : {}
          )
        : botCfg.devWatch;

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
          devWatch           : _devWatch,
        })
      );
      if (!res?.ok) return;

      /* safety check */
      if (!(botCfg.disableSafety === true)) {
        const safeRes = await isSafeToBuyDetailed(mint, botCfg.safetyChecks || {});
        // If any safety failure is logged (returns true) skip
        if (logSafetyResults(mint, safeRes, log, "sniper-turbo")) return;
        // Enforce freeze authority revocation when requested.  The
        // authority check returns detail.freeze as the pubkey if a
        // freeze authority exists.  If requireFreezeRevoked is true and
        // freeze is non‑null we skip this token.
        if (botCfg.requireFreezeRevoked && safeRes?.authority && safeRes.authority.detail) {
          try {
            if (safeRes.authority.detail.freeze != null) {
              return;
            }
          } catch (_) {
            // swallow errors
          }
        }
      }

      guards.assertDailyLimit(SNIPE_LAMPORTS / 1e9, todaySol, MAX_DAILY_SOL);

      /* quote helper */
      const quoteStart = Date.now();
      const quoteRes = await getSafeQuote({
        inputMint    : BASE_MINT,
        outputMint   : mint,
        amount       : SNIPE_LAMPORTS,
        slippage     : SLIPPAGE,
        maxImpactPct : (SIZING_MAX_IMPACT_PCT != null ? SIZING_MAX_IMPACT_PCT : MAX_SLIPPAGE),
      });
      const quoteEnd = Date.now();
      metricsLogger.recordTiming('detectToQuote', quoteEnd - phaseStart);
      if (!quoteRes.ok) return;
      const baseQuote = quoteRes.quote;

      if (PRIORITY_FEE > 0) {
        baseQuote.prioritizationFeeLamports = PRIORITY_FEE;
      }
      // If AUTO_PRIORITY_FEE is true, executor will compute best fee; we only pass the flag.

      /* meta for executor */
      const metaBuildStart = Date.now();
      const idempotencyKey = uuid();
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
        skipPreflight   : SKIP_PREFLIGHT,
        priorityFeeLamports: PRIORITY_FEE,
        autoPriorityFee : AUTO_PRIORITY_FEE,

        // Jito / relay
        useJitoBundle   : USE_JITO_BUNDLE,
        jitoTipLamports : JITO_TIP_LAMPORTS,
        jitoRelayUrl    : JITO_RELAY_URL,

        // Bundle tuning
        bundleStrategy  : BUNDLE_STRATEGY,
        cuAdapt         : CU_ADAPT,
        cuPriceMicroLamportsMin: CU_PRICE_MIN,
        cuPriceMicroLamportsMax: CU_PRICE_MAX,
        tipCurve        : TIP_CURVE,

        // routing & dex prefs
        multiRoute      : MULTI_ROUTE,
        splitTrade      : SPLIT_TRADE,
        allowedDexes    : ALLOWED_DEXES,
        excludedDexes   : EXCLUDED_DEXES,

        // Direct AMM fallback
        directAmmFallback : DIRECT_AMM_FALLBACK,
        directAmmFirstPct: DIRECT_AMM_FIRST_PCT,

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

        // post buy watcher
        postBuyWatch    : POST_BUY_WATCH,

        // Auto slippage governor configuration
        slippageAuto   : botCfg.slippageAuto || {},

        // Post‑trade action chain
        postTx         : botCfg.postTx || null,

        // Developer heuristics (for downstream consumption)
        devWatch       : botCfg.devWatch || null,

        // Cross‑feed token resolver settings
        feeds          : botCfg.feeds || null,

        // iceberg
        iceberg         : {
          enabled: ICEBERG_ENABLED,
          tranches: ICEBERG_TRANCHES,
          trancheDelayMs: ICEBERG_TRANCHE_DELAY,
        },

        // impact/dynamic slippage
        impactAbortPct  : IMPACT_ABORT_PCT,
        dynamicSlippageMaxPct: DYNAMIC_SLIPPAGE_MAX_PCT,

        // idempotency key to avoid duplicate buys
        idempotencyKey  : idempotencyKey,
                // private relay
        privateRelay   : {
          enabled: PRIVATE_RELAY_ENABLED,
          urls   : PRIVATE_RELAY_URLS,
          mode   : PRIVATE_RELAY_MODE,
        },

        // idempotency controls
        idempotency    : {
          ttlSec       : IDEMP_TTL_SEC,
          salt         : IDEMP_SALT,
          resumeFromLast: IDEMP_RESUME,
          key          : idempotencyKey, // keep your existing key visible to executor
        },

        // liquidity sizing constraints
        sizing         : {
          maxImpactPct : SIZING_MAX_IMPACT_PCT,
          maxPoolPct   : SIZING_MAX_POOL_PCT,
          minUsd       : SIZING_MIN_USD,
        },

        // probe buy behavior
        probe          : {
          enabled          : PROBE_ENABLED,
          usd              : PROBE_USD,
          scaleFactor      : PROBE_SCALE_FACTOR,
          abortOnImpactPct : PROBE_ABORT_IMPACT_PCT,
          delayMs          : PROBE_DELAY_MS,
        },


        // measured quote latency in ms, used for direct AMM fallback
        quoteLatencyMs  : quoteEnd - quoteStart,

        // Custom CU and tip curves (Turbo Sniper++)
        cuPriceCurve        : botCfg.cuPriceCurve,
        tipCurveCoefficients: botCfg.tipCurveCoefficients,

        // -------------------------------------------------------------------
        // Pass through advanced timing/tuning controls from the frontend.  The
        // executor defines sensible defaults for these fields if they are
        // undefined, but explicitly forwarding user‑provided values ensures
        // configuration parity between the UI and backend.  Missing values are
        // left undefined so destructuring in the executor falls back to its
        // internal defaults without incurring extra overhead.  See
        // backend/services/strategies/core/tradeExecutorTurbo.js for the
        // corresponding defaults.

        // Leader scheduling parameters (enabled, preflightMs, windowSlots)
        leaderTiming    : botCfg.leaderTiming || undefined,
        // Quote cache TTL in milliseconds (controls warm quote reuse)
        quoteTtlMs      : botCfg.quoteTtlMs   || undefined,
        // Retry policy for compute unit/tip bumps and route switching
        retryPolicy     : botCfg.retryPolicy  || undefined,
        // Parallel wallet filler configuration (opt‑in)
        parallelWallets : botCfg.parallelWallets || undefined,

        // Detection timestamp used for lead‑time metrics.  For tick‑based
        // scanning we use the start of this phase as a proxy.  When pool
        // events are emitted the detectedAt field will be overridden.
        detectedAt          : phaseStart,
      };
      const metaBuildEnd = Date.now();
      metricsLogger.recordTiming('quoteToBuild', metaBuildEnd - quoteEnd);

      /* optional delay before buy */
      if (DELAY_MS > 0) await new Promise(r => setTimeout(r, DELAY_MS));

      /* optional pre-warm */
      if (PREWARM_ACCS) {
        try {
          // Use the same private RPC as turbo for prewarm to avoid RPC mismatches
          const conn = new Web3Connection(PRIVATE_RPC_URL || process.env.SOLANA_RPC_URL, "confirmed");
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
              // Track retries for metrics (any attempt beyond the first is a retry)
              if (s !== slips[0]) metricsLogger.recordRetry();
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
        const submitStart = Date.now();
        txHash = await execTrade({
          quote: baseQuote,
          mint,
          meta : baseMeta,
          simulated: DRY_RUN,
        });
        const submitEnd = Date.now();
        metricsLogger.recordTiming('buildToSubmit', submitEnd - metaBuildEnd);
      }

      if (txHash) {
        trades++; todaySol += SNIPE_LAMPORTS / 1e9;
        cd.hit(mint);
        metricsLogger.recordSuccess();
      }
      if (!txHash) {
        // Record a failure reason for metrics
        metricsLogger.recordFail('no-tx');
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
      metricsLogger.recordFail(err?.code || err?.message || 'error');
    }
  }

  /* scheduler */
  const loopHandle = runLoop(tick, INTERVAL_MS, { label: "sniper-turbo", botId });
}

// Attach the strategy runner to module.exports so consumers can call it
module.exports.turboSniperStrategy = turboSniperStrategy;

/* CLI helper */
if (require.main === module) {
  const fp = process.argv[2];
  if (!fp || !fs.existsSync(fp)) {
    console.error("Pass config JSON path");
    process.exit(1);
  }
  turboSniperStrategy(JSON.parse(fs.readFileSync(fp, "utf8"))).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}