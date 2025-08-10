/**
 * Iceberg TWAP Strategy
 *
 * This strategy splits a large notional amount into a series of smaller clips
 * (time‑weighted average price, or TWAP) and executes them over a configurable
 * time horizon.  Each clip size is randomly jittered within a user‑defined
 * range (`minClip`..`maxClip`) and the spacing between clips is also
 * randomized between `minSpacingMs` and `maxSpacingMs`.  After each clip the
 * strategy can optionally forward received tokens to a cold wallet via
 * `ghost.forwardTokens` to reduce on‑chain footprint.  A dry‑run mode is
 * provided which prints the schedule and clips without sending any
 * transactions.
 *
 * Required config fields on `botCfg`:
 *   - targetNotional: Total amount (in base currency) to buy, expressed in
 *     SOL or USDC units.  This will be converted to lamports internally.
 *   - targetMint: The mint address of the token to buy.
 *   - inputMint: The base mint used for the purchase (SOL or USDC).  If
 *     omitted, defaults to SOL.
 * Optional config fields:
 *   - minClip, maxClip: Minimum/maximum clip sizes in base currency (SOL or
 *     USDC).  If omitted, the target notional is evenly split into 10 clips.
 *   - minSpacingMs, maxSpacingMs: Minimum/maximum spacing between clips in
 *     milliseconds.  Defaults to 10–30 seconds.
 *   - routes: Array of route identifiers (strings) to randomly choose from.
 *     These are advisory and passed through to the logs; the underlying
 *     quote helper still determines the best route on chain.
 *   - jitterPct: When supplied, clip sizes are further jittered by ±jitterPct
 *     (0.05 = ±5%).
 *   - coverForward: Boolean to enable forwarding of tokens after each clip.
 *   - forwardDest: Public key (base58) of the cold wallet to forward tokens to.
 *   - dryRun: When true, no on‑chain swaps are executed; the schedule is
 *     printed instead.
 */

/* eslint-disable no-console */

const { PublicKey, Connection, clusterApiUrl } = require("@solana/web3.js");
const { v4: uuid } = require("uuid");

/* logging and metrics */
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
const ghost = require("./core/ghost");

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT  = "So11111111111111111111111111111111111111112";

