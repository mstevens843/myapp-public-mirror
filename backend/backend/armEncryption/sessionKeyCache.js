// backend/core/crypto/sessionKeyCache.js
// In-memory DEK cache with TTL + zeroization. O(1) lookups. No external deps.

const sessions = new Map(); // key: `${userId}:${walletId}` -> { dek:Buffer, expiresAt:number, armedAt:number }

function _key(userId, walletId){ return `${userId}:${walletId}`; }

/**
 * Arm a wallet session by caching its DEK in memory. Records the time at
 * which the wallet was armed so that callers can enforce grace periods
 * for subsequent operations (e.g. extend/disarm without re‑auth).
 *
 * @param {string|number} userId   – The authenticated user’s ID
 * @param {string|number} walletId – The wallet being armed
 * @param {Buffer}        dekBuffer – The decrypted Data Encryption Key (will be zeroized only on disarm)
 * @param {number}        ttlMs     – How long the session remains active (milliseconds)
 */
function arm(userId, walletId, dekBuffer, ttlMs) {
  const key = _key(userId, walletId);
  // Always zeroize and remove any existing entry first
  disarm(userId, walletId);
  sessions.set(key, {
    dek: dekBuffer,
    expiresAt: Date.now() + ttlMs,
    armedAt: Date.now(),
  });
}

function extend(userId, walletId, ttlMs) {
  const s = sessions.get(_key(userId, walletId));
  if (!s) return false;
  s.expiresAt = Date.now() + ttlMs;
  // Do not modify armedAt here; grace period is based on original arm time
  return true;
}

function disarm(userId, walletId) {
  const key = _key(userId, walletId);
  const s = sessions.get(key);
  if (s && s.dek) try { s.dek.fill(0); } catch {}
  sessions.delete(key);
}

function getDEK(userId, walletId) {
  const s = sessions.get(_key(userId, walletId));
  if (!s) return null;
  if (Date.now() > s.expiresAt) { disarm(userId, walletId); return null; }
  return s.dek;
}

function status(userId, walletId) {
  const s = sessions.get(_key(userId, walletId));
  if (!s) return { armed: false };
  const msLeft = Math.max(0, s.expiresAt - Date.now());
  return { armed: true, msLeft, armedAt: s.armedAt };
}

/**
 * Retrieve the raw session object for a user/wallet pair. Returns null when
 * there is no active session or when the TTL has expired (expired
 * sessions are purged on access).
 *
 * @param {string|number} userId   – The user’s ID
 * @param {string|number} walletId – The wallet’s ID
 * @returns {{ dek: Buffer, expiresAt: number, armedAt: number }|null}
 */
function getSession(userId, walletId) {
  const key = _key(userId, walletId);
  const s = sessions.get(key);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    disarm(userId, walletId);
    return null;
  }
  return s;
}

/**
 * Reset the `armedAt` timestamp for an existing session. Useful when a
 * session has been re‑authorised (e.g. passphrase entered again) and a
 * fresh grace period should begin. If no session exists this is a no‑op.
 *
 * @param {string|number} userId
 * @param {string|number} walletId
 */
function updateArmedAt(userId, walletId) {
  const s = sessions.get(_key(userId, walletId));
  if (s) {
    s.armedAt = Date.now();
  }
}

// Sweep expired every 30s
setInterval(() => {
  const now = Date.now();
  for (const [key, s] of sessions.entries()) {
    if (now > s.expiresAt) {
      if (s.dek) try { s.dek.fill(0); } catch {}
      sessions.delete(key);
    }
  }
}, 30_000).unref();

process.on("SIGTERM", () => { for (const [k,s] of sessions) { try { s.dek.fill(0);}catch{} } sessions.clear(); });
process.on("SIGINT", () => { for (const [k,s] of sessions) { try { s.dek.fill(0);}catch{} } sessions.clear(); });

module.exports = { arm, extend, disarm, getDEK, status, getSession, updateArmedAt };