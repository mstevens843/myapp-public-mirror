// core/metrics.js
function createMetrics(...fields) {
  const m = Object.fromEntries(fields.map((f) => [f, 0]));
  return {
    inc(field, n = 1) { m[field] += n; },
    get(field) { return m[field]; },
    snapshot() { return { ...m }; },
  };
}
module.exports = createMetrics;
