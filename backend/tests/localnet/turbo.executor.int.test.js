const assert = require('assert');
const bootstrap = require('./bootstrap');
const TradeExecutorTurbo = require('../../services/strategies/core/tradeExecutorTurbo');

/**
 * Integration tests for the turbo executor on a localnet.  These
 * tests exercise behaviour such as slippage handling and
 * idempotency deduplication.  Because we do not actually connect to a
 * Solana validator in this environment, the tests rely on the
 * stubbed TradeExecutorTurbo implementation to simulate outcomes.
 */
async function run() {
  const { mintA } = await bootstrap();
  const exec = new TradeExecutorTurbo();
  const userCtx = { userId: 'int-user', walletId: 'int-wallet' };

  // Happy path: slippage within limits should succeed
  let params = { outputMint: mintA };
  let cfg = { dryRun: false, slippagePct: 0.5, maxSlippagePct: 1.0 };
  let res = await exec.executeTrade(userCtx, params, cfg);
  assert.strictEqual(res.simulated, false, 'happy path should not be simulated');
  assert.ok(res.tx, 'tx id should be present');

  // Slippage fail: slippagePct > maxSlippagePct should throw
  cfg = { dryRun: false, slippagePct: 2.0, maxSlippagePct: 1.0 };
  let threw = false;
  try {
    await exec.executeTrade(userCtx, params, cfg);
  } catch (err) {
    threw = true;
    assert(/slippage/.test(err.message), 'error should mention slippage');
  }
  assert.strictEqual(threw, true, 'expected slippage failure');

  // Idempotency dedupe: second call with same key within TTL returns cached
  const idempotencyKey = 'abc123';
  cfg = { dryRun: true, idempotencyKey, idempotencyTtlMs: 5000 };
  const first = await exec.executeTrade(userCtx, params, cfg);
  const second = await exec.executeTrade(userCtx, params, cfg);
  assert.deepStrictEqual(second, first, 'second call should return cached result');
  console.log('turbo.executor.int tests passed');
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = run;