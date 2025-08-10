/*
 * Tests for executeSwap() and executeSwapTurbo() ensuring that the
 * computeUnitPriceMicroLamports and tipLamports parameters are forwarded
 * correctly to the constructed payload.  Both functions should honour
 * the new parameters when provided and fall back to the legacy
 * priorityFee/briberyAmount otherwise.
 */

const assert = require('assert');
const { executeSwap, executeSwapTurbo } = require('../swap');

// Minimal wallet stub with the required publicKey.toBase58() method
const wallet = {
  publicKey: {
    toBase58: () => 'wallet123',
  },
};

async function testExplicitFees() {
  const quote = { id: 'q' };
  const cuPrice = 12345;
  const tip = 6789;
  const res = await executeSwap({ quote, wallet, computeUnitPriceMicroLamports: cuPrice, tipLamports: tip });
  assert.ok(res && res.payload, 'executeSwap should return a payload');
  assert.strictEqual(res.payload.computeUnitPriceMicroLamports, cuPrice);
  assert.strictEqual(res.payload.tipLamports, tip);
  const resTurbo = await executeSwapTurbo({ quote, wallet, computeUnitPriceMicroLamports: cuPrice, tipLamports: tip });
  assert.ok(resTurbo && resTurbo.payload);
  assert.strictEqual(resTurbo.payload.computeUnitPriceMicroLamports, cuPrice);
  assert.strictEqual(resTurbo.payload.tipLamports, tip);
}

async function testFallbackFees() {
  const quote = { id: 'q2' };
  const priorityFee = 555;
  const bribery = 666;
  const res = await executeSwap({ quote, wallet, priorityFee, briberyAmount: bribery });
  assert.strictEqual(res.payload.computeUnitPriceMicroLamports, priorityFee);
  assert.strictEqual(res.payload.tipLamports, bribery);
  const resTurbo = await executeSwapTurbo({ quote, wallet, priorityFee, briberyAmount: bribery });
  assert.strictEqual(resTurbo.payload.computeUnitPriceMicroLamports, priorityFee);
  assert.strictEqual(resTurbo.payload.tipLamports, bribery);
}

async function run() {
  await testExplicitFees();
  await testFallbackFees();
  console.log('swapFeeKnobs.test.js passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});