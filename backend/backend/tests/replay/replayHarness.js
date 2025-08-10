const fs = require('fs');
const path = require('path');
const assert = require('assert');
// Resolve TradeExecutorTurbo relative to this file.  Two directories up
// to reach `backend/services` from `backend/tests/replay`.
const TradeExecutorTurbo = require('../../services/strategies/core/tradeExecutorTurbo');

/**
 * Replay harness for fixtures.  Each fixture defines a test case with
 * meta parameters passed to the trade executor and assertions on the
 * returned object.  The harness loads all JSON files in the
 * `backend/tests/fixtures` directory and runs them sequentially.
 */
async function run() {
  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  const files = fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
  let passed = 0;
  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
    const name = fixture.name || file;
    const meta = fixture.meta || {};
    const outputMint = fixture.outputMint || 'MintZ';
    const expected = fixture.expected || {};
    // The userId and walletId are required by TradeExecutorTurbo; if not
    // provided in meta they will be set here to satisfy the contract.
    if (!meta.userId) meta.userId = `replay-${name}`;
    if (!meta.walletId) meta.walletId = `wallet-${name}`;
    const exec = new TradeExecutorTurbo();
    let res;
    try {
      res = await exec.executeTrade({ userId: meta.userId, walletId: meta.walletId }, { outputMint }, meta);
    } catch (err) {
      throw new Error(`Fixture ${name} failed with error: ${err.message}`);
    }
    // Assert basic expected properties
    if ('simulated' in expected) {
      assert.strictEqual(res.simulated, expected.simulated, `${name}: simulated flag mismatch`);
    }
    if ('exitsLength' in expected) {
      assert.ok(Array.isArray(res.exits), `${name}: exits should be array`);
      assert.strictEqual(res.exits.length, expected.exitsLength, `${name}: exits length mismatch`);
    }
    if ('trailingStopPct' in expected) {
      assert.strictEqual(res.trailingStopPct, expected.trailingStopPct, `${name}: trailingStopPct mismatch`);
    }
    if ('legs' in expected) {
      assert.ok(Array.isArray(res.legs), `${name}: legs should be present`);
      assert.deepStrictEqual(res.legs, expected.legs, `${name}: legs mismatch`);
    }
    passed++;
  }
  console.log(`replayHarness: passed ${passed} fixture tests`);
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = run;