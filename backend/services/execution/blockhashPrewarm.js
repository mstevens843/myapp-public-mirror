/**
 * backend/services/execution/blockhashPrewarm.js
 *
 * A lightweight utility to continuously prewarm and cache the most
 * recent blockhash from a Solana RPC connection.  In order to
 * construct transactions quickly it is important to have a fresh
 * blockhash on hand.  This module exposes two functions:
 *
 *   - startBlockhashPrewarm({ connection, intervalMs, ttlMs }):
 *     begins a background loop which periodically fetches a new
 *     blockhash from the provided connection.  The returned object
 *     exposes a stop() method that can be invoked to cancel the
 *     interval.  The interval will fetch immediately once at
 *     start and then again every `intervalMs` milliseconds.
 *
 *   - getCachedBlockhash():
 *     returns the most recently cached blockhash information or
 *     null if the cached entry is stale beyond the configured
 *     time-to-live.  The returned object has the shape:
 *       { blockhash, lastValidBlockHeight, ts }
 *     where `ts` is a timestamp (ms since epoch) when the blockhash
 *     was fetched.  Consumers should check for null and fall back
 *     to `connection.getLatestBlockhash()` as needed.
 */

'use strict';

// Internal storage for the cached blockhash.  Each entry tracks
// the blockhash, its last valid block height and the timestamp when
// it was refreshed.  The ttlMs is persisted alongside for stale
// expiry calculations.
let _cache = null;
let _intervalId = null;

/**
 * Starts the background refresh loop.  This function kicks off
 * an immediate fetch of the latest blockhash and continues to fetch
 * at the supplied interval.  A handle with a stop() method is
 * returned which should be called to clean up the timer when the
 * strategy is shut down or during tests.
 *
 * @param {Object} params
 * @param {Object} params.connection A Solana RPC connection with
 *   a `getLatestBlockhash` method.
 * @param {number} [params.intervalMs=400] How often to refresh in ms.
 * @param {number} [params.ttlMs=1200] How long the cached entry is
 *   considered fresh in ms.  If a consumer calls getCachedBlockhash()
 *   after the ttl has elapsed the function will return null.
 * @returns {{stop: Function}} A handle that can be used to stop
 *   the refresh loop.
 */
function startBlockhashPrewarm({ connection, intervalMs = 400, ttlMs = 1200 } = {}) {
  if (!connection || typeof connection.getLatestBlockhash !== 'function') {
    throw new Error('startBlockhashPrewarm requires a connection with getLatestBlockhash()');
  }
  // Immediately fetch once on start
  async function refresh() {
    try {
      const info = await connection.getLatestBlockhash();
      if (info && info.blockhash) {
        _cache = {
          blockhash: info.blockhash,
          lastValidBlockHeight: info.lastValidBlockHeight,
          ts: Date.now(),
          ttlMs,
        };
      }
    } catch (err) {
      // Silently ignore errors; the next interval will try again.
    }
  }
  // Trigger the initial refresh asynchronously so the caller does
  // not block on an RPC request.
  refresh();
  // Clear any existing interval before starting a new one.  This
  // allows callers to restart the prewarm loop without leaking timers.
  if (_intervalId) {
    clearInterval(_intervalId);
  }
  _intervalId = setInterval(refresh, intervalMs);
  return {
    stop() {
      if (_intervalId) {
        clearInterval(_intervalId);
        _intervalId = null;
      }
    },
  };
}

/**
 * Returns the currently cached blockhash if one exists and is
 * considered fresh.  If the cached entry has expired beyond the
 * configured ttlMs the cache is cleared and the function returns
 * null.  Consumers should then call `connection.getLatestBlockhash()`
 * themselves.
 *
 * @returns {{blockhash: string, lastValidBlockHeight: number, ts: number} | null}
 */
function getCachedBlockhash() {
  if (_cache) {
    const { ts, ttlMs } = _cache;
    if (Date.now() - ts < ttlMs) {
      // Return a shallow copy to prevent accidental mutation of
      // internal state by consumers.
      const { blockhash, lastValidBlockHeight } = _cache;
      return { blockhash, lastValidBlockHeight, ts };
    }
    // Stale entry; clear it so subsequent calls don’t return an
    // expired blockhash and allow a fresh fetch.
    _cache = null;
  }
  return null;
}

module.exports = { startBlockhashPrewarm, getCachedBlockhash };
