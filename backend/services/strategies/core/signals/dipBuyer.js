/**
 * Dip Buyer signal helpers.
 *
 * Implements a capitulation detector for the Dip Buyer strategy.  The
 * detector identifies rapid price drops accompanied by volume spikes
 * and long lower wicks, indicating seller exhaustion and potential
 * bounce.  Integrators should supply recent candle data for analysis.
 */

/* eslint-disable no-console */

/**
 * Detect a capitulation event in a series of candles.  Returns true
 * when the last candle exhibits a large drop from the previous close,
 * volume is significantly higher than average, and the candle has a
 * long lower wick (close is above the low by some fraction).
 *
 * @param {Array<{open:number, high:number, low:number, close:number, volume:number}>} candles
 * @param {object} opts
 * @param {number} opts.dropPct - minimum % drop to consider capitulation
 * @param {number} opts.volumeSpike - minimum volume multiple relative to average
 * @param {number} opts.wickRatio - ratio of candle body to total range
 */
function detectCapitulation(candles, opts = {}) {
  const {
    dropPct = 0.1,
    volumeSpike = 2.0,
    wickRatio = 0.5,
  } = opts;
  if (!candles || candles.length < 2) return false;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const pctDrop = (prev.close - last.close) / prev.close;
  if (pctDrop < dropPct) return false;
  // Volume spike check
  const avgVol = candles.slice(0, -1).reduce((acc, c) => acc + c.volume, 0) / (candles.length - 1);
  if (last.volume < avgVol * volumeSpike) return false;
  // Wick ratio: ensure significant lower wick
  const range = last.high - last.low;
  const body = Math.abs(last.close - last.open);
  const lowerWick = (last.close < last.open) ? (last.close - last.low) : (last.open - last.low);
  const wickRatioActual = range ? lowerWick / range : 0;
  if (wickRatioActual < wickRatio) return false;
  return true;
}

module.exports = {
  detectCapitulation,
};