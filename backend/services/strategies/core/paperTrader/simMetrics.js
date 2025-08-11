/*
 * simMetrics.js
 *
 * Simulation metrics collector for the Paper Trader.  This module
 * exposes simple arrays and counters to track latency, failure
 * reasons, number of partial fills and realised slippage.  The
 * functions record(), snapshot() and reset() allow callers to
 * accumulate metrics across many simulation runs, fetch a copy of
 * the current state, and clear all state respectively.  This file
 * is separate from the basic core/metrics.js helper so as not to
 * interfere with existing behaviour.  Consumers should import
 * simMetrics directly when they need simulation‑specific metrics.
 */

const simMetrics = {
  // latency measurements in milliseconds
  latencyMs: [],
  // map of reason_code → count
  failReasons: {},
  // number of fills per trade
  partialCounts: [],
  // realised slippage in basis points
  slippageBps: [],
  /**
   * Record a simulation result.  Accepts the subset of fields
   * returned by the paperExecutionAdapter.  Missing values are
   * ignored.  This function does not return anything.
   * @param {object} res
   */
  record(res = {}) {
    if (typeof res.latency_ms === 'number') {
      this.latencyMs.push(res.latency_ms);
    }
    if (Array.isArray(res.fills)) {
      this.partialCounts.push(res.fills.length);
    }
    if (typeof res.slippage_bps === 'number') {
      this.slippageBps.push(res.slippage_bps);
    }
    if (res.reason_code) {
      const code = String(res.reason_code);
      this.failReasons[code] = (this.failReasons[code] || 0) + 1;
    }
  },
  /**
   * Return a snapshot of all collected metrics.  The arrays are
   * shallow-copied to prevent mutation.  Consumers can derive
   * p95/mean/median as needed.
   */
  snapshot() {
    return {
      latencyMs: [...this.latencyMs],
      failReasons: { ...this.failReasons },
      partialCounts: [...this.partialCounts],
      slippageBps: [...this.slippageBps],
    };
  },
  /**
   * Reset all collected metrics.  Useful between test runs or
   * periodic reporting intervals.
   */
  reset() {
    this.latencyMs.length = 0;
    this.partialCounts.length = 0;
    this.slippageBps.length = 0;
    for (const k of Object.keys(this.failReasons)) delete this.failReasons[k];
  },
};

module.exports = simMetrics;