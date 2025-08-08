// backend/services/strategies/core/slippageGovernor.js
//
// Auto Slippage Governor
// ----------------------
//
// During volatile markets fixed slippage settings often lead to
// failed swaps.  The auto slippage governor dynamically tightens
// or widens the effective slippage bound based on recent quote
// spreads.  It maintains a small window of observed spreads and
// uses a simple sensitivity coefficient to adjust slippage: when
// spreads exceed the base slippage the governor widens the limit,
// and when spreads contract it tightens the bound.  The result is
// clamped within configurable floor and ceiling percentages.
//
// Configuration:
//   enabled   – whether auto adjustment is enabled (boolean)
//   floorPct  – minimum allowed slippage percentage (e.g. 0.5)
//   ceilPct   – maximum allowed slippage percentage (e.g. 2.0)
//   sensitivity – coefficient between 0 and 1 controlling how
//                 strongly the governor reacts to spread changes.
//
// Metrics:
//   slip_auto_adjustments_total – incremented whenever the
//     governor changes the slippage relative to the base.
//   effective_slippage_pct – histogram of computed effective
//     slippage percentages after adjustment.

'use strict';

const { incCounter, observeHistogram } = require('../logging/metrics');

class SlippageGovernor {
  /**
   * Initialise a new slippage governor.
   *
   * @param {Object} config
   * @param {boolean} [config.enabled] Whether to enable dynamic adjustment.
   * @param {number} [config.floorPct] Minimum slippage percentage.
   * @param {number} [config.ceilPct] Maximum slippage percentage.
   * @param {number} [config.sensitivity] Reaction coefficient between 0 and 1.
   */
  constructor(config = {}) {
    this.enabled = Boolean(config.enabled);
    this.floor = Number(config.floorPct) >= 0 ? Number(config.floorPct) : 0;
    this.ceil = Number(config.ceilPct) > 0 ? Number(config.ceilPct) : Math.max(this.floor, 100);
    // Sensitivity defaults to 0.5 when enabled.  Constrain to [0,1].
    const s = Number(config.sensitivity);
    this.sensitivity = Number.isFinite(s) ? Math.min(Math.max(s, 0), 1) : 0.5;
    // Maintain a sliding window of recent spreads (in percentage units).
    this.recent = [];
    this.windowSize = 5;
  }

  /**
   * Record an observed quote spread.  The spread should be a
   * percentage value (e.g. 1.2 for 1.2%).  Non‑finite values are
   * ignored.
   *
   * @param {number} spreadPct
   */
  observeSpread(spreadPct) {
    if (!Number.isFinite(spreadPct)) return;
    this.recent.push(spreadPct);
    if (this.recent.length > this.windowSize) this.recent.shift();
  }

  /**
   * Compute a new slippage percentage based on the base value and
   * recent spreads.  If the governor is disabled the base
   * slippage is returned unchanged.
   *
   * @param {number} baseSlippage Current slippage percentage.
   * @returns {number} Adjusted slippage percentage.
   */
  getAdjusted(baseSlippage) {
    let eff = Number(baseSlippage);
    if (!this.enabled || !Number.isFinite(eff)) {
      observeHistogram('effective_slippage_pct', eff);
      return eff;
    }
    // Compute the average spread; if no spreads observed use
    // baseSlippage as the neutral point.
    const avg = this.recent.length
      ? this.recent.reduce((a, b) => a + b, 0) / this.recent.length
      : eff;
    // If spreads are larger than base slippage we widen; if
    // smaller we tighten.  The reaction is proportional to the
    // difference multiplied by the sensitivity.
    if (avg > eff) {
      const diff = avg - eff;
      eff += diff * this.sensitivity;
    } else {
      const diff = eff - avg;
      eff -= diff * this.sensitivity;
    }
    // Clamp to floor/ceil.
    if (eff < this.floor) eff = this.floor;
    if (eff > this.ceil) eff = this.ceil;
    if (eff !== baseSlippage) {
      incCounter('slip_auto_adjustments_total');
    }
    observeHistogram('effective_slippage_pct', eff);
    return eff;
  }
}

module.exports = { SlippageGovernor };