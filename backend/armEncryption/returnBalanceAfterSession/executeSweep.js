// backend/services/sweep/executeSweep.js
//
// Executes an ordered sweep of free funds from a hot wallet back to the
// user’s cold wallet.  The sweep order is strictly enforced:
//   (a) all non‑USDC SPL tokens (excluding any mints in excludeMints)
//   (b) USDC mints
//   (c) native SOL, leaving a configurable minimum balance
//
// The real implementation would construct and sign Solana transactions,
// create associated token accounts (ATAs) as needed, unwrap WSOL prior to
// sweeping native SOL, simulate transactions, and broadcast them via a
// quorum of RPC nodes with retries and priority fees.  Here we provide
// a stub that logs the intended actions and returns fake transaction IDs
// for demonstration purposes.

const { freeBalance } = require('../balance/freeBalance');

/**
 * Execute a sweep of free funds according to the provided configuration.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {number} params.walletId
 * @param {string} params.destPubkey – destination cold wallet public key
 * @param {Array<string>} [params.excludeMints] – SPL mints to skip
 * @param {Array<string>} [params.usdcMints] – SPL mints considered USDC
 * @param {bigint} [params.solMinKeepLamports] – lamports to leave in wallet
 * @param {bigint} [params.feeBufferLamports] – lamports reserved for fees
 * @returns {Promise<{ txids: string[] }>} simulated transaction results
 */
async function executeSweep({ userId, walletId, destPubkey, excludeMints = [], usdcMints = [], solMinKeepLamports = 10_000_000n, feeBufferLamports = 10_000n }) {
  // Obtain free balances (post reservation / fee buffer)
  const balances = await freeBalance({ userId, walletId, feeBufferLamports });
  const txids = [];
  // Helper to push a fake txid
  function fakeSend(label, mint, amount) {
    const txid = `FAKE_${label}_${mint || 'SOL'}_${Date.now()}`;
    console.log(`[AutoReturn] Sweeping ${amount.toString()} of ${mint || 'SOL'} for user ${userId} wallet ${walletId} → ${destPubkey}`);
    txids.push(txid);
  }
  // 1. Non‑USDC SPL tokens (excluding excludeMints)
  for (const token of balances.spl) {
    const { mint, amount } = token;
    if (excludeMints.includes(mint)) continue;
    if (usdcMints.includes(mint)) continue;
    if (amount > 0n) fakeSend('SPL', mint, amount);
  }
  // 2. USDC tokens
  for (const token of balances.spl) {
    const { mint, amount } = token;
    if (!usdcMints.includes(mint)) continue;
    if (amount > 0n && !excludeMints.includes(mint)) fakeSend('USDC', mint, amount);
  }
  // 3. Native SOL (unwrap WSOL has already happened in freeBalance)
  let solToSweep = balances.sol;
  if (solToSweep > solMinKeepLamports) {
    solToSweep = solToSweep - solMinKeepLamports;
    if (solToSweep > 0n) fakeSend('SOL', null, solToSweep);
  }
  return { txids };
}

module.exports = { executeSweep };