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
 *
 * UPDATE:
 * - Accepts a precomputed `quote` (optional) to save an extra network hop.
 * - Passes through executor-provided options (e.g. skipPreflight, quorum
 *   sender, cached blockhash) to executeSwapTurbo for true parity with
 *   the router path.
 */

const { getSwapQuote, executeSwapTurbo } = require('./swap');

/**
 * Perform a direct Raydium swap. A quote is fetched with only the
 * Raydium DEX allowed (unless a precomputed quote is supplied).
 * The quote is then executed via turbo swap to minimize latency.
 *
 * @param {Object} opts
 * @param {Object} opts.wallet                         User Keypair
 * @param {string} opts.inputMint                      Input token mint
 * @param {string} opts.outputMint                     Output token mint
 * @param {number|string} opts.amount                  Input amount (base units)
 * @param {number} opts.slippage                       Slippage % (e.g. 1.0)
 * @param {string} [opts.privateRpcUrl]                Optional private RPC URL
 * @param {Object} [opts.quote]                        Optional precomputed Jupiter quote
 * @param {...any} [opts.exec passthrough]             Any additional fields are forwarded to executeSwapTurbo
 *                                                    (e.g. { skipPreflight, sendRawTransaction, broadcastRawTransaction,
 *                                                           recentBlockhash, lastValidBlockHeight,
 *                                                           computeUnitPriceMicroLamports, tipLamports })
 * @returns {Promise<string|null>}                     Signature on success, null on failure
 */
async function directSwap(opts = {}) {
  const {
    wallet,
    inputMint,
    outputMint,
    amount,
    slippage,
    privateRpcUrl,
    quote,
    ...execOpts // pass-through to executeSwapTurbo
  } = opts;

  try {
    // Use provided quote if present, else fetch a Raydium-only quote
    const q =
      quote ||
      (await getSwapQuote({
        inputMint,
        outputMint,
        amount,
        slippage,
        allowedDexes: ['Raydium'],
        splitTrade: false,
      }));

    if (!q) return null;

    const signature = await executeSwapTurbo({
      quote: q,
      wallet,
      privateRpcUrl,
      // keep fast defaults but allow caller to override
      skipPreflight: true,
      ...execOpts,
    });
    return signature;
  } catch (err) {
    console.error('directSwap error:', err.message);
    return null;
  }
}

module.exports = { directSwap };
