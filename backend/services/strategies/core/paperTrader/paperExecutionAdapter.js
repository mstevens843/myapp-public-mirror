/*
 * paperExecutionAdapter.js
 *
 * Simulation engine for Paper Trader.  This module emulates the
 * behaviour of a live swap without ever sending a transaction.  It
 * supports slippage models, configurable latency, probabilistic
 * failures, partial fills and fee accounting.  All randomness is
 * seeded via a simple deterministic generator so that runs are
 * reproducible given the same seed and inputs.
 *
 * The high‑level flow is:
 *   1. Build a seeded RNG from the provided seed (or use Math.random).
 *   2. Evaluate failure conditions based on configured probabilities.  If
 *      a failure occurs the adapter returns immediately with a
 *      reason_code and no fills.
 *   3. Determine how many partial fills to split the order into.  The
 *      number of parts is random within the inclusive range defined by
 *      `partials.minParts` and `partials.maxParts`.  Each part is
 *      assumed to be an equal fraction of the quote’s in/out amount.
 *   4. For each part, draw a slippage in basis points up to the
 *      configured cap.  The realised price for a fill is the quote
 *      mid‑price times (1 + slippage_bps / 10_000).
 *   5. Aggregate the fills to compute a weighted average fill price,
 *      realised slippage and total fees.  Fees include the provided
 *      priority fee lamports times the number of parts.  A simple
 *      compute unit estimate is included for illustrative purposes.
 *   6. Return a detailed object describing the fills, route (placeholder),
 *      aggregate fill price, slippage in basis points, fees, latency
 *      and any failure reason.
 *
 * This module is intentionally conservative: if any unexpected input is
 * encountered it falls back to safe defaults.  The goal is to be
 * deterministic and side‑effect free.
 */

const crypto = require("crypto");

// Default latency values (ms) for quote→build→send→land phases
const DEFAULT_LATENCY = { quoteMs: 30, buildMs: 10, sendMs: 20, landMs: 400 };
// Default partial fill configuration
const DEFAULT_PARTIALS = { minParts: 1, maxParts: 1 };
// Default failure probabilities
const DEFAULT_FAILURE_RATES = {
  blockhashNotFound: 0.0,
  accountInUse: 0.0,
  slippageExceeded: 0.0,
  bundleNotLanded: 0.0,
};

// Helper: convert a value to a finite number or return default
function toNum(v, def = 0) {
  const n = Number(v);
  return isFinite(n) ? n : def;
}

// Simple seeded PRNG (mulberry32).  Takes a 32‑bit integer seed and
// returns a function that yields uniform random numbers in [0,1).
function mulberry32(a) {
  return function() {
    a |= 0; // force to 32 bits
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Derive a 32‑bit integer seed from an arbitrary string.  Uses a
// polynomial rolling hash for simplicity.  If the input is falsy the
// returned seed is based off of cryptographic entropy.
function deriveSeed(str) {
  if (!str) {
    // Fallback to crypto randomness and reduce to 32 bits
    const buf = crypto.randomBytes(4);
    return buf.readUInt32LE(0);
  }
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h + str.charCodeAt(i), 31);
    h |= 0; // force 32 bits
  }
  return h >>> 0;
}

/**
 * Build a seeded RNG function.  If a string seed is provided it is
 * first hashed into a 32‑bit integer.  When no seed is given the RNG
 * uses crypto entropy to derive one.  The returned function yields
 * deterministic pseudo‑random floats in [0,1).
 * @param {string} seedStr
 */
function buildRandom(seedStr) {
  const seed = deriveSeed(seedStr);
  return mulberry32(seed);
}

/**
 * Compute aggregate latency in milliseconds.  Accepts a latency
 * configuration object with quoteMs, buildMs, sendMs and landMs.
 * Missing values fall back to defaults.  Returns the sum of all
 * latency phases.
 * @param {object} latency
 */
function computeLatency(latency) {
  const cfg = latency || {};
  const merged = {
    ...DEFAULT_LATENCY,
    ...(typeof cfg === "object" ? cfg : {}),
  };
  return (
    toNum(merged.quoteMs) +
    toNum(merged.buildMs) +
    toNum(merged.sendMs) +
    toNum(merged.landMs)
  );
}

/**
 * Execute a paper trade simulation.  Returns a promise that resolves
 * with the simulation results.  The function does not perform any
 * asynchronous work but is declared async for forward compatibility.
 *
 * @param {object} params
 * @param {object} params.quote - the swap quote, expected to include
 *   inAmount and outAmount as BigInt or numeric strings.  If
 *   present, quote.price is used as the mid price; otherwise it is
 *   computed as outAmount/inAmount.
 * @param {string} params.mint - the output mint address (ignored here)
 * @param {object} params.meta - metadata passed through from the caller
 * @param {object} params.config - simulation parameters
 */
