/*
 * Tests for the retry matrix implemented in tradeExecutorTurbo.js.  These
 * tests exercise the three error classes (NET, USER and UNKNOWN) and
 * validate that the executor applies the correct number of retries and
 * backoff delays.  Jitter is eliminated by overriding Math.random() and
 * the backoff delays are captured by monkey‑patching setTimeout() to
 * record the requested delay while executing immediately.
 */

const assert = require('assert');

const {
  execTrade,
  getQuoteCache,
  sleep,
  // class exported for completeness
  classifyError,
} = require('../core/tradeExecutorTurbo');

// Helper to populate the quote cache so that quotes are considered fresh.  The
// quote must match the parameters used by execTrade() when constructing the
// cache key.
function primeCache(ttlMs, quote, bundleStrategy = 'topOfBlock') {
  const cache = getQuoteCache(ttlMs);
  cache.set(
    {
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      amount: String(quote.inAmount ?? quote.amount),
      slippage: quote.slippage ?? 0,
      mode: bundleStrategy,
    },
    quote,
  );
}

async function testNetRetry() {
  const recorded = [];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn, delay, ...args) => {
    recorded.push(delay);
    // execute the callback immediately to avoid slowing down tests
    return originalSetTimeout(fn, 0, ...args);
  };
  const origRandom = Math.random;
  // Force jitter factor to 1.0 (0.5 + 0.5) so delays are deterministic
  Math.random = () => 0.5;

  const quote = { inputMint: 'A', outputMint: 'B', amount: '100', slippage: 0 };
  const meta = {
    quoteTtlMs: 1000,
    idKey: 'net-test',
    idempotencyTtlSec: 5,
    retryPolicy: { max: 3, netBaseBackoffMs: 100 },
  };
  primeCache(meta.quoteTtlMs, quote);
  let callCount = 0;
  const sendFunc = async () => {
    callCount++;
    if (callCount < 3) {
      throw new Error('connection timed out');
    }
    return 'tx-hash';
  };
  const result = await execTrade({ quote, meta, sendFunc });
  assert.strictEqual(result.status, 'SUCCESS');
  // Two retries before success means two backoffs recorded
  assert.strictEqual(recorded.length, 2);
  // With jitter forced to 1.0, delays follow 100ms, 200ms
  assert.strictEqual(recorded[0], 100);
  assert.strictEqual(recorded[1], 200);
  // Clean up
  global.setTimeout = originalSetTimeout;
  Math.random = origRandom;
}

async function testUserNoRetry() {
  const recorded = [];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn, delay, ...args) => {
    recorded.push(delay);
    return originalSetTimeout(fn, 0, ...args);
  };
  const quote = { inputMint: 'A', outputMint: 'C', amount: '100', slippage: 0 };
  const meta = {
    quoteTtlMs: 500,
    idKey: 'user-test',
    idempotencyTtlSec: 5,
    retryPolicy: { max: 3, netBaseBackoffMs: 100 },
  };
  primeCache(meta.quoteTtlMs, quote);
  let threw = false;
  const sendFunc = async () => {
    throw new Error('Insufficient funds');
  };
  try {
    await execTrade({ quote, meta, sendFunc });
  } catch (e) {
    threw = true;
    // Classification should be USER
    assert.strictEqual(classifyError(e.message), 'USER');
  }
  assert.ok(threw, 'expected a USER error to be thrown');
  // No retries should occur for USER errors
  assert.strictEqual(recorded.length, 0);
  global.setTimeout = originalSetTimeout;
}

async function testUnknownRetry() {
  const recorded = [];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (fn, delay, ...args) => {
    recorded.push(delay);
    return originalSetTimeout(fn, 0, ...args);
  };
  const quote = { inputMint: 'X', outputMint: 'Y', amount: '100', slippage: 0 };
  const meta = {
    quoteTtlMs: 500,
    idKey: 'unknown-test',
    idempotencyTtlSec: 5,
    retryPolicy: { max: 3, unknownBackoffMs: 50, netBaseBackoffMs: 100 },
  };
  primeCache(meta.quoteTtlMs, quote);
  let callCount = 0;
  const sendFunc = async () => {
    callCount++;
    if (callCount < 2) {
      throw new Error('Something unexpected');
    }
    return 'tx-unknown';
  };
  const result = await execTrade({ quote, meta, sendFunc });
  assert.strictEqual(result.status, 'SUCCESS');
  // Unknown should produce exactly one backoff
  assert.strictEqual(recorded.length, 1);
  assert.strictEqual(recorded[0], 50);
  global.setTimeout = originalSetTimeout;
}

async function run() {
  await testNetRetry();
  await testUserNoRetry();
  await testUnknownRetry();
  console.log('retryMatrix.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});