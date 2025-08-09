// backend/services/strategies/core/jitoFeeController.js
/*
 * jitoFeeController.js
 *
 * A lightweight controller for tuning compute unit price and tip
 * parameters when submitting swaps as Jito bundles.  The controller
 * encapsulates simple heuristics for adapting compute unit pricing
 * based on previous attempts and user‑provided constraints.  It is
 * intentionally conservative: if `cuAdapt` is false the minimum
 * compute unit price is always used.  When adaptive mode is enabled
 * the price ramps linearly from the provided minimum up to the
 * specified maximum over successive attempts.  Tip values follow
 * either a flat or ramp curve.  A ramp tip increases the tip by
 * 50 percent for each subsequent attempt.  All values are rounded
 * to integers before being returned.
 */

class JitoFeeController {
  /**
   * Construct a new fee controller.
   *
   * @param {Object} opts Configuration options.  In addition to
   * legacy keys this constructor accepts custom curve definitions:
   *  - cuPriceCurve: { coeffs: number[] } defines a polynomial
   *      compute unit price curve as a function of the attempt.
   *  - tipCurveCoefficients: { coeffs: number[] } defines a
   *      polynomial tip curve.  Alternatively pass `tipCurve` with
   *      'flat' or 'ramp' to use built‑in modes.
   *
   * @param {boolean} [opts.cuAdapt=false] Enable adaptive compute unit pricing
   * @param {number} [opts.cuPriceMicroLamportsMin=0] Minimum compute unit price (μLAM)
   * @param {number} [opts.cuPriceMicroLamportsMax=0] Maximum compute unit price (μLAM)
   * @param {string|Object} [opts.tipCurve='flat'] Tip curve: 'flat', 'ramp' or object with coeffs
   * @param {number} [opts.baseTipLamports=1000] Base tip in lamports
   */
  constructor({
    cuAdapt = false,
    cuPriceMicroLamportsMin = 0,
    cuPriceMicroLamportsMax = 0,
    cuPriceCurve = null,
    tipCurve = 'flat',
    tipCurveCoefficients = null,
    baseTipLamports = 1000,
  } = {}) {
    this.cuAdapt = Boolean(cuAdapt);
    this.min = Number(cuPriceMicroLamportsMin) || 0;
    this.max = Number(cuPriceMicroLamportsMax) || this.min;
    // swap if inverted
    if (this.max < this.min) {
      const tmp = this.min;
      this.min = this.max;
      this.max = tmp;
    }
    // Store curve specifications.  Accept either an object with
    // coefficients or a legacy string.  When an object is provided
    // the polynomial curve will be used regardless of cuAdapt.
    if (cuPriceCurve && typeof cuPriceCurve === 'object') {
      this.cuPriceCurve = cuPriceCurve;
    } else if (Array.isArray(cuPriceCurve)) {
      this.cuPriceCurve = { coeffs: cuPriceCurve };
    } else {
      this.cuPriceCurve = null;
    }
    // Tip curve can be defined by coeffs or by legacy string
    if (tipCurveCoefficients && typeof tipCurveCoefficients === 'object') {
      this.tipCurveSpec = tipCurveCoefficients;
    } else if (Array.isArray(tipCurveCoefficients)) {
      this.tipCurveSpec = { coeffs: tipCurveCoefficients };
    } else if (typeof tipCurve === 'object') {
      this.tipCurveSpec = tipCurve;
    } else {
      this.tipCurveSpec = null;
    }
    this.tipCurve = typeof tipCurve === 'string' ? tipCurve.toLowerCase() : 'flat';
    this.baseTip = Number(baseTipLamports) || 1000;
    this.attempt = 0;
  }

  /**
   * Compute fee settings for the next attempt.  Each call increments the
   * internal attempt counter unless an explicit `attempt` is supplied.
   *
   * @param {number} [attemptOverride] Specific attempt number to use.  When
   *   omitted the internal counter is incremented and used.
   * @returns {{computeUnitPriceMicroLamports:number, tipLamports:number}}
   */
  getFee(attemptOverride) {
    const attempt = attemptOverride != null ? attemptOverride : ++this.attempt;
    let cuPrice;
    // Custom polynomial curve for compute unit price
    if (this.cuPriceCurve && Array.isArray(this.cuPriceCurve.coeffs)) {
      cuPrice = this.cuPriceCurve.coeffs.reduce((sum, coeff, idx) => {
        return sum + Number(coeff || 0) * Math.pow(attempt, idx);
      }, 0);
    } else {
      // Default linear ramp if adaptive mode enabled
      cuPrice = this.min;
      if (this.cuAdapt && this.max > this.min) {
        const steps = 4;
        const idx = Math.max(0, Math.min(attempt - 1, steps));
        const delta = this.max - this.min;
        cuPrice = this.min + (delta * idx) / steps;
      }
    }
    // Clamp to min/max boundaries
    cuPrice = Math.max(this.min, Math.min(this.max, cuPrice));

    // Tip calculation.  Use polynomial if provided.
    let tip;
    if (this.tipCurveSpec && Array.isArray(this.tipCurveSpec.coeffs)) {
      tip = this.tipCurveSpec.coeffs.reduce((sum, coeff, idx) => {
        return sum + Number(coeff || 0) * Math.pow(attempt, idx);
      }, 0);
    } else {
      // Legacy flat/ramp behaviour
      tip = this.baseTip;
      if (this.tipCurve === 'ramp' && attempt > 1) {
        tip = this.baseTip * (1 + 0.5 * (attempt - 1));
      }
    }
    return {
      computeUnitPriceMicroLamports: Math.round(cuPrice),
      tipLamports: Math.round(tip),
    };
  }

  /**
   * Reset the internal attempt counter back to zero.  Useful between
   * independent operations.
   */
  reset() {
    this.attempt = 0;
  }
}

module.exports = JitoFeeController;