async function executePaperTrade({ quote = {}, mint, meta = {}, config = {} }) {
  // Build deterministic RNG
  const rand = buildRandom(config.seed);

  // Merge default configs
  const slippageCapBps = toNum(config.slippageBpsCap, 0);
  const failureRates = { ...DEFAULT_FAILURE_RATES, ...(config.failureRates || {}) };
  const partialsCfg = { ...DEFAULT_PARTIALS, ...(config.partials || {}) };
  // Ensure partial bounds are sane
  let minParts = Math.max(1, parseInt(partialsCfg.minParts) || 1);
  let maxParts = Math.max(minParts, parseInt(partialsCfg.maxParts) || minParts);

  // 1. Failure simulation.  Iterate through the failure codes in a
  // deterministic order and pick the first one that triggers.  If
  // multiple probabilities overlap only the first is applied.  This
  // yields stable results when seeding.
  let reason = null;
  for (const [code, rate] of Object.entries(failureRates)) {
    const r = toNum(rate, 0);
    if (r > 0 && rand() < r) {
      reason = code;
      break;
    }
  }
  // Compute latency regardless of failure so callers can record it
  const latencyMs = computeLatency(config.latency);
  if (reason) {
    return {
      fills: [],
      route_json: null,
      sim_fill_price: null,
      slippage_bps: null,
      fees_total_lamports: 0,
      latency_ms: latencyMs,
      reason_code: reason,
      priority_fee_lamports: toNum(config.priorityFeeLamports || 0),
      cu_estimate: 0,
    };
  }

  // 2. Determine number of parts
  let partsCount;
  if (minParts === maxParts) {
    partsCount = minParts;
  } else {
    const range = maxParts - minParts + 1;
    partsCount = minParts + Math.floor(rand() * range);
  }

  // 3. Compute mid price.  Use quote.price if available; otherwise
  // derive from outAmount/inAmount.  Fallback to 1 if nothing is
  // available to avoid NaN.
  let midPrice = 1;
  const inAmt = quote && quote.inAmount != null ? quote.inAmount : quote.amount;
  const outAmt = quote && quote.outAmount != null ? quote.outAmount : quote.expectedOutAmount;
  if (quote && typeof quote.price === "number" && isFinite(quote.price)) {
    midPrice = quote.price;
  } else if (inAmt != null && outAmt != null) {
    try {
      const inNum = typeof inAmt === "bigint" ? Number(inAmt) : Number(inAmt);
      const outNum = typeof outAmt === "bigint" ? Number(outAmt) : Number(outAmt);
      if (inNum > 0) midPrice = outNum / inNum;
    } catch (_) {
      /* ignore and keep default */
    }
  }

  // 4. Determine per‑part amounts.  We assume equal splitting for
  // simplicity.  Use numeric values; BigInt arithmetic is not needed
  // for simulation.  When amounts are unavailable default to 1.
  const totalOut = outAmt != null ? Number(outAmt) || 0 : 0;
  const totalIn = inAmt != null ? Number(inAmt) || 0 : 0;
  const partOut = partsCount > 0 ? totalOut / partsCount : 0;
  const partIn = partsCount > 0 ? totalIn / partsCount : 0;

  // 5. Build fills with random slippage
  const fills = [];
  let sumPrice = 0;
  let sumSlippageBps = 0;
  for (let i = 0; i < partsCount; i++) {
    // Draw slippage in [0, slippageCapBps]
    const slipBps = slippageCapBps > 0 ? rand() * slippageCapBps : 0;
    const slipPct = slipBps / 10_000; // basis points to percentage
    const price = midPrice * (1 + slipPct);
    fills.push({
      partIndex: i + 1,
      amountIn: partIn,
      amountOut: partOut,
      price,
      slippageBps: slipBps,
    });
    sumPrice += price;
    sumSlippageBps += slipBps;
  }

  // 6. Aggregate results
  const simFillPrice = partsCount > 0 ? sumPrice / partsCount : midPrice;
  const slippageBps = partsCount > 0 ? sumSlippageBps / partsCount : 0;
  const priorityFeeLamports = toNum(config.priorityFeeLamports || 0);
  // For demonstration we scale the CU estimate with parts
  const cuEstimate = 200_000 * partsCount;
  // Fees total lamports = priority fee per fill * fills count
  const feesTotalLamports = BigInt(priorityFeeLamports) * BigInt(partsCount);

  // Placeholder route.  In a real implementation this would
  // describe the AMM/orderbook hops taken.
  const routeJson = {
    model: config.execModel || "ideal",
    hops: 1,
  };

  const result = {
    fills,
    route_json: routeJson,
    sim_fill_price: simFillPrice,
    slippage_bps: slippageBps,
    fees_total_lamports: Number(feesTotalLamports),
    latency_ms: latencyMs,
    reason_code: null,
    priority_fee_lamports: priorityFeeLamports,
    cu_estimate: cuEstimate,
  };
  // ✨ Added in paper-sim-upgrade: record metrics when available.  If the
  // simMetrics module has been added to core (via simMetrics.js) we
  // capture latency, slippage, partial count and failure counts.  The
  // require is performed here to avoid static import cycles.
  try {
    const simMetrics = require('./simMetrics');
    if (simMetrics && typeof simMetrics.record === 'function') {
      simMetrics.record(result);
    }
  } catch (_) {
    /* nothing to do if simMetrics is unavailable */
  }
  return result;
}

module.exports = { executePaperTrade, computeLatency };