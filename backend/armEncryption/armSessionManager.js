// backend/services/armSessionManager.js
const sessions = new Map();
function keyOf(userId, walletId) {
  return `${userId}_${walletId}`;
}
function arm(userId, walletId, dek, ttlMs) {
  disarm(userId, walletId);
  const expiresAt = Date.now() + ttlMs;
  const timer = setTimeout(() => disarm(userId, walletId), ttlMs);
  sessions.set(keyOf(userId, walletId), { dek, expiresAt, timer });
}
function extend(userId, walletId, extraMs) {
  const k = keyOf(userId, walletId);
  const entry = sessions.get(k);
  if (!entry) return false;
  const msLeft = entry.expiresAt - Date.now();
  const dekCopy = Buffer.from(entry.dek);
  arm(userId, walletId, dekCopy, Math.max(0, msLeft) + extraMs);
  return true;
}
function disarm(userId, walletId) {
  const k = keyOf(userId, walletId);
  const entry = sessions.get(k);
  if (!entry) return;
  clearTimeout(entry.timer);
  if (entry.dek) entry.dek.fill(0);
  sessions.delete(k);
}
function status(userId, walletId) {
  const entry = sessions.get(keyOf(userId, walletId));
  if (!entry) return { armed: false, msLeft: 0 };
  const msLeft = entry.expiresAt - Date.now();
  if (msLeft <= 0) {
    disarm(userId, walletId);
    return { armed: false, msLeft: 0 };
  }
  return { armed: true, msLeft };
}
function getDEK(userId, walletId) {
  const entry = sessions.get(keyOf(userId, walletId));
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    disarm(userId, walletId);
    return null;
  }
  return entry.dek;
}
module.exports = { arm, extend, disarm, status, getDEK };
