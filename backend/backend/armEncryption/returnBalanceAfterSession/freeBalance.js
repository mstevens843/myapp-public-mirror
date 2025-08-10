// backend/services/balance/freeBalance.js
//
// Compute the amount of sweepable (free) funds for a user/wallet by
// subtracting out reserved amounts and configurable fee buffers.  This
// helper queries on‑chain balances via a placeholder hook – the real
// implementation would call Solana RPC endpoints or a cached balance
// service.  It then subtracts the current reservations (as reported by
// backend/services/reservations/index.js) along with any fee buffer from
// those on‑chain amounts.  The result is returned as an object
// describing the free native SOL (in lamports) and an array of free SPL
// token balances.

const { snapshot: reservationSnapshot } = require('../reservations');

/**
 * Placeholder function that should be replaced with a real on‑chain
 * balance lookup.  It is provided here to make the freeBalance helper
 * self‑contained.  A production system would likely import a wallet
 * library such as @solana/web3.js and query getBalance() / getTokenAccountsByOwner().
 *
 * @param {string} userId – unique ID of the user
 * @param {number} walletId – internal wallet identifier
 * @returns {Promise<{ sol: bigint, tokens: Array<{mint:string, amount:bigint, ata:string}> }>} 
 */
async function getOnChainBalances(userId, walletId) {
  // TODO: integrate with Solana RPC
  // For now return zero balances.  Callers should treat this as
  // indicative of no sweepable funds until a real implementation is
  // provided.
  return { sol: 0n, tokens: [] };
}

/**
 * Compute free (sweepable) balances for a user’s wallet.  All amounts
 * returned are after subtracting current reservations and fee buffer.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {number} params.walletId
 * @param {bigint} params.feeBufferLamports – lamports to hold back for fees
 * @returns {Promise<{ sol: bigint, spl: Array<{ mint:string, fromAta:string|null, amount:bigint }> }>} 
 */
async function freeBalance({ userId, walletId, feeBufferLamports = 0n }) {
  const onChain = await getOnChainBalances(userId, walletId);
  const reservations = reservationSnapshot();
  // Compute free SOL: subtract reservations for SOL and fee buffer
  const reservedSol = reservations['SOL'] || 0n;
  let freeSol = onChain.sol - reservedSol - feeBufferLamports;
  if (freeSol < 0n) freeSol = 0n;
  // Compute free SPL tokens by subtracting reservations per mint
  const spl = [];
  for (const { mint, amount, ata } of onChain.tokens) {
    const reserved = reservations[mint] || 0n;
    let freeAmt = amount - reserved;
    if (freeAmt < 0n) freeAmt = 0n;
    if (freeAmt > 0n) {
      spl.push({ mint, fromAta: ata || null, amount: freeAmt });
    }
  }
  return { sol: freeSol, spl };
}

module.exports = { freeBalance };