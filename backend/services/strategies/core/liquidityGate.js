/**
 * backend/services/strategies/core/liquidityGate.js
 *
 * What changed
 *  - Kept your dual-probe liquidity gate logic intact, added full JSDoc param block,
 *    and clarified error strings. No behavior change.
 * Why
 *  - Pre-buy guard to avoid illiquid pools / excessive impact before Turbo buy.
 * Risk addressed
 *  - Thin pools and high slippage causing instant loss right after entry.
 */

// ✨ Added: backend/services/strategies/core/liquidityGate.js
'use strict';

const { getSwapQuote } = require('../../../utils/swap');
const getTokenPriceModule = require('../paid_api/getTokenPrice');
const getSolPrice = getTokenPriceModule.getSolPrice;

// probe sizes (lamports)
const LAMPORT = 1_000_000_000n; // (kept for future callers that may compute lamports)

/** Resolve current SOL/USD; fall back to 0 on error to force conservative block. */
async function getSolUsd(userId) {
  try { return await getSolPrice(userId); } catch { return 0; }
}

/**
 * Heuristic liquidity gate using 2 quote probes.
 * - Probes small and larger SOL->token sizes
 * - Checks priceImpact at larger size
 * - Approximates "depth in USD" from slippage curve
 *
 * @param {Object} opts
 * @param {string} opts.userId               Current user ID (for price lookup)
 * @param {string} opts.inputMintSOL         Mint of the input token (SOL)
 * @param {string} opts.outputMint           Mint of the token being purchased
 * @param {number} [opts.minPoolUsd=10000]   Minimum USD depth required
 * @param {number} [opts.maxImpactPctAtLarge=20] Max allowed price impact (%) at large probe
 * @param {number} [opts.smallSol=0.1]       Small probe amount in SOL
 * @param {number} [opts.largeSol=3.0]       Large probe amount in SOL
 * @returns {Promise<{ok: true, estDepthUsd: number, impactLargePct: number}>}
 * @throws {Error} LIQUIDITY_GATE_NO_QUOTE | LIQUIDITY_TOO_THIN | POOL_DEPTH_TOO_SMALL
 */
async function assertMinLiquidity({
  userId,
  inputMintSOL,
  outputMint,
  minPoolUsd = 10_000,
  maxImpactPctAtLarge = 20,
  smallSol = 0.1,
  largeSol = 3.0,
}) {
  // small & large probes (lamports)
  const smallIn = BigInt(Math.floor(smallSol * 1e9));
  const largeIn = BigInt(Math.floor(largeSol * 1e9));

  const smallQ = await getSwapQuote({
    inputMint: inputMintSOL,
    outputMint,
    amount: smallIn.toString(),
    slippageBps: 150, // not critical here
  });
  const largeQ = await getSwapQuote({
    inputMint: inputMintSOL,
    outputMint,
    amount: largeIn.toString(),
    slippageBps: 150,
  });

  if (!smallQ || !largeQ) throw new Error('LIQUIDITY_GATE_NO_QUOTE');

  const impactLargePct = Number(largeQ.priceImpactPct || 0) * 100;
  if (impactLargePct > maxImpactPctAtLarge) {
    throw new Error(`LIQUIDITY_TOO_THIN: impact ${impactLargePct.toFixed(2)}% > ${maxImpactPctAtLarge}%`);
  }

  // Rough depth estimate: if 3 SOL only moves price ~x%, depth ≈ 3 SOL / (x%).
  const solUsd = await getSolUsd(userId);
  const estDepthSol = impactLargePct > 0 ? (largeSol / (impactLargePct / 100)) : 9999;
  const estDepthUsd = estDepthSol * (solUsd || 0);

  if (!Number.isFinite(estDepthUsd) || estDepthUsd < minPoolUsd) {
    throw new Error(`POOL_DEPTH_TOO_SMALL: ~${Math.round(estDepthUsd)} USD < ${minPoolUsd} USD`);
  }

  return { ok: true, estDepthUsd, impactLargePct };
}

module.exports = { assertMinLiquidity };
