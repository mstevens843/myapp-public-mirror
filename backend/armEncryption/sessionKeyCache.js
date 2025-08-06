// backend/core/crypto/sessionKeyCache.js
// In-memory DEK cache with TTL + zeroization. O(1) lookups. No external deps.

const sessions = new Map(); // key: `${userId}:${walletId}` -> { dek:Buffer, expiresAt:number }

function _key(userId, walletId){ return `${userId}:${walletId}`; }

function arm(userId, walletId, dekBuffer, ttlMs) {
  const key = _key(userId, walletId);
  disarm(userId, walletId); // zeroize any old one
  sessions.set(key, { dek: dekBuffer, expiresAt: Date.now() + ttlMs });
}

function extend(userId, walletId, ttlMs) {
  const s = sessions.get(_key(userId, walletId));
  if (!s) return false;
  s.expiresAt = Date.now() + ttlMs;
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
  if (!s) return { armed:false };
  const msLeft = Math.max(0, s.expiresAt - Date.now());
  return { armed:true, msLeft };
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

module.exports = { arm, extend, disarm, getDEK, status };
