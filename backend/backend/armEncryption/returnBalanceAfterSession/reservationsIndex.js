// backend/services/reservations/index.js
//
// A simple in‑memory reservation registry used to track funds that are
// earmarked for open orders, TP/SL rules, DCA tranches, bot allocations
// or other internal purposes.  Only free (unreserved) funds should ever be
// swept back to a user’s cold wallet.  Each reservation entry is keyed by
// token mint and stores a BigInt amount of lamports or token units.
//
// This implementation is intentionally lightweight.  In a production
// environment these reservations would likely be persisted in the database
// and scoped per user/wallet.  For the purposes of the auto‑return feature
// described in the assignment we keep it in memory and expose basic
// primitives to reserve, release and snapshot current reservations.

const reservations = new Map();

/**
 * Reserve funds for a given mint.  Multiple calls will accumulate.
 *
 * @param {string} mint – SPL token mint or 'SOL' for native SOL
 * @param {bigint|number|string} amount – amount of lamports or token units to reserve
 * @param {string} reason – human friendly reason for the reservation
 * @param {string|number} refId – reference id (order id, rule id, etc.)
 */
function reserve(mint, amount, reason, refId) {
  const key = mint;
  const existing = reservations.get(key) || 0n;
  const amt = typeof amount === 'bigint' ? amount : BigInt(amount);
  reservations.set(key, existing + amt);
  // In a real implementation you might store reason/refId for auditing.
  return reservations.get(key);
}

/**
 * Release previously reserved funds.  If releasing more than currently
 * reserved the balance will floor at zero.  Reason and refId are accepted
 * for symmetry but unused in this simple implementation.
 *
 * @param {string} mint
 * @param {bigint|number|string} amount
 * @param {string} reason
 * @param {string|number} refId
 */
function release(mint, amount, reason, refId) {
  const key = mint;
  const existing = reservations.get(key) || 0n;
  const amt = typeof amount === 'bigint' ? amount : BigInt(amount);
  const next = existing - amt;
  reservations.set(key, next > 0n ? next : 0n);
  return reservations.get(key);
}

/**
 * Snapshot the current reservation map.  The returned object is a plain
 * JavaScript object (not a Map) with mint symbols as keys and BigInt
 * amounts as values.  Callers should treat this as read‑only.
 *
 * @returns {Object<string, bigint>}
 */
function snapshot() {
  const snap = {};
  for (const [mint, amt] of reservations.entries()) {
    snap[mint] = amt;
  }
  return snap;
}

module.exports = { reserve, release, snapshot };