// backend/services/strategies/core/heuristics/insiderDetector.js
//
// Insider detection heuristics attempt to identify patterns where
// the deployer of a token or their close associates snipe the
// liquidity pool immediately after creation.  Such behaviour often
// precedes rugs or manipulative trading.  This module exposes a
// single async function, `insiderDetector`, which analyses the
// available context and returns an object indicating whether the
// token passes the heuristics and an optional reason.  The
// implementation below is intentionally conservative and largely
// illustrative; in a production environment this function should
// query on‑chain data and known exploit patterns to produce a
// meaningful result.

/**
 * Detect insider activity on a newly initialised token.  The caller
 * should provide as much context as possible, including the mint,
 * pool info (if available), deployer or creator address and any
 * funding relationships.  When no actionable intelligence is
 * present the function assumes the token passes the insider
 * heuristic.
 *
 * @param {Object} ctx Context for the heuristic
 * @param {string} ctx.mint Token mint address
 * @param {Object} [ctx.poolInfo] Pool information such as signature
 *   and programId
 * @param {string} [ctx.deployer] Deployer or creator public key
 * @param {Array<string>} [ctx.fundingAddresses] Addresses that
 *   funded initial liquidity
 * @param {Object} [cfg] Optional configuration (unused)
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function insiderDetector(ctx = {}, cfg = {}) {
  try {
    const { mint, deployer, fundingAddresses } = ctx;
    // Placeholder heuristic: if the deployer address appears in the
    // funding addresses then classify it as insider activity.  In
    // real deployments you would inspect transaction histories,
    // examine same‑block creations and monitor cluster logs for
    // unusual behaviour.
    if (deployer && Array.isArray(fundingAddresses) && fundingAddresses.includes(deployer)) {
      return { ok: false, reason: 'deployer-funded-liquidity' };
    }
    // No insider patterns detected
    return { ok: true };
  } catch (err) {
    // On unexpected errors default to passing the heuristic; do not
    // block trades due to heuristic failures.
    return { ok: true };
  }
}

module.exports = { insiderDetector };