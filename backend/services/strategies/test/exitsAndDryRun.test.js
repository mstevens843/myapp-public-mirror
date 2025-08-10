const assert = require('assert');
const TradeExecutorTurbo = require('../core/tradeExecutorTurbo');

/**
 * Tests for the trade executor covering dry runs, take profit ladders,
 * trailing stops and direct AMM splitting.  The TradeExecutorTurbo
 * here is a stub implementation that simulates behaviour without
 * sending real transactions.  These tests exercise the core logic
 * introduced in the strategy finishing pack.
 */
async function run() {
  const exec = new TradeExecutorTurbo();

  // dryRun should return a simulated response
  let userCtx = { userId: 'u1', walletId: 'w1' };
  let tradeParams = { outputMint: 'Mint1' };
  let cfg = { dryRun: true };
  let res = await exec.executeTrade(userCtx, tradeParams, cfg);
  assert.strictEqual(res.simulated, true, 'dryRun should be simulated');
  assert.ok(/^sim_\d+/.test(res.tx), 'tx id should start with sim_');

  // TP ladder should produce exits of correct length
  userCtx = { userId: 'u2', walletId: 'w2' };
  tradeParams = { outputMint: 'Mint2' };
  cfg = { dryRun: true, tpLadder: '25,25,50' };
  res = await exec.executeTrade(userCtx, tradeParams, cfg);
  assert.ok(Array.isArray(res.exits), 'exits should be array');
  assert.strictEqual(res.exits.length, 3, 'should have 3 exit legs');
  assert.strictEqual(res.exits[0].pct, 25, 'first exit pct is 25');

  // Trailing stop should be included when provided
  cfg = { dryRun: true, trailingStopPct: 10 };
  res = await exec.executeTrade(userCtx, tradeParams, cfg);
  assert.strictEqual(res.trailingStopPct, 10, 'trailing stop pct propagated');

  // directAmmFirstPct should produce legs splitting the order
  cfg = { dryRun: true, directAmmFirstPct: 30 };
  res = await exec.executeTrade(userCtx, tradeParams, cfg);
  assert.ok(Array.isArray(res.legs), 'legs should be array when splitting');
  assert.strictEqual(res.legs[0].pct, 30);
  assert.strictEqual(res.legs[0].route, 'direct');
  assert.strictEqual(res.legs[1].pct, 70);
  assert.strictEqual(res.legs[1].route, 'router');

  console.log('exitsAndDryRun tests passed');
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = run;