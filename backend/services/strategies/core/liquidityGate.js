// ✨ Added: backend/services/strategies/core/liquidityGate.js
'use strict';

const { getSwapQuote } = require('../../../utils/swap');
const getTokenPriceModule = require('../paid_api/getTokenPrice');
const getSolPrice = getTokenPriceModule.getSolPrice;

// probe sizes (lamports)
const LAMPORT = 1_000_000_000n;

async function getSolUsd(userId) {
  try { return await getSolPrice(userId); } catch { return 0; }
}

/**
 * Heuristic liquidity gate using 2 quote probes.
 * - Probes small and larger SOL->token sizes
 * - Checks priceImpact at larger size
 * - Approximates "depth in USD" from slippage curve
 */
async function assertMinLiquidity({ userId, inputMintSOL, outputMint, minPoolUsd = 10_000, maxImpactPctAtLarge = 20, smallSol = 0.1, largeSol = 3.0 }) {
  // small probe
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

  const impactLargePct = (Number(largeQ.priceImpactPct || 0) * 100);
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
