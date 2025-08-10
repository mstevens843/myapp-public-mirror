// backend/services/utils/parseMinutes.js
function parseMinutes(v, { floor = 1, ceil = 60 } = {}) {
  if (v == null) return ceil;          // fallback
  const n = Number(String(v).trim());
  if (Number.isNaN(n)) throw new Error("must be a number");
  if (n < floor)       throw new Error(`must be ≥ ${floor}m`);
  if (n > ceil)        throw new Error(`must be ≤ ${ceil}m`);
  return Math.round(n);
}
module.exports = parseMinutes;