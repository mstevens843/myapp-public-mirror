// backend/utils/raydiumDirect.js
/*
 * raydiumDirect.js
 *
 * Provides a simplified helper for fast swaps via the Raydium AMM.  The
 * function defined here intentionally avoids the full Jupiter aggregator
 * routing logic by constraining the quote request to Raydium only.  It
 * then executes the resulting quote using the turbo swap path.
 *
 * NOTE: This helper does not construct a custom Raydium swap instruction
 * directly; instead it leverages Jupiter’s quote API with the
 * `allowedDexes` parameter set to `Raydium`.  This gives a direct path
 * without splitting across multiple venues and returns quickly.  Should
 * the quote call fail the caller is expected to fall back to an
 * alternative strategy.
 */

const { getSwapQuote, executeSwapTurbo } = require('./swap');

/**
 * Perform a direct Raydium swap.  A quote is fetched with only the
 * Raydium DEX allowed.  The quote is then executed via turbo swap to
 * minimise latency.
 *
 * @param {Object} opts Parameters for the swap
 * @param {Object} opts.wallet The user’s Keypair
 * @param {string} opts.inputMint Mint of the input token
 * @param {string} opts.outputMint Mint of the output token
 * @param {number|string} opts.amount Amount of input token in base units
 * @param {number} opts.slippage Slippage tolerance in percent (e.g. 1.0)
 * @param {string} [opts.privateRpcUrl] Optional private RPC URL for turbo
 * @returns {Promise<string|null>} Transaction signature on success, null on failure
 */
async function directSwap({ wallet, inputMint, outputMint, amount, slippage, privateRpcUrl }) {
  try {
    // Request a quote restricted to Raydium
    const quote = await getSwapQuote({
      inputMint,
      outputMint,
      amount,
      slippage,
      allowedDexes: ['Raydium'],
      splitTrade: false,
    });
    if (!quote) return null;
    const signature = await executeSwapTurbo({
      quote,
      wallet,
      privateRpcUrl,
      skipPreflight: true,
    });
    return signature;
  } catch (err) {
    console.error('directSwap error:', err.message);
    return null;
  }
}

module.exports = { directSwap };