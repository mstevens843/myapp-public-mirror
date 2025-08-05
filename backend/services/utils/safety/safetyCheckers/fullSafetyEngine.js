// ------------------------------------------------------------
//  Runs all safety checkers and returns a rich breakdown.
//  Accepts `filters` (boolean flags) to skip individual checks.
// ------------------------------------------------------------

// ⛔ Old free version — now commented out
// const { checkBirdeyeLiquidity } = require("./birdeyeLiquidityCheck");
// const { checkBirdeyeVerified } = require("./birdeyeVerifiedCheck");

// ✅ Replaced with paid versions
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });

const { checkBirdeyeLiquidity } = require("./birdeyeLiquidityCheck");
const { checkBirdeyeVerified } = require("./birdeyeVerifiedCheck");

const { checkMintAuthoritiesHybrid } = require("./hybridAuthCheck");
const getTopHolderStats             = require("./getTopHolderStats");
const { simulateAndCheckSwap }      = require("./jupiterSimulationCheck");

/**
 * Run every enabled safety check.
 * @param {string}  mint
 * @param {object}  filters – { simulation?:bool, liquidity?:bool, authority?:bool, topHolders?:bool, verified?:bool }
 *                            true  => run check (default)
 *                            false => skip and auto-pass
 */
async function runSafetyChecks(mint, filters = {}) {
  // default → everything on
  const want = Object.assign(
    { simulation: true, liquidity: true, authority: true, topHolders: true, verified: true },
    filters
  );

  const results = {};

  // ───────────────────── individual checks ─────────────────────
  results.simulation = want.simulation
    ? await simulateAndCheckSwap(mint)
    : { key: "simulation", label: "Honeypot / Illiquidity", passed: true, reason: "Skipped", detail: null };

  results.liquidity = want.liquidity
    ? await checkBirdeyeLiquidity(mint)
    : { key: "liquidity", label: "Liquidity", passed: true, reason: "Skipped", detail: null };

  results.authority = want.authority
    ? await checkMintAuthoritiesHybrid(mint)
    : { key: "authority", label: "Mint / Freeze Authority", passed: true, reason: "Skipped", detail: null };

  results.topHolders = want.topHolders
    ? await getTopHolderStats(mint)
    : { key: "topHolders", label: "Whale Concentration", passed: true, reason: "Skipped", detail: null };

  results.verified = want.verified
    ? await checkBirdeyeVerified(mint)
    : { key: "verified", label: "Birdeye Verified", passed: true, reason: "Skipped", detail: null };

  // ⬇️ Additional contract-level analysis
  // results.topHolderContract = await checkTopHolderContract(mint);
  // console.log("Top Holder Contract Result:", results.topHolderContract);

  // Final status
  const allPassed = Object.values(results).every(r => r.passed);

  return { passed: allPassed, ...results };
}

module.exports = { runSafetyChecks };