module.exports = async function icebergTwapStrategy(botCfg = {}) {
  const botId = botCfg.botId || `iceberg-${uuid()}`;
  const log   = strategyLog("icebergTWAP", botId, botCfg);
  const summary = createSummary("IcebergTWAP", log, botCfg.userId);

  // Resolve base mint (input) and target mint (output)
  const BASE_MINT = botCfg.inputMint || SOL_MINT;
  const TARGET_MINT = botCfg.targetMint;
  if (!TARGET_MINT) throw new Error("targetMint is required for icebergTWAP");

  // Convert notional to lamports (or USDC decimals) based on base mint
  const targetNotional = +botCfg.targetNotional || 0;
  if (!Number.isFinite(targetNotional) || targetNotional <= 0) {
    throw new Error("targetNotional must be a positive number");
  }
  const TOTAL_LAMPORTS = targetNotional * (BASE_MINT === USDC_MINT ? 1e6 : 1e9);

  // Determine clip sizing.  Use user‑provided min/max or derive evenly
  const userMinClip = botCfg.minClip != null ? +botCfg.minClip * (BASE_MINT === USDC_MINT ? 1e6 : 1e9) : null;
  const userMaxClip = botCfg.maxClip != null ? +botCfg.maxClip * (BASE_MINT === USDC_MINT ? 1e6 : 1e9) : null;
  const minSpacingMs = +botCfg.minSpacingMs || 10_000;
  const maxSpacingMs = +botCfg.maxSpacingMs || 30_000;
  const routes = Array.isArray(botCfg.routes) && botCfg.routes.length > 0 ? botCfg.routes : [null];
  const jitterPct = typeof botCfg.jitterPct === "number" ? Math.max(0, Math.min(+botCfg.jitterPct, 1)) : 0;
  const coverForward = botCfg.coverForward === true;
  const forwardDest  = botCfg.forwardDest;
  const DRY_RUN      = botCfg.dryRun === true;
  const execBuy      = DRY_RUN ? simulateBuy : liveBuy;
  const slippage     = +botCfg.slippage || 0.5;
  const maxImpact    = +botCfg.maxImpactPct || 0.10;

  // Build an array of clip sizes that sum to TOTAL_LAMPORTS.  If the user
  // supplies minClip/maxClip we sample uniformly from that range.  Otherwise
  // split evenly into 10 clips.  Apply jitter on top if configured.
  const clipSizes = [];
  let remaining = TOTAL_LAMPORTS;
  if (userMinClip != null && userMaxClip != null && userMinClip > 0 && userMaxClip >= userMinClip) {
    while (remaining > 0) {
      let clip = userMinClip + Math.random() * (userMaxClip - userMinClip);
      clip = Math.floor(clip);
      // Apply jitter ±jitterPct
      if (jitterPct > 0) {
        const jitterMult = 1 + (Math.random() * 2 - 1) * jitterPct;
        clip = Math.floor(clip * jitterMult);
      }
      if (clip <= 0) clip = userMinClip;
      if (clip > remaining) clip = remaining;
      clipSizes.push(clip);
      remaining -= clip;
    }
  } else {
    // Fallback: 10 even clips
    const num = +botCfg.numClips || 10;
    const avgClip = Math.floor(TOTAL_LAMPORTS / num);
    for (let i = 0; i < num; i++) {
      let clip = avgClip;
      if (jitterPct > 0) {
        const jitterMult = 1 + (Math.random() * 2 - 1) * jitterPct;
        clip = Math.floor(avgClip * jitterMult);
      }
      if (clip <= 0) clip = avgClip;
      // last clip takes remainder
      if (i === num - 1) clip = TOTAL_LAMPORTS - clipSizes.reduce((a, b) => a + b, 0);
      clipSizes.push(clip);
    }
  }

  // Ensure sum equals total (adjust final clip if necessary)
  const sumClips = clipSizes.reduce((a, b) => a + b, 0);
  if (sumClips !== TOTAL_LAMPORTS && clipSizes.length > 0) {
    const diff = TOTAL_LAMPORTS - sumClips;
    clipSizes[clipSizes.length - 1] += diff;
  }

  // Log the generated schedule for the user
  log("info", `IcebergTWAP schedule generated: ${clipSizes.length} clips totalling ${(TOTAL_LAMPORTS / 1e9).toFixed(3)} ${BASE_MINT === USDC_MINT ? "USDC" : "SOL"}`);
  clipSizes.forEach((c, i) => {
    log("info", `  Clip ${i + 1}: ${(c / (BASE_MINT === USDC_MINT ? 1e6 : 1e9)).toFixed(6)} ${BASE_MINT === USDC_MINT ? "USDC" : "SOL"}`);
  });

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
    log("info", `Executing clip ${clipIndex + 1}/${clipSizes.length} — size ${(size / (BASE_MINT === USDC_MINT ? 1e6 : 1e9)).toFixed(6)} ${BASE_MINT === USDC_MINT ? "USDC" : "SOL"}, route ${route || "default"}`);
    if (DRY_RUN) {
      // In dry run just log and schedule next
      summary.inc("clips");
      clipIndex++;
      const spacing = minSpacingMs + Math.random() * (maxSpacingMs - minSpacingMs);
      log("info", `Next clip in ${(spacing / 1000).toFixed(1)}s`);
      setTimeout(executeNext, spacing);
      return;
    }
    try {
      // Fetch a quote for this clip
      const qRes = await getSafeQuote({
        inputMint    : BASE_MINT,
        outputMint   : TARGET_MINT,
        amount       : BigInt(size),
        slippage     : slippage,
        maxImpactPct : maxImpact,
      });
      if (!qRes.ok) {
        log("warn", `Clip ${clipIndex + 1} quote failed: ${qRes.reason || "unknown"}`);
        summary.inc("quoteFail");
      } else {
        const quote = qRes.quote;
        const execMeta = {
          strategy  : "IcebergTWAP",
          walletId  : botCfg.walletId,
          userId    : botCfg.userId,
          slippage  : slippage,
          category  : "IcebergTWAP",
          clipIndex : clipIndex,
        };
        const txid = await execBuy({ quote, mint: TARGET_MINT, meta: execMeta });
        summary.inc("clips");
        tradeExecuted({ userId: botCfg.userId, mint: TARGET_MINT, tx: txid, wl: botCfg.walletLabel || "default", category: "IcebergTWAP", simulated: DRY_RUN });
        log("success", `Clip ${clipIndex + 1} executed txid=${txid}`);
        // Optional cover forward: forward the purchased tokens to the cold wallet
        if (coverForward && forwardDest) {
          try {
            const dest = new PublicKey(forwardDest);
            // Create a connection to the configured RPC endpoint (or mainnet default)
            const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('mainnet-beta');
            const connection = new Connection(rpcUrl, 'confirmed');
            // Retrieve the current wallet keypair for signing
            const wallet = wm.current && typeof wm.current === "function" ? wm.current() : null;
            if (wallet) {
              await ghost.forwardTokens(connection, TARGET_MINT, wallet, dest, quote.outAmount);
              log("info", `Forwarded tokens to ${forwardDest}`);
            } else {
              log("warn", "Unable to obtain wallet for forwarding; skipped");
            }
          } catch (fwdErr) {
            log("warn", `Forwarding failed: ${fwdErr.message}`);
          }
        }
      }
    } catch (ex) {
      log("error", `Clip ${clipIndex + 1} failed: ${ex.message}`);
    }
    clipIndex++;
    // schedule next clip
    const spacing = minSpacingMs + Math.random() * (maxSpacingMs - minSpacingMs);
    setTimeout(executeNext, spacing);
  }
  // Start the schedule
  executeNext();
  // Return a control handle to allow cancellation
  return {
    stop: () => { cancelled = true; },
  };
};