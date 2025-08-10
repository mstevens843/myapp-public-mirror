// core/cooldown.js
function createCooldown(windowMs = 60_000) {
  const last = new Map();
  return {
    /** returns remaining ms; starts a new cooldown if zero */
    hit(mint) {
      const now   = Date.now();
      const prev  = last.get(mint) || 0;
      const left  = Math.max(0, windowMs - (now - prev));
      if (left === 0) last.set(mint, now);
      return left;
    },
    // 🔹 NEW: non-mutating read — used by scalper’s pre-check
    peek(mint) {
      const prev = last.get(mint) || 0;
      return Math.max(0, windowMs - (Date.now() - prev));
    },
  };
}
module.exports = createCooldown;
