// backend/services/strategies/core/tokenResolver.js
//
// Cross‑Feed Token Resolver
// -------------------------
//
// This module merges multiple token detection feeds and returns the
// earliest available result.  When hunting for new tokens the bot
// often has several independent sources of truth (e.g. websocket
// listeners, Birdeye API feeds, and on‑chain probes).  Each source
// has different latency characteristics; by racing them in parallel
// and choosing the first successful result we maximise inclusion
// without waiting on slower fallbacks.  Results are memoised for a
// short TTL to avoid redundant lookups during bursts of activity.
//
// The resolver accepts a configuration object with the following
// properties:
//   order:     An array of feed names in priority order.  Valid
//              entries are 'ws', 'birdeye' and 'onchain'.  The
//              resolver will attempt to obtain token lists from
//              these sources concurrently and pick whichever
//              responds first with a non‑empty result.
//   ttlMs:     Time‑to‑live in milliseconds for cached results.  A
//              cached response will be returned immediately until
//              this TTL expires.  Defaults to 800ms.
//   timeoutMs: Per‑feed timeout in milliseconds.  If a feed does
//              not resolve within this window it is ignored.  The
//              default is 400ms.
//
// The returned value from `resolve()` is always an array of token
// mints.  If all feeds fail the resolver returns an empty array.
//
// Metrics:
//   resolver_source_win_total{source} – incremented when a source
//     wins the race.  The label 'source' corresponds to one of
//     'ws', 'birdeye' or 'onchain'.
//   resolver_latency_ms – histogram of end‑to‑end resolution time.
//   resolver_cache_hit_total – incremented when a cached result is
//     returned without contacting any feeds.

'use strict';

const { incCounter, observeHistogram } = require('../logging/metrics');
const resolveTokenFeed = require('../paid_api/tokenFeedResolver');

/**
 * A minimal implementation of a cross‑feed token resolver.  At
 * present only the Birdeye feed is fully supported – websocket and
 * on‑chain feeds are provided as stubs for future extension.  If
 * additional feeds become available they can be added to the
 * resolver by implementing the corresponding `resolve*` method.
 */
class TokenResolver {
  /**
   * Construct a new resolver.
   *
   * @param {Object} config
   * @param {string[]} [config.order] Preferred feed order.
   * @param {number} [config.ttlMs] Cache TTL in milliseconds.
   * @param {number} [config.timeoutMs] Per‑feed timeout in milliseconds.
   */
  constructor(config = {}) {
    this.order = Array.isArray(config.order) && config.order.length
      ? config.order
      : ['ws', 'birdeye', 'onchain'];
    this.ttlMs = Number(config.ttlMs) || 800;
    this.timeoutMs = Number(config.timeoutMs) || 400;
    this.cache = new Map(); // key -> { ts, result }
  }

