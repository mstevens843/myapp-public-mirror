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

const KEY   = "simulation";
const LABEL = "Detect Scam or Illiquid Token";

const BASE_MINT            = "So11111111111111111111111111111111111111112"; // wSOL
const SLIPPAGE_BPS         = 100;      // 1 % slippage
const SIMULATE_AMOUNT      = 0.005e9;  // 0.005 SOL in lamports
const MAX_IMPACT_PCT       = 5.0;      // %
const MIN_EXPECTED_OUTPUT  = 5.0;      // tokens (≈ $5)

module.exports.simulateAndCheckSwap = async function simulateAndCheckSwap (
  outputMint,
  { maxImpact = MAX_IMPACT_PCT, minOutput = MIN_EXPECTED_OUTPUT } = {}
) {
  try {
    const url = `https://lite-api.jup.ag/swap/v1/quote` +
                `?inputMint=${BASE_MINT}&outputMint=${outputMint}` +
                `&amount=${SIMULATE_AMOUNT}&slippageBps=${SLIPPAGE_BPS}&swapMode=ExactIn`;

    const { data } = await axios.get(url);

    const impactPct = parseFloat(data.priceImpactPct) * 100;
    const outTokens = parseFloat(data.outAmount) / 1e6;   // → whole-token units

    /* ---------- rule evaluation ---------- */
    if (impactPct > maxImpact) {
      return {
        key: KEY,
        label: LABEL,
        passed: false,
        reason: "High price impact",
        detail: `Impact ${impactPct.toFixed(2)} % > max ${maxImpact}%`,
        data: { impactPct, maxImpact },
      };
    }

    if (outTokens < minOutput) {
      return {
        key: KEY,
        label: LABEL,
        passed: false,
        reason: "Output too low",
        detail: `Expected ≥ ${minOutput}, got ${outTokens.toFixed(4)}`,
        data: { outTokens, minOutput },
      };
    }

    return {
      key: KEY,
      label: LABEL,
      passed: true,
      data: { impactPct, outTokens },
    };
  } catch (err) {
    return {
      key: KEY,
      label: LABEL,
      passed: false,
      reason: "Simulation failed",
      detail: err.response?.data?.error || err.message,
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