/**
 * tpSlManager.js
 *
 * Helper functions to generate take‑profit and stop‑loss ladder rules from
 * user configuration.  A ladder is specified as an array of percentages
 * summing to 100 (e.g., [25, 25, 50]) along with a target profit
 * percentage (tpPercent).  The manager will compute partial take‑profit
 * triggers for each rung of the ladder.  Additionally, a trailing stop
 * percentage may be specified; once the highest take‑profit rung is
 * reached, the stop loss will trail behind the new high by the trailing
 * percentage.  This approach provides a more sophisticated exit plan
 * compared to a single TP/SL threshold, mimicking professional trading
 * strategies【753266132506355†L324-L333】【753266132506355†L335-L344】.
 */

const { v4: uuid } = require("uuid");

/**
 * Generate TP/SL rule objects from a ladder specification.
 *
 * @param {Object} params Parameters
 * @param {string} mint Token mint address
 * @param {string} walletId Internal wallet ID
 * @param {string} userId User ID
 * @param {string} strategy Strategy name
 * @param {number[]} ladder Array of percentages summing to ≤ 100
 * @param {number} tpPercent Profit target in percent (e.g., 20 for +20%)
 * @param {number} slPercent Stop‑loss percent (negative number for -10%)
 * @returns {Object[]} Array of rule objects to insert into the tpSlRule table
 */
function buildLadderRules({
  mint,
  walletId,
  userId,
  strategy,
  ladder = [],
  tpPercent = 0,
  slPercent = 0,
}) {
  const rules = [];
  // Normalize ladder percentages
  const total = ladder.reduce((sum, p) => sum + Math.max(0, p), 0);
  const normalized = ladder.map((p) => (total > 0 ? (p / total) : 0));
  let accum = 0;
  normalized.forEach((weight, idx) => {
    accum += weight;
    rules.push({
      id: uuid(),
      mint,
      walletId,
      userId,
      strategy,
      tp: null,
      sl: null,
      tpPercent: +((tpPercent || 0) * accum).toFixed(4),
      slPercent: +(slPercent || 0),
      enabled: true,
      force: false,
      status: "active",
      failCount: 0,
    });
  });
  return rules;
}

module.exports = { buildLadderRules };