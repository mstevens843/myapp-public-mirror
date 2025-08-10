/**
 * Breakout signal helpers.
 *
 * This module implements additional breakout detection logic to
 * differentiate the Breakout strategy from Sniper and other mid‑tier
 * strategies.  In particular, it exposes a helper to detect Bollinger
 * Band squeezes and volatility expansions on a short window.  When the
 * rolling standard deviation of price data drops below a squeeze
 * threshold and subsequently expands above a separate expansion
 * threshold while volume surges, a breakout is considered to be in
 * progress.
 *
 * Note:  This helper uses a very simple in‑process implementation of
 * Bollinger Bands and does not make external network calls.  It expects
 * callers to provide recent candle data in the form of an array of
 * objects with `open`, `high`, `low`, `close`, and `volume`
 * properties.  In production this data would be sourced from an in
 * memory cache or a lightweight paid API, but for dry‑run mode dummy
 * arrays can be passed in.
 */

/* eslint-disable no-console */

/**
 * Calculate the simple moving average (SMA) for an array of numbers.
 * @param {number[]} values
 * @returns {number}
 */
function sma(values) {
  if (!values || values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

/**
 * Calculate the sample standard deviation for an array of numbers.
 * @param {number[]} values
 * @param {number} mean
 * @returns {number}
 */
function stddev(values, mean) {
  if (!values || values.length === 0) return 0;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compute Bollinger Band values for the provided candle data.  Returns
 * an object containing the moving average (mid), the lower band and
 * upper band.  The `window` parameter controls how many candles are
 * considered.  A `multiplier` controls the width of the bands.
 *
 * @param {Array<{open:number, high:number, low:number, close:number, volume:number}>} candles
 * @param {number} window
 * @param {number} multiplier
 */
function computeBollinger(candles, window = 20, multiplier = 2) {
  const closes = candles.slice(-window).map(c => c.close);
  const avg = sma(closes);
  const sd = stddev(closes, avg);
  return {
    mid: avg,
    lower: avg - multiplier * sd,
    upper: avg + multiplier * sd,
    stddev: sd,
  };
}

/**
 * Detect a volatility breakout by comparing the recent standard
 * deviations against thresholds.  A squeeze is detected when the
 * standard deviation stays below `squeezeThreshold` for `squeezeLookback`
 * consecutive candles.  A subsequent expansion is detected when the
 * standard deviation exceeds `expansionMultiplier` × the average
 * standard deviation of the squeeze period.  Volume must also exceed
 * `minVolumeSurge` (relative to the average volume of the squeeze
 * period).  If all conditions are met, the function returns true.
 *
 * @param {Array<{open:number, high:number, low:number, close:number, volume:number}>} candles
 * @param {object} opts
 * @param {number} opts.squeezeThreshold - maximum stddev during squeeze
 * @param {number} opts.expansionMultiplier - multiplier for expansion
 * @param {number} opts.squeezeLookback - number of candles to confirm squeeze
 * @param {number} opts.minVolumeSurge - minimum volume multiplier on expansion
 * @returns {boolean}
 */
function detectVolatilityBreakout(candles, opts = {}) {
  const {
    squeezeThreshold = 0.002,
    expansionMultiplier = 2.0,
    squeezeLookback = 10,
    minVolumeSurge = 2.0,
  } = opts;
  if (!candles || candles.length < squeezeLookback + 2) return false;
  // Compute stddev series for the entire window
  const stdSeries = [];
  const volumes = [];
  for (let i = 0; i < candles.length; i++) {
    const slice = candles.slice(Math.max(0, i - squeezeLookback + 1), i + 1);
    const closes = slice.map(c => c.close);
    const avg = sma(closes);
    stdSeries.push(stddev(closes, avg));
    volumes.push(sma(slice.map(c => c.volume)));
  }
  // Identify the squeeze: last squeezeLookback candles below threshold
  const recentStd = stdSeries.slice(-squeezeLookback);
  const recentVol = volumes.slice(-squeezeLookback);
  const avgStd = sma(recentStd);
  const avgVol = sma(recentVol);
  const inSqueeze = recentStd.every(sd => sd < squeezeThreshold);
  if (!inSqueeze) return false;
  // Now check the latest candle for expansion and volume surge
  const lastStd = stdSeries[stdSeries.length - 1];
  const lastVol = candles[candles.length - 1].volume;
  const expansion = lastStd > avgStd * expansionMultiplier;
  const volSurge = lastVol > avgVol * minVolumeSurge;
  return expansion && volSurge;
}

module.exports = {
  sma,
  stddev,
  computeBollinger,
  detectVolatilityBreakout,
};