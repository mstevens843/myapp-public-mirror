// backend/services/strategies/core/quoteWarmCache.js
//
// Quote warm cache for Turbo Sniper.
//
// This module provides a lightweight, in‑memory cache for swap
// quotes keyed by input/output mints, amount, slippage and mode.
// Quotes are stored with a Time‑To‑Live (TTL) specified at
// construction time. When a quote is retrieved and has expired
// it is automatically discarded. The cache implementation uses
// a simple Map to store entries and a Set to track insertion
// order for eviction. When the cache size exceeds the maximum
// configured entries, the oldest entry is removed. This helps
// prevent memory bloat while still maximising reuse of recent
// quotes during high congestion periods.

'use strict';

class QuoteWarmCache {
  /**
   * Create a new QuoteWarmCache.
   * @param {Object} opts
   * @param {number} opts.ttlMs TTL in milliseconds for each entry.
   * @param {number} opts.maxEntries Maximum number of entries to retain.
   */
  constructor({ ttlMs = 600, maxEntries = 100 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map(); // key => { quote, expiresAt }
    this.order = []; // insertion order of keys
  }

  /**
   * Build a deterministic key from quote parameters. Nullish fields
   * are stringified as empty strings. The delimiter must not be
   * permitted in any of the fields.
   * @param {Object} params
   */
  static makeKey({ inputMint, outputMint, amount, slippage, mode }) {
    return [inputMint, outputMint, amount, slippage, mode]
      .map((v) => (v === undefined || v === null ? '' : String(v)))
      .join('|');
  }

  /**
   * Retrieve a cached quote if it is fresh.
   * @param {Object} params Parameters identical to those passed to makeKey().
   * @returns {Object|null} The cached quote or null if absent/expired.
   */
  get(params) {
    const key = QuoteWarmCache.makeKey(params);
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      // expired
      this.map.delete(key);
      const idx = this.order.indexOf(key);
      if (idx >= 0) this.order.splice(idx, 1);
      return null;
    }
    return entry.quote;
  }

  /**
   * Store a quote in the cache, evicting the oldest entry if
   * necessary.
   * @param {Object} params Parameters identical to those passed to makeKey().
   * @param {*} quote The quote object to cache.
   */
  set(params, quote) {
    const key = QuoteWarmCache.makeKey(params);
    const expiresAt = Date.now() + this.ttlMs;
    if (!this.map.has(key)) {
      // New entry – track insertion order
      this.order.push(key);
      // Evict if over capacity
      while (this.order.length > this.maxEntries) {
        const evictKey = this.order.shift();
        this.map.delete(evictKey);
      }
    }
    this.map.set(key, { quote, expiresAt });
  }
}

module.exports = QuoteWarmCache;