/*
 * Swap utilities – simplified for unit testing.  These helpers mirror the
 * signatures of the production functions but avoid performing any external
 * network requests.  Instead they construct and return the payload that
 * would normally be sent to the Jupiter API.  Tests can inspect the
 * returned payload to verify that computeUnitPriceMicroLamports and
 * tipLamports are forwarded correctly.
 */

'use strict';

/**
 * Execute a swap on the standard path.  Accepts both legacy priorityFee
 * parameters and the newer computeUnitPriceMicroLamports/tipLamports knobs.
 * The returned object contains the payload used to call the swap API.
 *
 * @param {Object} opts
 * @param {Object} opts.quote The quote from the aggregator
 * @param {Object} opts.wallet A wallet with a publicKey.toBase58() method
 * @param {boolean} [opts.shared] Whether to use shared accounts
 * @param {number} [opts.priorityFee] Legacy name for compute unit price
 * @param {number} [opts.briberyAmount] Legacy name for tip lamports
 * @param {number} [opts.computeUnitPriceMicroLamports] CU price from caller
 * @param {number} [opts.tipLamports] Tip lamports from caller
 * @returns {Object} { payload }
 */
async function executeSwap({
  quote,
  wallet,
  shared = false,
  priorityFee = 0,
  briberyAmount = 0,
  computeUnitPriceMicroLamports,
  tipLamports,
}) {
  // Derive the fee knobs: new parameters override the legacy ones
  const cuPrice =
    computeUnitPriceMicroLamports !== undefined
      ? computeUnitPriceMicroLamports
      : priorityFee;
  const tip =
    tipLamports !== undefined ? tipLamports : briberyAmount;
  const payload = {
    quoteResponse: quote,
    userPublicKey: wallet.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    useSharedAccounts: shared,
    asLegacyTransaction: false,
    computeUnitPriceMicroLamports: cuPrice,
    tipLamports: tip,
    useTokenLedger: false,
    dynamicComputeUnitLimit: true,
    skipUserAccountsRpcCalls: true,
    dynamicSlippage: true,
    trackingAccount: wallet.publicKey.toBase58(),
  };
  // Return payload for inspection; in production this would post to Jupiter
  return { payload };
}

/**
 * Execute a swap on the turbo path.  The signature matches that of
 * executeSwap() but the caller may optionally supply a privateRpcUrl and
 * skipPreflight flag.  As with executeSwap(), this helper simply returns
 * the constructed payload for tests to inspect.
 *
 * @param {Object} opts
 * @param {Object} opts.quote
 * @param {Object} opts.wallet
 * @param {boolean} [opts.shared]
 * @param {number} [opts.priorityFee]
 * @param {number} [opts.briberyAmount]
 * @param {string} [opts.privateRpcUrl]
 * @param {boolean} [opts.skipPreflight]
 * @param {number} [opts.computeUnitPriceMicroLamports]
 * @param {number} [opts.tipLamports]
 * @returns {Object} { payload }
 */
async function executeSwapTurbo({
  quote,
  wallet,
  shared = false,
  priorityFee = 0,
  briberyAmount = 0,
  privateRpcUrl,
  skipPreflight = true,
  computeUnitPriceMicroLamports,
  tipLamports,
}) {
  const cuPrice =
    computeUnitPriceMicroLamports !== undefined
      ? computeUnitPriceMicroLamports
      : priorityFee;
  const tip = tipLamports !== undefined ? tipLamports : briberyAmount;
  const payload = {
    quoteResponse: quote,
    userPublicKey: wallet.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    useSharedAccounts: shared,
    asLegacyTransaction: false,
    computeUnitPriceMicroLamports: cuPrice,
    tipLamports: tip,
    useTokenLedger: false,
    dynamicComputeUnitLimit: true,
    skipUserAccountsRpcCalls: true,
    dynamicSlippage: true,
    trackingAccount: wallet.publicKey.toBase58(),
    // Additional flags present on turbo path
    privateRpcUrl,
    skipPreflight,
  };
  return { payload };
}

module.exports = {
  executeSwap,
  executeSwapTurbo,
};