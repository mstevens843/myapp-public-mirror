/*
 * Simplified Turbo trade executor used for testing retry logic, idempotency and
 * quote time‑to‑live guards.  This module intentionally omits the majority
 * of the production implementation to avoid requiring external services.
 * It retains the public function names and signatures expected by tests
 * (classifyError, idTtlCheckAndSet, getQuoteCache and execTrade) and
 * implements a deterministic retry matrix driven by classifyError().  In
 * addition it surfaces helpers for sleeping and metrics instrumentation
 * (inc/observe) to facilitate introspection during tests.
 */

'use strict';

// -----------------------------------------------------------------------------
// Error classification (unchanged from upstream)
// -----------------------------------------------------------------------------
// Messages matching any of the NET_ERRS expressions are considered
// infrastructure/network failures and should be retried with exponential
// backoff.  USER_ERRS cause an immediate failure with no retry.  All other
// errors fall under the UNKNOWN category and are retried exactly once with
// a small fixed backoff.
const NET_ERRS = [/blockhash/i, /node is behind/i, /timed? out/i, /connection/i, /getblockheight timed out/i];
const USER_ERRS = [/slippage/i, /insufficient funds/i, /mint.*not found/i, /account in use/i, /slippage exceeded/i];

/**
 * Classify a thrown error into USER, NET or UNKNOWN based on its message.
 * @param {string} msg Error message
 * @returns {string}
 */
function classifyError(msg = '') {
  const lower = String(msg).toLowerCase();
  if (USER_ERRS.some(r => r.test(lower))) return 'USER';
  if (NET_ERRS.some(r => r.test(lower)))  return 'NET';
  return 'UNKNOWN';
}

// -----------------------------------------------------------------------------
// Quote warm cache
// -----------------------------------------------------------------------------
// A very small in‑memory TTL cache keyed by quote parameters.  Instances are
// created per TTL bucket via getQuoteCache().  Quotes expire automatically
// after ttlMs and are removed on retrieval.  This is sufficient for tests
// exercising stale vs fresh quote behaviour.
class QuoteWarmCache {
  constructor({ ttlMs = 600, maxEntries = 100 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.map = new Map(); // key => { quote, expiresAt }
    this.order = [];
  }
  static makeKey({ inputMint, outputMint, amount, slippage, mode }) {
    return [inputMint, outputMint, amount, slippage, mode]
      .map(v => (v === undefined || v === null ? '' : String(v)))
      .join('|');
  }
  /** Retrieve a quote if it is still valid. */
  get(params) {
    const key = QuoteWarmCache.makeKey(params);
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      // expired entry – remove and return null
      this.map.delete(key);
      const idx = this.order.indexOf(key);
      if (idx >= 0) this.order.splice(idx, 1);
      return null;
    }
    return entry.quote;
  }
  /** Store a quote with expiry tracking. */
  set(params, quote) {
    const key = QuoteWarmCache.makeKey(params);
    const expiresAt = Date.now() + this.ttlMs;
    if (!this.map.has(key)) {
      this.order.push(key);
      // evict oldest if over capacity
      while (this.order.length > this.maxEntries) {
        const evictKey = this.order.shift();
        this.map.delete(evictKey);
      }
    }
    this.map.set(key, { quote, expiresAt });
  }
}

// Shared caches keyed by TTL.  Each call to getQuoteCache(ttl) returns the
// same QuoteWarmCache instance for that ttl to enable stale/fresh detection.
const _quoteCaches = new Map();

/**
 * Retrieve a QuoteWarmCache for the given TTL.  The TTL is coerced to a
 * number and used as the map key.  New caches are created on demand.
 * @param {number} ttlMs
 * @returns {QuoteWarmCache}
 */
function getQuoteCache(ttlMs = 600) {
  const key = Number(ttlMs) || 0;
  if (!_quoteCaches.has(key)) {
    _quoteCaches.set(key, new QuoteWarmCache({ ttlMs: key, maxEntries: 200 }));
  }
  return _quoteCaches.get(key);
}

// -----------------------------------------------------------------------------
// Idempotency gate
// -----------------------------------------------------------------------------
// A simple map tracks recently used idKeys and their expiry.  If the same
// idKey is seen again before its TTL expires the operation is skipped.  This
// mechanism works entirely in‑memory and is deterministic for the life of the
// process.
const _idTtlGate = new Map();

/**
 * Check whether an idKey has recently been used.  If not, record the key with
 * its expiry.  If the key is still within its TTL window this returns false.
 * Passing a falsy idKey or ttlSec disables the check and always returns true.
 * @param {string} idKey
 * @param {number} ttlSec
 * @returns {boolean}
 */
function idTtlCheckAndSet(idKey, ttlSec = 60) {
  if (!idKey || !ttlSec) return true;
  const now = Date.now();
  const exp = _idTtlGate.get(idKey);
  if (exp && exp > now) return false;
  _idTtlGate.set(idKey, now + ttlSec * 1000);
  return true;
}

// -----------------------------------------------------------------------------
// Metrics helpers
// -----------------------------------------------------------------------------
// These helpers mimic the production metrics API.  They never throw and
// silently ignore missing implementations.  Tests may override inc() and
// observe() via module exports if desired.
function inc(counter, value = 1, labels) {
  try {
    if (typeof exports.__metricsLogger?.increment === 'function') {
      exports.__metricsLogger.increment(counter, value, labels);
    }
  } catch (_) {}
}

