// frontend/src/strategy_configs/validators/turboSniperValidator.js
// turboSniperValidator.js
//
// Performs validation on the Turbo Sniper strategy configuration.  This
// helper can be used by the UI to enforce sane ranges before sending
// configs to the backend.  It returns a boolean indicating validity
// alongside a map of field names to error messages when invalid.

/**
 * Validate a Turbo Sniper config object.
 *
 * @param {Object} cfg Configuration to validate
 * @returns {{isValid:boolean, errors:Object}} Validation result
 */
export default function validateTurboSniperConfig(cfg = {}) {
  const errors = {};
  // Bundle strategy validation
  if (cfg.useJitoBundle) {
    const allowed = ['topOfBlock', 'backrun', 'private'];
    if (!allowed.includes(cfg.bundleStrategy)) {
      errors.bundleStrategy = 'Bundle strategy must be topOfBlock, backrun or private';
    }
    if (cfg.cuAdapt) {
      const min = Number(cfg.cuPriceMicroLamportsMin);
      const max = Number(cfg.cuPriceMicroLamportsMax);
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        errors.cuPriceMicroLamportsMin = 'CU price min/max must be numbers';
      } else if (min <= 0 || max <= 0) {
        errors.cuPriceMicroLamportsMin = 'CU prices must be positive values';
      } else if (max < min) {
        errors.cuPriceMicroLamportsMax = 'Max CU price must be greater than or equal to min';
      }
    }
    const tipCurves = ['flat', 'ramp'];
    if (cfg.tipCurve && !tipCurves.includes(cfg.tipCurve)) {
      errors.tipCurve = 'Tip curve must be flat or ramp';
    }
  }
  // Direct AMM fallback
  if (cfg.directAmmFallback) {
    const pct = Number(cfg.directAmmFirstPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 1) {
      errors.directAmmFirstPct = 'Direct AMM first percentage must be between 0 and 1';
    }
  }
  // Skip preflight is a boolean; no validation needed
  // Post-buy watcher
  if (cfg.postBuyWatch) {
    const dur = Number(cfg.postBuyWatch.durationSec);
    if (!Number.isFinite(dur) || dur <= 0) {
      errors.postBuyWatch = 'Post-buy watch duration must be a positive number';
    }
  }
  // Iceberg config
  if (cfg.iceberg && cfg.iceberg.enabled) {
    const tranches = parseInt(cfg.iceberg.tranches, 10);
    if (!Number.isInteger(tranches) || tranches <= 0) {
      errors.icebergTranches = 'Iceberg tranches must be an integer greater than zero';
    }
    const delay = Number(cfg.iceberg.trancheDelayMs);
    if (!Number.isFinite(delay) || delay < 0) {
      errors.icebergTrancheDelayMs = 'Iceberg tranche delay must be a non‑negative number';
    }
    const abortPct = Number(cfg.impactAbortPct);
    if (Number.isFinite(abortPct) && abortPct < 0) {
      errors.impactAbortPct = 'Impact abort percentage must be non‑negative';
    }
    const dynSlip = Number(cfg.dynamicSlippageMaxPct);
    if (Number.isFinite(dynSlip) && dynSlip <= 0) {
      errors.dynamicSlippageMaxPct = 'Dynamic slippage max percentage must be positive';
    }
  }
  const isValid = Object.keys(errors).length === 0;
  return { isValid, errors };
}