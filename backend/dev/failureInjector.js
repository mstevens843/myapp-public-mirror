'use strict';

/**
 * failureInjector.js (dev-only)
 * -------------------------------------------
 * Purpose: deterministically or probabilistically inject failures at
 * specific call sites to exercise retries/fallbacks, without real network.
 *
 * Safety:
 *  - Disabled by default and in production.
 *  - Enable by setting FAIL_INJECT=1 (prefer locally).
 *
 * Supported failure kinds:
 *  - 'aggregator_500'   → throw new Error('Aggregator HTTP 500')
 *  - 'rpc_429'          → throw new Error('429 Too Many Requests')
 *  - 'stale_blockhash'  → throw new Error('Blockhash not found')
 *  - 'pool_illiquidity' → throw new Error('insufficient liquidity')
 *
 * Config (env):
 *  FAIL_INJECT=1                     // master switch
 *  FAIL_RATE_DEFAULT=0               // default probability (0..1)
 *  FAIL_RATE_AGGREGATOR_500=0.05     // per-kind probability
 *  FAIL_RATE_RPC_429=0.02
 *  FAIL_RATE_STALE_BLOCKHASH=0.03
 *  FAIL_RATE_POOL_ILLIQUIDITY=0.01
 *
 *  // Optional "first N hits" per kind (consumes then stops)
 *  FAIL_COUNT_AGGREGATOR_500=2
 *  FAIL_COUNT_RPC_429=1
 *
 *  // Deterministic PRNG seed (optional)
 *  FAIL_SEED=abc123
 *
 * Programmatic control:
 *  const inj = require('<repo>/backend/dev/failureInjector');
 *  inj.set('rpc_429', { rate: 0.1 });      // 10% rate
 *  inj.set('aggregator_500', { count: 3 }); // first 3 calls fail
 *  inj.enable(); inj.disable();
 */

const NODE_ENV = String(process.env.NODE_ENV || '').toLowerCase();
let ENABLED = process.env.FAIL_INJECT === '1' && NODE_ENV !== 'production';

const upper = (k) => String(k || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');

// Simple seeded PRNG (mulberry32)
function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

let _rand = Math.random;
const _seedStr = process.env.FAIL_SEED || '';
if (_seedStr) {
  let s = 0;
  for (let i = 0; i < _seedStr.length; i++) s = (s * 31 + _seedStr.charCodeAt(i)) >>> 0;
  _rand = mulberry32(s);
}

// State stores for per-kind config and stats
const _remainingCounts = new Map();    // kind -> remaining fail count
const _rates = new Map();              // kind -> probability (0..1)
const _tags = new Map();               // kind -> occurrences

function _envRate(kind) {
  const def = Number(process.env.FAIL_RATE_DEFAULT || 0) || 0;
  const specific = Number(process.env[`FAIL_RATE_${upper(kind)}`] || NaN);
  return Number.isFinite(specific) ? specific : def;
}

function _envCount(kind) {
  const c = Number(process.env[`FAIL_COUNT_${upper(kind)}`] || NaN);
  return Number.isFinite(c) ? Math.max(0, Math.floor(c)) : 0;
}

function _getRate(kind) {
  if (_rates.has(kind)) return _rates.get(kind);
  const r = _envRate(kind);
  _rates.set(kind, r);
  return r;
}

function _getCount(kind) {
  if (_remainingCounts.has(kind)) return _remainingCounts.get(kind);
  const c = _envCount(kind);
  _remainingCounts.set(kind, c);
  return c;
}

function _decCount(kind) {
  const c = _getCount(kind);
  if (c > 0) _remainingCounts.set(kind, c - 1);
  return c;
}

function _should(kind) {
  if (!ENABLED) return false;

  // Consume "first N hits" budget first
  const c = _getCount(kind);
  if (c > 0) {
    _decCount(kind);
    return true;
  }

  // Else fall back to probability
  const rate = _getRate(kind);
  if (!rate || rate <= 0) return false;
  return _rand() < rate;
}

function _makeError(kind) {
  switch (kind) {
    case 'aggregator_500': {
      const e = new Error('Aggregator HTTP 500');
      e.code = 'AGGREGATOR_500';
      e.status = 500;
      return e;
    }
    case 'rpc_429': {
      const e = new Error('429 Too Many Requests');
      e.code = 'RPC_429';
      e.status = 429;
      return e;
    }
    case 'stale_blockhash': {
      const e = new Error('Blockhash not found');
      e.code = 'STALE_BLOCKHASH';
      return e;
    }
    case 'pool_illiquidity': {
      const e = new Error('insufficient liquidity');
      e.code = 'POOL_ILLIQUIDITY';
      return e;
    }
    default: {
      const e = new Error(`Injected failure: ${kind}`);
      e.code = 'INJECTED';
      return e;
    }
  }
}

/**
 * maybe(kind): async no-op unless configured to fail; throws an
 * appropriate error when the injection triggers.
 */
async function maybe(kind, _labels) {
  if (_should(kind)) {
    tag(kind, _labels);
    throw _makeError(kind);
  }
}

/**
 * maybeThrow(kind): same as maybe() but sync signature.
 */
function maybeThrow(kind, _labels) {
  if (_should(kind)) {
    tag(kind, _labels);
    throw _makeError(kind);
  }
}

/**
 * maybeStaleBlockhash({throwOnHit=false}) → boolean
 * Returns true if a stale blockhash should be injected. If throwOnHit=true,
 * also throws the error.
 */
function maybeStaleBlockhash(opts = {}) {
  const hit = _should('stale_blockhash');
  if (hit) {
    tag('stale_blockhash', opts.labels);
    if (opts.throwOnHit) throw _makeError('stale_blockhash');
  }
  return hit;
}

/**
 * tag(kind, labels): track an occurrence (for ad-hoc counters/logs).
 */
function tag(kind, labels) {
  const k = String(kind || 'unknown');
  const { count = 0 } = _tags.get(k) || {};
  _tags.set(k, { count: count + 1, last: Date.now(), labels });
}

/** Programmatic controls */
function set(kind, cfg = {}) {
  if (cfg.rate != null) _rates.set(kind, Number(cfg.rate) || 0);
  if (cfg.count != null) _remainingCounts.set(kind, Math.max(0, Math.floor(cfg.count)));
}
function enable() { ENABLED = true; }
function disable() { ENABLED = false; }
function reset() { _rates.clear(); _remainingCounts.clear(); _tags.clear(); }

module.exports = {
  // primary API
  maybe,           // await devInject.maybe('aggregator_500')
  maybeThrow,      // devInject.maybeThrow('rpc_429')
  maybeStaleBlockhash,

  // telemetry helper
  tag,

  // programmatic controls
  set, enable, disable, reset,

  // tiny state peeks (for tests)
  _state: {
    get enabled() { return ENABLED; },
    get rates() { return new Map(_rates); },
    get remainingCounts() { return new Map(_remainingCounts); },
    get tags() { return new Map(_tags); },
  },
};