function observe(name, value, labels = {}) {
  try {
    if (typeof exports.__metricsLogger?.observe === 'function') {
      exports.__metricsLogger.observe(name, value, labels);
    }
  } catch (_) {}
}

// -----------------------------------------------------------------------------
// Sleep helper
// -----------------------------------------------------------------------------
// A thin wrapper around setTimeout used to implement backoffs.  Exported for
// tests to override behaviour (for example, to record the requested delay and
// fast‑forward time).
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// Main executor
// -----------------------------------------------------------------------------
/**
 * Execute a trade with retry, idempotency and quote TTL guards.  The caller
 * must supply a quote and a meta object containing at minimum a quoteTtlMs
 * value, a stable idKey and retryPolicy settings.  A sendFunc callback is
 * invoked to perform the actual network send.  The sendFunc receives the
 * current attempt index (starting at zero) and should either return a
 * transaction signature or throw an error.  The returned object has a
 * status field of 'SUCCESS' on success or 'SKIP_DUPLICATE' when idempotency
 * blocks the send.  Errors thrown by sendFunc propagate to the caller.
 *
 * @param {Object} opts
 * @param {Object} opts.quote
 * @param {Object} opts.meta
 * @param {Function} opts.sendFunc
 */
async function execTrade({ quote, meta = {}, sendFunc }) {
  if (!quote) throw new Error('quote is required');
  if (typeof sendFunc !== 'function') throw new Error('sendFunc must be provided');

  // Destructure meta with sensible defaults
  const {
    quoteTtlMs = 600,
    idKey,
    idempotencyTtlSec,
    idempotency = {},
    retryPolicy = {},
    bundleStrategy = 'topOfBlock',
  } = meta;
  const ttlSec = idempotencyTtlSec ?? idempotency.ttlSec ?? 60;

  // Determine the quote key parameters.  For simplicity this uses the
  // inAmount/amount and slippage fields present on the quote.  The mode
  // corresponds to bundleStrategy.
  const keyParams = {
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    amount: String(quote.inAmount ?? quote.amount),
    slippage: quote.slippage ?? 0,
    mode: bundleStrategy,
  };

  // Quote TTL guard: reject stale quotes.  getQuoteCache() returns a cache
  // dedicated to the supplied TTL; stale entries are automatically removed.
  const cache = getQuoteCache(quoteTtlMs);
  const cached = cache.get(keyParams);
  if (!cached) {
    // Stale quote – do not attempt a network send
    inc('quote_stale_total', 1);
    throw new Error('stale_quote');
  }

  // Send once with retry logic
  async function sendOnce(localQuote) {
    let attempt = 0;
    const maxAttempts = Math.max(1, Number(retryPolicy.max ?? 3));
    // Backoff configuration: base delays are configurable via retryPolicy
    const netBase = Number(retryPolicy.netBaseBackoffMs ?? 100);
    const unknownDelay = Number(retryPolicy.unknownBackoffMs ?? 200);
    let lastError;

    // Enforce deterministic idempotency once before any network send.
    // Subsequent retries from the same invocation should not recheck the gate
    // because they are part of the same logical trade attempt.
    if (!idTtlCheckAndSet(idKey, ttlSec)) {
      inc('idempotency_skipped_total', 1);
      return { status: 'SKIP_DUPLICATE' };
    }

    while (attempt < maxAttempts) {
      try {
        const t0 = Date.now();
        const tx = await sendFunc(attempt);
        observe('submit_ms', Date.now() - t0);
        inc('send_success_total', 1);
        return { status: 'SUCCESS', tx };
      } catch (err) {
        lastError = err;
        attempt += 1;
        const cls = classifyError(err?.message || err?.toString());
        // USER errors: no retry
        if (cls === 'USER') {
          inc('send_user_error_total', 1);
          throw err;
        }
        // If out of attempts stop here
        if (attempt >= maxAttempts) {
          inc(cls === 'NET' ? 'send_net_error_total' : 'send_unknown_error_total', 1);
          throw err;
        }
        // UNKNOWN: one retry with small backoff
        if (cls === 'UNKNOWN') {
          if (attempt === 1) {
            inc('send_retry_total', 1);
            await sleep(unknownDelay);
            continue;
          } else {
            throw err;
          }
        }
        // NET: exponential backoff with jitter
        if (cls === 'NET') {
          // attempt is 1‑indexed here (already incremented)
          const exponent = Math.pow(2, attempt - 1);
          let delay = netBase * exponent;
          // jitter: random factor between 0.5 and 1.5
          const jitter = 0.5 + Math.random();
          delay = Math.floor(delay * jitter);
          inc('send_retry_total', 1);
          await sleep(delay);
          continue;
        }
        // Fallback: treat as unknown
        inc('send_retry_total', 1);
        await sleep(unknownDelay);
      }
    }
    // If here, propagate last error
    throw lastError;
  }
  return await sendOnce(quote);
}

module.exports = {
  classifyError,
  idTtlCheckAndSet,
  getQuoteCache,
  execTrade,
  sleep,
  inc,
  observe,
  // Expose metrics logger hook for tests
  __metricsLogger: null,
};