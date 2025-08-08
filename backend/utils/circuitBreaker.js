// Circuit breaker implementation with Prometheus instrumentation.
//
// The circuit breaker protects downstream services by halting calls when
// repeated failures occur.  This version tracks state transitions and
// updates metrics via the shared metrics module.  It also maintains
// per-service open vs closed counts in order to compute the ratio of
// short‑circuited calls.

const metrics = require('./metrics');

const breakers = new Map();
const FAILURE_THRESHOLD = parseInt(process.env.CB_FAILURE_THRESHOLD || '3', 10);
const COOLDOWN_MS = parseInt(process.env.CB_COOLDOWN_MS || '30000', 10);
const HALF_OPEN_SUCCESS_THRESHOLD = parseInt(
  process.env.CB_HALF_OPEN_SUCCESS_THRESHOLD || '1',
  10
);

// Maintain per‑service call stats to compute open ratios.  Each entry
// contains the number of times the circuit was opened and the number of
// times it was successfully closed.  The ratio is computed as
// open/(open+close).  These stats are updated whenever a state
// transition occurs.
const serviceStats = new Map();

function getStats(key) {
  if (!serviceStats.has(key)) {
    serviceStats.set(key, { open: 0, close: 0 });
  }
  return serviceStats.get(key);
}

function updateRatio(key) {
  const { open, close } = getStats(key);
  const total = open + close;
  const ratio = total === 0 ? 0 : open / total;
  metrics.updateBreakerOpenRatio(key, ratio);
}

function getBreaker(key) {
  if (!breakers.has(key)) {
    breakers.set(key, {
      state: 'CLOSED',
      failureCount: 0,
      nextAttempt: 0,
      successCount: 0,
    });
  }
  return breakers.get(key);
}

function before(key) {
  const b = getBreaker(key);
  const now = Date.now();
  if (b.state === 'OPEN') {
    if (now >= b.nextAttempt) {
      b.state = 'HALF_OPEN';
      b.successCount = 0;
      // Record half‑open transition
      metrics.recordCircuitBreakerEvent('half_open', key);
      return;
    }
    // This call is short‑circuited; count as an open event for ratio
    const stats = getStats(key);
    stats.open++;
    updateRatio(key);
    throw new Error(`Circuit for ${key} is open`);
  }
}

function success(key) {
  const b = getBreaker(key);
  if (b.state === 'HALF_OPEN') {
    b.successCount += 1;
    if (b.successCount >= HALF_OPEN_SUCCESS_THRESHOLD) {
      b.state = 'CLOSED';
      b.failureCount = 0;
      b.nextAttempt = 0;
      // Record closed transition
      metrics.recordCircuitBreakerEvent('close', key);
      // Update stats: closed count increments
      const stats = getStats(key);
      stats.close++;
      updateRatio(key);
    }
  } else {
    b.failureCount = 0;
  }
}

function fail(key) {
  const b = getBreaker(key);
  if (b.state === 'HALF_OPEN') {
    b.state = 'OPEN';
    b.nextAttempt = Date.now() + COOLDOWN_MS;
    b.failureCount = 0;
    b.successCount = 0;
    // Record open transition
    metrics.recordCircuitBreakerEvent('open', key);
    // Update stats: open count increments
    const stats = getStats(key);
    stats.open++;
    updateRatio(key);
    return;
  }
  b.failureCount += 1;
  if (b.failureCount >= FAILURE_THRESHOLD) {
    b.state = 'OPEN';
    b.nextAttempt = Date.now() + COOLDOWN_MS;
    // Record open transition
    metrics.recordCircuitBreakerEvent('open', key);
    const stats = getStats(key);
    stats.open++;
    updateRatio(key);
    b.failureCount = 0;
    b.successCount = 0;
  }
}

module.exports = {
  before,
  success,
  fail,
};