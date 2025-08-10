const assert = require('assert');
const validateEnv = require('../envSchema');

/**
 * Nodeâ€‘style tests for the environment schema validator.  Each test
 * manipulates process.env, calls validateEnv(), and asserts whether
 * an error is thrown.  To run these tests individually execute
 * `node backend/utils/__tests__/envSchema.test.js`.  When this module
 * is imported the exported run() function can be invoked by a
 * higherâ€‘level test harness.
 */

function run() {
  const originalEnv = { ...process.env };
  try {
    // Test missing required variable
    process.env.SOLANA_RPC_URL = 'https://example.com';
    delete process.env.PRIVATE_KEY;
    process.env.IDEMPOTENCY_SALT = 'salt';
    assert.throws(() => validateEnv(), /PRIVATE_KEY is required/);

    // Test invalid URL
    process.env.SOLANA_RPC_URL = 'not-a-url';
    process.env.PRIVATE_KEY = '123456789ABCDEFG';
    process.env.IDEMPOTENCY_SALT = 'salt';
    assert.throws(() => validateEnv(), /must be a valid http\(s\) URL/);

    // Test TP ladder sum > 100
    process.env.SOLANA_RPC_URL = 'https://example.com';
    process.env.PRIVATE_KEY = '123456789ABCDEFG';
    process.env.IDEMPOTENCY_SALT = 'salt';
    process.env.TP_LADDER = '50,60';
    assert.throws(() => validateEnv(), /sum to 100 or less/);

    // Test valid configuration
    process.env.SOLANA_RPC_URL = 'https://example.com';
    process.env.PRIVATE_KEY = '123456789ABCDEFG';
    process.env.IDEMPOTENCY_SALT = 'salt';
    process.env.TP_LADDER = '25,25,50';
    assert.doesNotThrow(() => validateEnv());
    console.log('envSchema tests passed');
  } finally {
    // Restore original environment
    process.env = { ...originalEnv };
  }
}

if (require.main === module) {
  run();
}

module.exports = run;