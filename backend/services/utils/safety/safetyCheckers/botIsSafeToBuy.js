// services/utils/safety/safetyChecks.js
// ------------------------------------------------------------
//  Public helpers consumed by routes & strategies.
//  • isSafeToBuyDetailed → returns full breakdown
//  • isSafeToBuy        → returns boolean only
// ------------------------------------------------------------
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });
const { runBotSafetyChecks } = require("./botSafetyEngine");

/**
 * @param {string} mint
 * @param {object} options – fine-grained check toggles (e.g. { topHolders:false })
 * @returns {Promise<object>} – { passed, simulation, liquidity, … }
 */
async function isSafeToBuyDetailed(mint, options = {}) {
  /* fast-exit: “all off” means auto-pass */
  if (
    options === false ||                                     // disableSafety master flag
    (typeof options === "object" &&
      Object.keys(options).length > 0 &&
      Object.values(options).every((v) => v === false))      // every flag false, but not for empty {}
  ) {
    return { passed: true };
  }

  const result = await runBotSafetyChecks(mint, options);

  if (!result.passed) {
    console.warn("⛔ Safety failed:", JSON.stringify(result, null, 2));
  }
  return result;
}

/**
 * Lightweight bool-only gate for bot logic.
 * Respects cfg.safetyEnabled & cfg.safetyChecks from strategy config.
 *
 * @param {string} mint
 * @param {object} cfg  – Bot config (may contain safetyEnabled, safetyChecks)
 * @returns {Promise<boolean>}
 */
async function isSafeToBuy(mint, cfg = {}) {
  // fast exit if user disabled safety entirely
  if (cfg.safetyEnabled === false) return true;

  const filters = cfg.safetyChecks || {}; // same shape used in modal presets
  const { passed } = await runBotSafetyChecks(mint, filters);

  if (!passed) {
    console.warn("⛔ Safety failed for", mint);
  }
  return passed;
}

module.exports = {
  isSafeToBuyDetailed,
  isSafeToBuy,
};