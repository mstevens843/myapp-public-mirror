/**
 * Special “API-friendly” wrapper around runSafetyChecks
 * ----------------------------------------------------
 * • An **empty** options object ⇒ run **all** checks (unlike bot logic).
 * • Explicit flags still respected (e.g. { liquidity:false }).
 * • Returns the same rich object shape used by the frontend.
 */

const { runSafetyChecks } = require("./fullSafetyEngine");

function normalizeOptions(opt) {
  // null/undefined → run all checks
  if (!opt || typeof opt !== "object" || !Object.keys(opt).length) return {
    simulation : true,
    liquidity  : true,
    authority  : true,
    topHolders : true,
    verified   : true,
  };
  return opt; // caller supplied explicit switches
}

/**
 * @param {string} mint
 * @param {object|null|undefined} options
 * @returns {Promise<object>} – full safety breakdown
 */
async function isSafeToBuyDetailedAPI(mint, options) {
  const result = await runSafetyChecks(mint, normalizeOptions(options));

  // mirror bot helper: add top-level “passed” flag (excluding contract-type info)
  result.passed = Object.values(result)
    .filter(r => r && r.key !== "topHolderContract")
    .every(r => r.passed);

  return result;
}

module.exports = { isSafeToBuyDetailedAPI };
