/**
 * Scalper signal helpers.
 *
 * This module provides microstructure and mean‑reversion signals used
 * exclusively by the Scalper strategy.  The signals here attempt to
 * identify small deviations around a volume‑weighted average price
 * (VWAP) or Keltner channel and opportunistically enter quick
 * mean‑reversion trades.  They also expose lightweight order book
 * proxies to detect spreads and recent fill imbalance when available.
 *
 * The helpers operate on cached tick data; integrators should supply
 * recent price and volume samples when invoking the signal methods.
 */

/* eslint-disable no-console */

/**
 * Compute a simple VWAP given an array of price/volume samples.
 * Each sample should be an object with `price` and `volume` keys.
 * @param {{price:number, volume:number}[]} samples
 * @returns {number}
 */
function vwap(samples) {
  let pv = 0;
  let vol = 0;
  for (const s of samples) {
    pv += s.price * s.volume;
    vol += s.volume;
  }
  return vol ? pv / vol : 0;
}

/**
 * Determine whether the current price lies near the VWAP
 * mean‑reversion zone.  Accepts an array of recent samples and the
 * current price.  Returns a score: negative for below the VWAP
 * (potential long), positive for above (potential short).  A near‑zero
 * score indicates no actionable edge.
 *
 * @param {{price:number, volume:number}[]} samples
 * @param {number} currentPrice
 * @returns {number}
 */
function meanReversionScore(samples, currentPrice) {
  const vw = vwap(samples);
  const deviation = (currentPrice - vw) / vw;
  return deviation;
}

/**
 * Estimate order book imbalance given recent fills.  Expects an
 * array of fill objects with `side` ("buy" or "sell") and size.
 * Returns the fraction of buys minus sells over the last `n` fills.
 * @param {{side:string, size:number}[]} fills
 * @returns {number} range [-1,1]
 */
function orderBookImbalance(fills) {
  if (!fills || fills.length === 0) return 0;
  let buy = 0;
  let sell = 0;
  for (const f of fills) {
    if (f.side === "buy") buy += f.size;
    else if (f.side === "sell") sell += f.size;
  }
  const total = buy + sell;
  return total ? (buy - sell) / total : 0;
}

/**
 * High level scalper signal that combines mean‑reversion and order
 * imbalance.  If the price is slightly below VWAP and imbalance is
 * leaning to buys, returns "long".  If price is above VWAP and
 * imbalance leans to sells, returns "short".  Otherwise returns
 * `null`.
 * @param {{price:number, volume:number}[]} samples
 * @param {number} currentPrice
 * @param {{side:string, size:number}[]} fills
 * @param {number} threshold
 * @returns {"long"|"short"|null}
 */
function generateScalperSignal(samples, currentPrice, fills, threshold = 0.003) {
  const dev = meanReversionScore(samples, currentPrice);
  const imbalance = orderBookImbalance(fills);
  // Consider only small deviations; outside range we avoid trading
  if (Math.abs(dev) > threshold * 2) return null;
  if (dev < -threshold && imbalance > 0) return "long";
  if (dev > threshold && imbalance < 0) return "short";
  return null;
}

module.exports = {
  vwap,
  meanReversionScore,
  orderBookImbalance,
  generateScalperSignal,
};