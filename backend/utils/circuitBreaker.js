// copied from backend/utils/circuitBreaker.js
const breakers = new Map();
const FAILURE_THRESHOLD = parseInt(process.env.CB_FAILURE_THRESHOLD || '3', 10);
const COOLDOWN_MS = parseInt(process.env.CB_COOLDOWN_MS || '30000', 10);
const HALF_OPEN_SUCCESS_THRESHOLD = parseInt(
  process.env.CB_HALF_OPEN_SUCCESS_THRESHOLD || '1',
  10
);
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
      console.warn(`[CircuitBreaker] entering HALF_OPEN for ${key}`);
    } else {
      throw new Error(`Circuit for ${key} is open`);
    }
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
      console.warn(`[CircuitBreaker] CLOSED → success for ${key}`);
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
    console.warn(`[CircuitBreaker] HALF_OPEN → OPEN for ${key}`);
    return;
  }
  b.failureCount += 1;
  if (b.failureCount >= FAILURE_THRESHOLD) {
    b.state = 'OPEN';
    b.nextAttempt = Date.now() + COOLDOWN_MS;
    console.warn(`[CircuitBreaker] CLOSED → OPEN for ${key}`);
    b.failureCount = 0;
    b.successCount = 0;
  }
}
module.exports = {
  before,
  success,
  fail,
};