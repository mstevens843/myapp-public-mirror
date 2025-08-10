/*
 * Tests for the quote TTL guard in execTrade().  A quote must reside in
 * the warm cache with a nonâ€‘expired TTL for the execution to proceed.
 * When the quote is missing or expired the executor should throw an
 * error before attempting a send.
 */

const assert = require('assert');
const { execTrade, getQuoteCache } = require('../core/tradeExecutorTurbo');

function primeCache(ttlMs, quote) {
  const cache = getQuoteCache(ttlMs);
  cache.set(
    {
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      amount: String(quote.inAmount ?? quote.amount),
      slippage: quote.slippage ?? 0,
      mode: 'topOfBlock',
    },
    quote,
  );
}

async function testFreshQuote() {
  const quote = { inputMint: 'Q', outputMint: 'W', amount: '10', slippage: 0 };
  const meta = { quoteTtlMs: 50, idKey: 'fresh', idempotencyTtlSec: 1, retryPolicy: { max: 1 } };
  primeCache(meta.quoteTtlMs, quote);
  let sent = false;
  const sendFunc = async () => {
    sent = true;
    return 'tx-fresh';
  };
  const res = await execTrade({ quote, meta, sendFunc });
  assert.strictEqual(res.status, 'SUCCESS');
  assert.ok(sent, 'sendFunc should be called for a fresh quote');
}

async function testStaleQuote() {
  const quote = { inputMint: 'Q', outputMint: 'W', amount: '10', slippage: 0 };
  const meta = { quoteTtlMs: 30, idKey: 'stale', idempotencyTtlSec: 1, retryPolicy: { max: 1 } };
  // Do not prime the cache â€“ quote should be considered stale
  let called = false;
  const sendFunc = async () => {
    called = true;
    return 'tx-stale';
  };
  let caught = false;
  try {
    await execTrade({ quote, meta, sendFunc });
  } catch (e) {
    caught = true;
    assert.strictEqual(e.message, 'stale_quote');
  }
  assert.ok(caught, 'expected stale_quote error');
  assert.strictEqual(called, false, 'sendFunc should not be called for stale quote');
}

async function testExpiredQuote() {
  const quote = { inputMint: 'R', outputMint: 'S', amount: '5', slippage: 0 };
  const meta = { quoteTtlMs: 20, idKey: 'expire', idempotencyTtlSec: 1, retryPolicy: { max: 1 } };
  primeCache(meta.quoteTtlMs, quote);
  // Wait beyond TTL to expire the cached quote
  await new Promise((r) => setTimeout(r, 50));
  let called = false;
  const sendFunc = async () => {
    called = true;
    return 'tx-expired';
  };
  let threw = false;
  try {
    await execTrade({ quote, meta, sendFunc });
  } catch (e) {
    threw = true;
    assert.strictEqual(e.message, 'stale_quote');
  }
  assert.ok(threw, 'expected stale_quote error due to expiry');
  assert.strictEqual(called, false);
}

async function run() {
  await testFreshQuote();
  await testStaleQuote();
  await testExpiredQuote();
  console.log('quoteTtlGuard.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});