const assert = require('assert');
const { scrub } = require('../logScrubber');

/**
 * Node‑style tests for the log scrubber.  The log scrubber searches
 * for long base58 substrings and redacts them leaving only the last
 * four characters.  This test ensures that redaction occurs for
 * sufficiently long strings and that shorter strings are left
 * untouched.
 */
function run() {
  // Redacts long base58 strings
  const input = 'Here is a key: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk';
  const output = scrub(input);
  assert(!output.includes('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijk'), 'long base58 should be redacted');
  assert(/\*\*\*\*…[A-Za-z0-9]{4}/.test(output), 'redacted form should include ellipsis and last 4 chars');

  // Does not over‑redact short strings
  const shortInput = 'Short string ABCD';
  const shortOutput = scrub(shortInput);
  assert.strictEqual(shortOutput, shortInput, 'short strings should be unchanged');
  console.log('logScrubber tests passed');
}

if (require.main === module) {
  run();
}

module.exports = run;