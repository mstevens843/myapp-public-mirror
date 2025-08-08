// frontend/src/components/Strategy_Configs/validators/turboSniperValidator.js
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
// Idempotency
if (cfg.idempotency) {
  if (!(cfg.idempotency.ttlSec > 0)) {
    errors.push('idempotency.ttlSec must be > 0');
  }
  if (typeof cfg.idempotency.salt !== 'string' || !cfg.idempotency.salt.length) {
    errors.push('idempotency.salt must be a non-empty string');
  }
  if (typeof cfg.idempotency.resumeFromLast !== 'boolean') {
    errors.push('idempotency.resumeFromLast must be a boolean');
  }
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
  // Private Relay
if (cfg.privateRelay && cfg.privateRelay.enabled) {
  if (!Array.isArray(cfg.privateRelay.urls) || cfg.privateRelay.urls.length === 0) {
    errors.push('privateRelay.urls must contain at least one relay URL when enabled');
  }
  if (cfg.privateRelay.mode && !['bundle', 'tx'].includes(cfg.privateRelay.mode)) {
    errors.push('privateRelay.mode must be either "bundle" or "tx"');
  }
}

// Sizing
if (cfg.sizing) {
  if (!(cfg.sizing.maxImpactPct > 0)) {
    errors.push('sizing.maxImpactPct must be positive');
  }
  if (!(cfg.sizing.maxPoolPct > 0 && cfg.sizing.maxPoolPct <= 1)) {
    errors.push('sizing.maxPoolPct must be between 0 and 1');
  }
  if (!(cfg.sizing.minUsd >= 0)) {
    errors.push('sizing.minUsd must be >= 0');
  }
}

// Probe
if (cfg.probe && cfg.probe.enabled) {
  if (!(cfg.probe.usd > 0)) {
    errors.push('probe.usd must be positive');
  }
  if (!(cfg.probe.scaleFactor > 1)) {
    errors.push('probe.scaleFactor must be greater than 1');
  }
  if (!(cfg.probe.abortOnImpactPct > 0)) {
    errors.push('probe.abortOnImpactPct must be positive');
  }
  if (!(cfg.probe.delayMs >= 0)) {
    errors.push('probe.delayMs must be >= 0');
  }
}

  // Developer/Creator heuristics
  if (cfg.devWatch) {
    const dw = cfg.devWatch;
    if (dw.whitelist !== undefined) {
      if (!Array.isArray(dw.whitelist)) {
        errors.push('devWatch.whitelist must be an array');
      } else {
        dw.whitelist.forEach((m, i) => {
          if (typeof m !== 'string' || !m.trim()) {
            errors.push(`devWatch.whitelist[${i}] must be a non-empty string`);
          }
        });
      }
    }
    if (dw.blacklist !== undefined) {
      if (!Array.isArray(dw.blacklist)) {
        errors.push('devWatch.blacklist must be an array');
      } else {
        dw.blacklist.forEach((m, i) => {
          if (typeof m !== 'string' || !m.trim()) {
            errors.push(`devWatch.blacklist[${i}] must be a non-empty string`);
          }
        });
      }
    }
    if (dw.holderTop5MaxPct !== undefined) {
      const v = Number(dw.holderTop5MaxPct);
      if (!(v >= 0 && v <= 100)) {
        errors.push('devWatch.holderTop5MaxPct must be between 0 and 100');
      }
    }
    if (dw.lpBurnMinPct !== undefined) {
      const v = Number(dw.lpBurnMinPct);
      if (!(v >= 0 && v <= 100)) {
        errors.push('devWatch.lpBurnMinPct must be between 0 and 100');
      }
    }
  }

  // Cross‑feed token resolver
  if (cfg.feeds) {
    const feeds = cfg.feeds;
    if (feeds.order !== undefined) {
      if (!Array.isArray(feeds.order) || feeds.order.length === 0) {
        errors.push('feeds.order must be a non-empty array');
      } else {
        const allowed = ['ws', 'birdeye', 'onchain'];
        feeds.order.forEach((s, i) => {
          if (!allowed.includes(s)) {
            errors.push(`feeds.order[${i}] must be one of ${allowed.join(', ')}`);
          }
        });
      }
    }
    if (feeds.ttlMs !== undefined) {
      const v = Number(feeds.ttlMs);
      if (!(v > 0)) {
        errors.push('feeds.ttlMs must be positive');
      }
    }
    if (feeds.timeoutMs !== undefined) {
      const v = Number(feeds.timeoutMs);
      if (!(v > 0)) {
        errors.push('feeds.timeoutMs must be positive');
      }
    }
  }

  // Auto Slippage Governor
  if (cfg.slippageAuto) {
    const sa = cfg.slippageAuto;
    if (sa.floorPct !== undefined) {
      const v = Number(sa.floorPct);
      if (!(v >= 0)) {
        errors.push('slippageAuto.floorPct must be >= 0');
      }
    }
    if (sa.ceilPct !== undefined) {
      const v = Number(sa.ceilPct);
      const floor = Number(sa.floorPct);
      if (!(v >= 0)) {
        errors.push('slippageAuto.ceilPct must be >= 0');
      } else if (sa.floorPct !== undefined && v < floor) {
        errors.push('slippageAuto.ceilPct must be >= floorPct');
      }
    }
    if (sa.sensitivity !== undefined) {
      const v = Number(sa.sensitivity);
      if (!(v >= 0 && v <= 1)) {
        errors.push('slippageAuto.sensitivity must be between 0 and 1');
      }
    }
  }

  // Post‑trade chain
  if (cfg.postTx) {
    const pt = cfg.postTx;
    if (pt.chain !== undefined) {
      if (!Array.isArray(pt.chain) || pt.chain.length === 0) {
        errors.push('postTx.chain must be a non-empty array');
      } else {
        const allowed = ['tp', 'trail', 'alerts'];
        pt.chain.forEach((c, i) => {
          if (!allowed.includes(c)) {
            errors.push(`postTx.chain[${i}] must be one of ${allowed.join(', ')}`);
          }
        });
      }
    }
    if (pt.ensureQueued !== undefined && typeof pt.ensureQueued !== 'boolean') {
      errors.push('postTx.ensureQueued must be a boolean');
    }
  }

  return errors;
}