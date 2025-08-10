/*
 * Tests for the idempotency TTL gate.  Repeated calls with the same
 * idKey within the TTL window should skip duplicate execution and return
 * a status of 'SKIP_DUPLICATE'.  Once the TTL has elapsed the gate is
 * cleared and new executions proceed normally.
 */

const assert = require('assert');

const { execTrade, getQuoteCache } = require('../core/tradeExecutorTurbo');

// Populate the cache for a given quote and TTL
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

async function testIdempotencySkip() {
  const quote = { inputMint: 'A', outputMint: 'B', amount: '1', slippage: 0 };
  const meta = {
    quoteTtlMs: 500,
    idKey: 'dup-key',
    idempotencyTtlSec: 1,
    retryPolicy: { max: 1 },
  };
  primeCache(meta.quoteTtlMs, quote);
  let sendCount = 0;
  const sendFunc = async () => {
    sendCount++;
    return 'tx-idem';
  };
  const res1 = await execTrade({ quote, meta, sendFunc });
  assert.strictEqual(res1.status, 'SUCCESS');
  // Second invocation should be skipped due to idempotency gate
  const res2 = await execTrade({ quote, meta, sendFunc });
  assert.strictEqual(res2.status, 'SKIP_DUPLICATE');
  // Ensure sendFunc was only called once
  assert.strictEqual(sendCount, 1);
}

async function testIdempotencyExpires() {
  // After TTL expiry the gate should allow a new execution
  const quote = { inputMint: 'X', outputMint: 'Y', amount: '2', slippage: 0 };
  const meta = {
    quoteTtlMs: 200,
    idKey: 'expire-key',
    idempotencyTtlSec: 1,
    retryPolicy: { max: 1 },
  };
  primeCache(meta.quoteTtlMs, quote);
  let sendCount = 0;
  const sendFunc = async () => {
    sendCount++;
    return 'tx-expire';
  };
  const res1 = await execTrade({ quote, meta, sendFunc });
  assert.strictEqual(res1.status, 'SUCCESS');
  // Wait slightly longer than TTL before next call
  await new Promise((r) => setTimeout(r, 1100));
  // Prime the cache again so the quote is fresh
  primeCache(meta.quoteTtlMs, quote);
  const res2 = await execTrade({ quote, meta, sendFunc });
  assert.strictEqual(res2.status, 'SUCCESS');
  // sendFunc should have been called twice
  assert.strictEqual(sendCount, 2);
}

async function run() {
  await testIdempotencySkip();
  await testIdempotencyExpires();
  console.log('idempotencyTtl.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});