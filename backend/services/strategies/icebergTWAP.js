/**
 * Iceberg TWAP Strategy
 *
 * Splits a large order into many small clips executed over time and
 * optionally across multiple DEX routes/wallets.  Each clip size is
 * jittered randomly within a configurable range around an average
 * target size, and the spacing between clips can also be varied to
 * reduce the footprint on chain.  After each clip the strategy can
 * optionally perform a cover‑forward, sweeping received tokens to a
 * cold wallet via ghost.forwardTokens.
 *
 * Usage: configure `totalAmount`, `numClips` or `clipSizeRange`,
 * `minSpacingMs`, `maxSpacingMs`, `routes` (array of route identifiers),
 * `coverForward` (boolean), and `forwardDest` (base58 pubkey) on
 * botCfg.  Provide `dryRun: true` for simulation.
 */

/* eslint-disable no-console */

const { PublicKey } = require("@solana/web3.js");
const { v4: uuid } = require("uuid");

/* safety + logging */
const { strategyLog }         = require("./logging/strategyLogger");
const { createSummary, tradeExecuted } = require("./core/alerts");
const { lastTickTimestamps, runningProcesses } = require("../utils/strategy_utils/activeStrategyTracker");

/* core helpers */
const wm             = require("./core/walletManager");
const { getSafeQuote } = require("./core/quoteHelper");
const {
  liveBuy,
  simulateBuy,
} = require("./core/tradeExecutor");
const { initTxWatcher } = require("./core/txTracker");

/* ghost forwarding */
const ghost = require("./core/ghost");

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT  = "So11111111111111111111111111111111111111112";

module.exports = async function icebergTwapStrategy(botCfg = {}) {
  const botId = botCfg.botId || `iceberg-${uuid()}`;
  const log   = strategyLog("icebergTWAP", botId, botCfg);
  const summary = createSummary("IcebergTWAP", log, botCfg.userId);
  /* config */
  const BASE_MINT = botCfg.inputMint || SOL_MINT;
  const TARGET_AMOUNT = (+botCfg.totalAmount || 1) * (BASE_MINT === USDC_MINT ? 1e6 : 1e9);
  const NUM_CLIPS = +botCfg.numClips || 10;
  const minClipPct = +botCfg.minClipPct || 0.8;
  const maxClipPct = +botCfg.maxClipPct || 1.2;
  const minSpacingMs = +botCfg.minSpacingMs || 10_000;
  const maxSpacingMs = +botCfg.maxSpacingMs || 30_000;
  const routes = Array.isArray(botCfg.routes) && botCfg.routes.length > 0 ? botCfg.routes : [null];
  const coverForward = botCfg.coverForward === true;
  const forwardDest  = botCfg.forwardDest;
  const DRY_RUN      = botCfg.dryRun === true;
  const execBuy      = DRY_RUN ? simulateBuy : liveBuy;
  const MIN_BALANCE_SOL = 0.1;

  // Derive clip sizes with jitter; ensure sum equals target
  const avgClip = TARGET_AMOUNT / NUM_CLIPS;
  const clipSizes = [];
  let runningTotal = 0;
  for (let i = 0; i < NUM_CLIPS; i++) {
    // jitter around average
    const factor = minClipPct + Math.random() * (maxClipPct - minClipPct);
    let clip = Math.round(avgClip * factor);
    // adjust last clip to hit target
    if (i === NUM_CLIPS - 1) clip = TARGET_AMOUNT - runningTotal;
    clipSizes.push(clip);
    runningTotal += clip;
  }

  await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
  initTxWatcher("IcebergTWAP");
  let clipIndex = 0;
  let cancelled = false;
  async function executeNext() {
    if (cancelled || clipIndex >= clipSizes.length) {
      log("info", "Iceberg TWAP completed");
      await summary.printAndAlert("IcebergTWAP completed");
      return;
    }
    const size = clipSizes[clipIndex];
    const route = routes[Math.floor(Math.random() * routes.length)];
    log("info", `Executing clip ${clipIndex + 1}/${clipSizes.length} with size ${size} on route ${route || "default"}`);
    // Quote (for demonstration we skip quoting by route)
    try {
      const quote = await getSafeQuote(botCfg.targetMint, BASE_MINT, size, botCfg.slippage || 0.5);
      const txid = await execBuy(botCfg.targetMint, BASE_MINT, size, botCfg.slippage || 0.5, botCfg.priorityFeeLamports);
      summary.inc("clips");
      tradeExecuted("IcebergTWAP", botCfg.targetMint, txid);
      log("success", `Clip ${clipIndex + 1} executed txid=${txid}`);
      // Optional cover forward
      if (coverForward && forwardDest) {
        try {
          log("info", `Forwarding clip proceeds to ${forwardDest}`);
          await ghost.forwardTokens(botCfg.walletId, forwardDest);
        } catch (_) {}
      }
    } catch (ex) {
      log("error", `Clip ${clipIndex + 1} failed: ${ex.message}`);
    }
    clipIndex++;
    // schedule next clip
    const spacing = minSpacingMs + Math.random() * (maxSpacingMs - minSpacingMs);
    setTimeout(executeNext, spacing);
  }
  // Start schedule
  executeNext();
  return {
    stop: () => { cancelled = true; },
  };
};