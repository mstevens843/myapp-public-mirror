// backend/services/strategies/core/latencyHarness.js
'use strict';
/**
 * Minimal A/B latency harness. Runs a provided async work function
 * twice (A=false, B=true) and records the delta in metrics.
 * Work function gets a boolean (enabled) and returns nothing.
 */

const metrics = require('../logging/metrics');

async function runAB(name, workFn) {
  try {
    metrics.recordABRun(name);
    const t0 = Date.now();
    await workFn(false);
    const t1 = Date.now();
    await workFn(true);
    const t2 = Date.now();
    const a = t1 - t0;
    const b = t2 - t1;
    metrics.recordABDelta(name, b - a);
  } catch (_) {
    // non-fatal
  }
}

module.exports = { runAB };