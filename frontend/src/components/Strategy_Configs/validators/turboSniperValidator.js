// frontend/src/strategy_configs/validators/turboSniperValidator.js
//
// Validation logic for the Turbo Sniper configuration. Returns an
// array of error strings describing invalid fields. An empty array
// indicates the configuration is valid. Perform as many checks as
// possible without throwing to provide comprehensive feedback.

export default function validateTurboSniperConfig(config) {
  const errors = [];
  const cfg = config || {};
  // Leader timing
  if (cfg.leaderTiming && cfg.leaderTiming.enabled) {
    if (!(cfg.leaderTiming.preflightMs > 0)) {
      errors.push('Leader preflightMs must be > 0');
    }
    if (!(cfg.leaderTiming.windowSlots >= 1)) {
      errors.push('Leader windowSlots must be >= 1');
    }
  }
  // Quote TTL
  if (!(cfg.quoteTtlMs > 0)) {
    errors.push('quoteTtlMs must be positive');
  }
  // Idempotency TTL
  if (!(cfg.idempotencyTtlSec > 0)) {
    errors.push('idempotencyTtlSec must be positive');
  }
  // Retry policy
  if (cfg.retryPolicy) {
    const rp = cfg.retryPolicy;
    if (!(rp.max >= 1)) {
      errors.push('retryPolicy.max must be >= 1');
    }
    if (!(rp.bumpCuStep >= 0)) {
      errors.push('retryPolicy.bumpCuStep must be >= 0');
    }
    if (!(rp.bumpTipStep >= 0)) {
      errors.push('retryPolicy.bumpTipStep must be >= 0');
    }
  }
  // Parallel wallets
  if (cfg.parallelWallets && cfg.parallelWallets.enabled) {
    const { walletIds = [], splitPct = [], maxParallel } = cfg.parallelWallets;
    if (walletIds.length === 0) {
      errors.push('parallelWallets.walletIds must not be empty when parallel filler is enabled');
    }
    if (splitPct.length !== walletIds.length) {
      errors.push('parallelWallets.splitPct length must match walletIds length');
    } else {
      const sum = splitPct.reduce((a, b) => a + (Number(b) || 0), 0);
      if (Math.abs(sum - 1) > 0.05) {
        errors.push('parallelWallets.splitPct values must sum to approximately 1');
      }
      splitPct.forEach((pct, i) => {
        if (pct <= 0) {
          errors.push(`parallelWallets.splitPct[${i}] must be > 0`);
        }
      });
    }
    if (!(maxParallel >= 1 && maxParallel <= walletIds.length)) {
      errors.push('parallelWallets.maxParallel must be between 1 and walletIds.length');
    }
  }
  // Pump.fun
  if (cfg.pumpfun && cfg.pumpfun.enabled) {
    const pf = cfg.pumpfun;
    if (!(pf.thresholdPct >= 0 && pf.thresholdPct <= 1)) {
      errors.push('pumpfun.thresholdPct must be between 0 and 1');
    }
    if (!(pf.minSolLiquidity >= 0)) {
      errors.push('pumpfun.minSolLiquidity must be >= 0');
    }
    if (!(pf.cooldownSec >= 0)) {
      errors.push('pumpfun.cooldownSec must be >= 0');
    }
  }
  // Airdrops
  if (cfg.airdrops && cfg.airdrops.enabled) {
    const ad = cfg.airdrops;
    if (!(ad.minUsdValue >= 0)) {
      errors.push('airdrops.minUsdValue must be >= 0');
    }
    if (!(ad.maxSellSlippagePct >= 0 && ad.maxSellSlippagePct <= 100)) {
      errors.push('airdrops.maxSellSlippagePct must be between 0 and 100');
    }
    if (Array.isArray(ad.whitelistMints)) {
      ad.whitelistMints.forEach((mint, i) => {
        if (!mint || typeof mint !== 'string') {
          errors.push(`airdrops.whitelistMints[${i}] must be a non-empty string`);
        }
      });
    }
  }
  return errors;
}