  /**
   * Resolve a list of token mints by racing configured feeds.
   *
   * @param {string} strategyName Name of the calling strategy (e.g. 'sniper').
   * @param {Object} cfg Strategy configuration passed through to
   *   downstream feed resolvers.
   * @param {string|null} userId Optional user identifier for API
   *   quotas.  When omitted the feeds may infer defaults.
   * @returns {Promise<string[]>} A list of token mints.  An empty
   *   array indicates that no feed produced a result.
   */
  async resolve(strategyName, cfg = {}, userId = null) {
    // Build a deterministic key from the inputs to memoise results.
    const cacheKey = JSON.stringify({ strategyName, cfg });
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.ts < this.ttlMs) {
      incCounter('resolver_cache_hit_total');
      return hit.result;
    }
    const t0 = Date.now();
    // Kick off all feed promises.  Each feed resolves to an object
    // containing its name and result array.  Feeds that throw or
    // timeout will resolve to an empty array to ensure the race can
    // complete.
    const feedPromises = this.order.map((source) => {
      switch (source) {
        case 'ws':
          return this._withTimeout(
            this.resolveWs(cfg).catch(() => []),
            this.timeoutMs
          ).then((res) => ({ source, res }));
        case 'birdeye':
          return this._withTimeout(
            this.resolveBirdeye(strategyName, cfg, userId).catch(() => []),
            this.timeoutMs
          ).then((res) => ({ source, res }));
        case 'onchain':
          return this._withTimeout(
            this.resolveOnchain(cfg).catch(() => []),
            this.timeoutMs
          ).then((res) => ({ source, res }));
        default:
          // Unknown source – resolve to empty.
          return Promise.resolve({ source, res: [] });
      }
    });
    let winner = null;
    let winnerSource = null;
    // Race: as soon as any feed resolves with a non‑empty list we
    // capture it as the winner.  Note that Promise.race returns only
    // the first settled promise; we therefore attach an extra then
    // handler to each promise to inspect its value without waiting for
    // race resolution.
    await Promise.race(
      feedPromises.map((p) =>
        p.then(({ source, res }) => {
          if (!winner && Array.isArray(res) && res.length > 0) {
            winner = res;
            winnerSource = source;
          }
          return null;
        })
      )
    );
    const latency = Date.now() - t0;
    observeHistogram('resolver_latency_ms', latency);
    if (winner) {
      incCounter('resolver_source_win_total', { source: winnerSource });
      this.cache.set(cacheKey, { ts: Date.now(), result: winner });
      return winner;
    }
    // If no feed won during the race, fall back to whichever feed
    // eventually returns a non‑empty array.  This ensures we still
    // surface tokens even if all sources are slow.
    const results = await Promise.allSettled(feedPromises);
    for (const { value } of results) {
      if (value && Array.isArray(value.res) && value.res.length > 0) {
        incCounter('resolver_source_win_total', { source: value.source });
        this.cache.set(cacheKey, { ts: Date.now(), result: value.res });
        return value.res;
      }
    }
    // No source returned anything.
    return [];
  }

  /**
   * Wrap a promise with a timeout.  If the promise does not
   * settle within the specified duration it resolves to an empty
   * array.  This helper prevents slow feeds from blocking the race.
   *
   * @param {Promise<any>} promise
   * @param {number} ms
   * @returns {Promise<any>}
   */
  _withTimeout(promise, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve([]), ms);
      promise.then((val) => {
        clearTimeout(timer);
        resolve(val);
      }).catch(() => {
        clearTimeout(timer);
        resolve([]);
      });
    });
  }

  /**
   * Resolve tokens from a websocket feed.  This implementation is
   * currently a stub – in a real deployment you would integrate
   * with a live websocket service (e.g. pump.fun or a custom
   * aggregator) and return any newly detected mints.
   *
   * @param {Object} cfg
   * @returns {Promise<string[]>}
   */
  async resolveWs(/* cfg */) {
    // No websocket resolver implemented yet.  Return an empty list.
    return [];
  }

  /**
   * Resolve tokens via the Birdeye API.  This delegates to the
   * existing tokenFeedResolver which fetches feeds based on the
   * strategy and configuration (e.g. new listings or trending
   * tokens).  See paid_api/tokenFeedResolver.js for details.
   *
   * @param {string} strategyName
   * @param {Object} cfg
   * @param {string|null} userId
   * @returns {Promise<string[]>}
   */
  async resolveBirdeye(strategyName, cfg, userId) {
    try {
      const mints = await resolveTokenFeed(strategyName, cfg, userId);
      return Array.isArray(mints) ? mints : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Resolve tokens from on‑chain activity.  This method is a stub
   * placeholder – advanced users may wish to subscribe to pool
   * creation events or inspect program logs directly.  For now we
   * return an empty list to allow the resolver to proceed without
   * blocking.
   *
   * @param {Object} cfg
   * @returns {Promise<string[]>}
   */
  async resolveOnchain(/* cfg */) {
    // On‑chain probing not implemented.  Return an empty list.
    return [];
  }
}

/**
 * Factory function to create a resolver.  Exporting a function
   rather than the class directly allows callers to supply
   configuration concisely: `const resolver = createTokenResolver(cfg);`.
 *
 * @param {Object} config
 * @returns {TokenResolver}
 */
module.exports = function createTokenResolver(config = {}) {
  return new TokenResolver(config);
};