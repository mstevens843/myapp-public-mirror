/**
 * Localnet bootstrap script.
 *
 * In a full Solana development environment this module would start a
 * `solana-test-validator` process, airdrop SOL to a test wallet and
 * create temporary mint accounts for use in integration tests.  It
 * would then return the mint addresses and any other artefacts needed
 * by the tests.  Because this repository does not depend on the
 * Solana CLI or @solana/web3.js, this implementation simply
 * generates random base58 strings to stand in for mints and keys.
 *
 * You can replace the body of `bootstrap()` with real network setup
 * when running tests on an environment with access to the Solana
 * toolchain.
 */
const crypto = require('crypto');

function randomKey() {
  // Generate a random 32‑byte buffer and return it as a hex string.  In
  // the real implementation you might use bs58.encode() instead but
  // bs58 is not bundled in this mirror to keep dependencies light.
  return crypto.randomBytes(32).toString('hex');
}

async function bootstrap() {
  // In a real implementation you would spawn `solana-test-validator` here
  // and wait for it to be ready, then create tokens via the CLI or
  // web3.js.  For now we just generate dummy identifiers.
  const payer = randomKey();
  const mintA = randomKey();
  const mintB = randomKey();
  return { payer, mintA, mintB };
}

module.exports = bootstrap;

if (require.main === module) {
  bootstrap().then((res) => console.log(res));
}