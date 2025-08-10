/**
 * Delayed Sniper risk policy.
 *
 * Provides gating helpers to avoid rug traps at token launch.  In
 * particular, the strategy can ignore the first N blocks after launch
 * and require a liquidity floor to be present before entering a
 * position.  These helpers are pure functions that operate on input
 * parameters and leave state management to the main strategy.
 */

/* eslint-disable no-console */

/**
 * Returns true if the current block height is within the ignored range.
 * When true the strategy should avoid trading.
 *
 * @param {number} launchBlock - block height of token launch
 * @param {number} currentBlock
 * @param {number} ignoreBlocks
 * @returns {boolean}
 */
function inIgnoredBlocks(launchBlock, currentBlock, ignoreBlocks = 3) {
  return currentBlock - launchBlock < ignoreBlocks;
}

/**
 * Liquidity floor check.  Returns true if the liquidity is above
 * `floor` lamports (SPL) or USD.  When false the strategy skips the
 * token to avoid illiquid traps.
 *
 * @param {number} liquidityUsd
 * @param {number} floor
 * @returns {boolean}
 */
function aboveLiquidityFloor(liquidityUsd, floor = 10_000) {
  return liquidityUsd >= floor;
}

module.exports = {
  inIgnoredBlocks,
  aboveLiquidityFloor,
};