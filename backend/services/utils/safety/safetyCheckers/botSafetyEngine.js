/**
 *  leanSafetyEngine.js  –  v1.0
 *  ------------------------------------------------------------
 *  Slimmed-down runSafetyChecks for *auto* strategies (Sniper, etc.)
 *  • Drops the Birdeye “verified” flag entirely
 *  • Everything else is identical to fullSafetyEngine so
 *    import paths & result shape stay familiar
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });

const { checkBirdeyeLiquidity }   = require("./birdeyeLiquidityCheck");
const { checkMintAuthoritiesHybrid } = require("./hybridAuthCheck");
const getTopHolderStats           = require("./getTopHolderStats");
const { simulateAndCheckSwap }    = require("./jupiterSimulationCheck");
//  -> NO verified check here

/**
 * @param {string}  mint
 * @param {object}  filters – { simulation?, liquidity?, authority?, topHolders? }
 */
async function runBotSafetyChecks(mint, filters = {}) {
  // default: everything **on** except “verified”
  const want = Object.assign(
    { simulation: true, liquidity: true, authority: true, topHolders: true },
    filters
  );

  const results = {};

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

  return { passed: Object.values(results).every(r => r.passed), ...results };
}

module.exports = { runBotSafetyChecks };
