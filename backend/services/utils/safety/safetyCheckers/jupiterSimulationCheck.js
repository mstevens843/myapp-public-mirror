/**
 * - Checks a token before buying it to avoid scams or illiquid pools. 
 * - Simulates a swap using Jupiter and enforeces basic safety rules. 
 * 
 * Used To Simulate a small swap to detect: 
 * - Abnormally high price impact (low liquidity or scam token) 
 * - Insufficient output received (malformed or malicious)
 * 
 * - If a tokden fails this checked, it is skipped during execution. 
 * 
 * Prevents: 
 * - Zero Liquidity
 * - High price impact (slippage traps)
 * - Unknown Mints
 * 
 * Configurable: 
 * - min liquidity threshoold
 * - max acceptance price impact %
 */

/**
 * Simulates a Jupiter swap to detect honeypots, slippage traps, or illiquidity.
 * Returns a **rich** result object so callers & UI can surface *why* it failed.
 */
const axios = require("axios");

const BASE_MINT           = "So11111111111111111111111111111111111111112"; // wSOL
const SLIPPAGE_BPS        = 100;      // 1%
const SIMULATE_AMOUNT     = 0.005e9;  // 0.005 SOL in lamports
const MAX_IMPACT_PCT      = 5.0;      // %
const MIN_EXPECTED_OUTPUT = 5.0;      // tokens (≈ $5)

module.exports.simulateAndCheckSwap = async function simulateAndCheckSwap (
  outputMint,
  { maxImpact = MAX_IMPACT_PCT, minOutput = MIN_EXPECTED_OUTPUT } = {}
) {
  try {
    const url = `https://lite-api.jup.ag/swap/v1/quote` +
      `?inputMint=${BASE_MINT}&outputMint=${outputMint}` +
      `&amount=${SIMULATE_AMOUNT}&slippageBps=${SLIPPAGE_BPS}&swapMode=ExactIn`;

    const { data } = await axios.get(url, { timeout: 7000 });
    const q = data?.data || data || {};

    const priceImpactPct  = Number(q.priceImpactPct ?? q.other?.priceImpactPct ?? NaN);
    const inAmountLamports = Number(q.inAmount ?? SIMULATE_AMOUNT);
    const outAmountRaw    = Number(q.outAmount ?? 0);
    const decimals        = Number(q.other?.outputDecimals ?? 6);
    const outAmountTokens = outAmountRaw / Math.pow(10, decimals);

    const routeInfos = q.routePlan || q.marketInfos || [];
    const dexes = routeInfos.map(i => i.amm?.label || i.label || "Unknown");
    const hops  = routeInfos.length;

    const impactOk = isFinite(priceImpactPct) ? priceImpactPct <= maxImpact : false;
    const outputOk = isFinite(outAmountTokens) ? outAmountTokens >= minOutput : false;
    const passed   = impactOk && outputOk;

    return {
      key: "simulation",
      label: "Jupiter pre-trade simulation",
      passed,
      reason: passed
        ? "Impact+output within limits"
        : !impactOk && !outputOk ? "High impact + low output"
        : !impactOk ? "High price impact"
        : "Low expected output",
      detail: `impact ${priceImpactPct.toFixed(2)}% ${impactOk ? "≤" : ">"} ${maxImpact}%; out ${outAmountTokens.toFixed(3)} ${outputOk ? "≥" : "<"} ${minOutput}`,
      data: {
        priceImpactPct,
        maxImpactPct: maxImpact,
        outAmountTokens,
        minExpectedOutput: minOutput,
        inAmountLamports,
        routeHops: hops,
        dexes,
      },
    };
  } catch (err) {
    return {
      key: "simulation",
      label: "Jupiter pre-trade simulation",
      passed: false,
      reason: "Quote failed",
      detail: err.message,
      data: null,
    };
  }
};

/**
 * 🔍 What Exactly Does It Check?
Check	Value	Purpose
priceImpactPct > 5.0	⛔ FAIL	Blocks low-liquidity / slippage scams
outAmount < 5	⛔ FAIL	Blocks dust/malformed output trades
axios.get() throws or 404s	⛔ FAIL	Catches untradeable or fake tokens
quote comes back valid	✅ PASS	Token has tradeable liquidity & working path
 */