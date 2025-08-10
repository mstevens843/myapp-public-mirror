const path = require('path');

/**
 * Top level test runner.  This script sequentially executes all test
 * modules located under backend/tests and backend/utils/__tests__
 * without requiring Jest or any external framework.  Each test file
 * exports a run() function which performs assertions and logs its
 * own success messages.  If any test throws an error the runner
 * reports failure and exits with a non‑zero status.
 */
async function run() {
  const tests = [
    // utils
    '../utils/__tests__/envSchema.test.js',
    '../utils/__tests__/logScrubber.test.js',
    // helpers
    './utils/ammFallbackGuard.test.js',
    // strategies
    '../services/strategies/test/exitsAndDryRun.test.js',
    // localnet
    './localnet/turbo.executor.int.test.js',
    // replay harness
    './replay/replayHarness.js',
  ];
  for (const file of tests) {
    const modulePath = path.join(__dirname, file);
    const testFunc = require(modulePath);
    if (typeof testFunc !== 'function') {
      throw new Error(`Test module ${file} does not export a function`);
    }
    await testFunc();
  }
  console.log('All tests passed');
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = run;