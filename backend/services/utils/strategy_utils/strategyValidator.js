// backend/services/utils/strategy_utils/strategyValidator.js
// ------------------------------------------------------------
//  Central place to validate ALL strategy configs
// ------------------------------------------------------------

/* ---------- helpers --------------------------------------------------- */
const parseMinutes = require("../math/parseMinutes");

/* ---------- generic helpers ------------------------------------------ */
function isValidSolanaAddress(address = "") {
  return /^([1-9A-HJ-NP-Za-km-z]{32,44})$/.test(address);
}

/** numeric string OR number */
function isNumeric(v) {
  return (
    (typeof v === "number" && !isNaN(v)) ||
    (typeof v === "string" && v.trim() !== "" && !isNaN(v))
  );
}

function toNum(v) {
  return typeof v === "string" ? Number(v) : v;
}

/** treat undefined | null | 0 as “unset” */
function isUnset(v) {
  return v === undefined || v === null || (isNumeric(v) && toNum(v) === 0);
}

/* ---------- helper: unified amount resolver --------------------------- */
function resolveAmount(cfg = {}) {
  return (
    cfg.amountToSpend ??
    cfg.snipeAmount ??
    cfg.spendAmount ??
    cfg.amount
  );
}

/* ---------- token-feed helpers --------------------------------------- */
function validateTokenFeed(cfg = {}, label, errors) {
  // accept only these three literals
  if (
    cfg.tokenFeed !== undefined &&
    !["new", "trending", "all"].includes(cfg.tokenFeed)
  ) {
    errors.push(`${label}: tokenFeed must be 'new', 'trending', or 'all'`);
  }

  if (
    cfg.overrideMonitored !== undefined &&
    typeof cfg.overrideMonitored !== "boolean"
  ) {
    errors.push(`${label}: overrideMonitored must be boolean`);
  }

  if (cfg.monitoredTokens !== undefined) {
    if (!Array.isArray(cfg.monitoredTokens)) {
      errors.push(`${label}: monitoredTokens must be an array of mint strings`);
    } else {
      cfg.monitoredTokens.forEach((m) => {
        if (!isValidSolanaAddress(m))
          errors.push(`${label}: monitoredTokens mint ${m} is invalid`);
      });
    }
  }
}

/** enforce “pick a feed OR custom list” */
function requireTokenFeed(cfg = {}, label, errors) {
  const listOk =
    Array.isArray(cfg.monitoredTokens) && cfg.monitoredTokens.length > 0;
  if (!cfg.tokenFeed && !listOk) {
    errors.push(`${label}: tokenFeed (new/trending/all) or monitoredTokens[] is required`);
  }
}

/* ---------- SHARED RULES (apply to EVERY strategy) -------------------- */
function validateSharedConfig(cfg = {}) {
  const errors = [];

  /* —— core numeric / address checks —— */
  if (
    cfg.tokenMint !== undefined &&
    cfg.tokenMint !== null &&
    cfg.tokenMint !== ""
  ) {
    if (!isValidSolanaAddress(cfg.tokenMint)) {
      errors.push("tokenMint is provided but is not a valid Solana address");
    }
  }

  if (!isUnset(cfg.entryThreshold)) {
    if (
      !isNumeric(cfg.entryThreshold) ||
      toNum(cfg.entryThreshold) < 0 ||
      toNum(cfg.entryThreshold) > 100
    ) {
      errors.push("entryThreshold must be a number between 0 and 100 %");
    }
  }

  if (!isUnset(cfg.volumeThreshold)) {
    if (!isNumeric(cfg.volumeThreshold) || toNum(cfg.volumeThreshold) < 0)
      errors.push("volumeThreshold (USD) must be ≥ 0");
  }

  /* required core fields */
 if (
   !isNumeric(cfg.slippage) ||
   toNum(cfg.slippage) < 0.01 ||
   toNum(cfg.slippage) > 99
 ) {
   errors.push("Slippage must be between 0.01 % and 99 %");
 }

  if (
    !isNumeric(cfg.interval) ||
    toNum(cfg.interval) < 1 ||
    toNum(cfg.interval) > 3600
  ) {
    errors.push("Scan interval must be between 1 and 3600 seconds");
  }

  if (
    !isNumeric(cfg.maxTrades) ||
    toNum(cfg.maxTrades) < 1 ||
    toNum(cfg.maxTrades) > 20
  ) {
    errors.push("Max trades must be between 1 and 20");
  }

  /* —— unified amount check —— */
  const amt = resolveAmount(cfg);
  if (!isNumeric(amt) || toNum(amt) <= 0) {
    errors.push(
      "Amount field missing or ≤ 0 (accepted keys: amountToSpend, snipeAmount, spendAmount, amount)"
    );
  }

  /* —— optional numeric gates —— */
  if (!isUnset(cfg.takeProfit)) {
    if (
      !isNumeric(cfg.takeProfit) ||
      toNum(cfg.takeProfit) < 0 ||
      toNum(cfg.takeProfit) > 100
    )
      errors.push("Take-profit must be between 0 % and 100 %");
  }

  if (!isUnset(cfg.stopLoss)) {
    if (
      !isNumeric(cfg.stopLoss) ||
      toNum(cfg.stopLoss) < 0 ||
      toNum(cfg.stopLoss) > 100
    )
      errors.push("Stop-loss must be between 0 % and 100 %");
  }

  if (!isUnset(cfg.targetPriceUSD)) {
    if (!isNumeric(cfg.targetPriceUSD) || toNum(cfg.targetPriceUSD) < 0)
      errors.push("targetPriceUSD must be ≥ 0");
  }

  if (cfg.buyWithUSDC !== undefined && typeof cfg.buyWithUSDC !== "boolean") {
    errors.push("buyWithUSDC must be true or false");
  }

  if (
    cfg.buyWithUSDC === true &&
    (!isNumeric(cfg.usdcAmount) || toNum(cfg.usdcAmount) <= 0)
  ) {
    errors.push("usdcAmount must be > 0 when buyWithUSDC is true");
  }

  /* —— safety toggles —— */
  if (
    cfg.safetyEnabled !== undefined &&
    typeof cfg.safetyEnabled !== "boolean"
  ) {
    errors.push("safetyEnabled must be boolean (true / false)");
  }

  if (cfg.safetyChecks !== undefined) {
    if (
      typeof cfg.safetyChecks !== "object" ||
      Array.isArray(cfg.safetyChecks)
    ) {
      errors.push("safetyChecks must be an object with boolean flags");
    } else {
      for (const [k, v] of Object.entries(cfg.safetyChecks)) {
        if (typeof v !== "boolean") {
          errors.push(`safetyChecks.${k} must be boolean`);
        }
      }
    }
  }

  return errors;
}

/* ---------- STRATEGY-SPECIFIC VALIDATORS ----------------------------- */
function validateSniper(cfg = {}) {
  const errors = validateSharedConfig(cfg);
  validateTokenFeed(cfg, "Sniper", errors);
  requireTokenFeed(cfg, "Sniper", errors);

  /* optional caps */
  ["minMarketCap", "maxMarketCap"].forEach((k) => {
    if (!isUnset(cfg[k]) && (!isNumeric(cfg[k]) || toNum(cfg[k]) < 0))
      errors.push(`Sniper: ${k} must be ≥ 0 USD`);
  });

  if (!isUnset(cfg.haltOnFailures)) {
    if (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1)
      errors.push("Sniper: haltOnFailures must be an integer ≥ 1");
  }

  if (!isUnset(cfg.cooldown)) {
    if (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
      errors.push("Sniper: cooldown must be ≥ 0 seconds");
  }

  /* token-age windows */
  ["minTokenAgeMinutes", "maxTokenAgeMinutes"].forEach((k) => {
    if (!isUnset(cfg[k])) {
      try {
        parseMinutes(cfg[k], { floor: 1, ceil: 1440 });
      } catch (e) {
        errors.push(`${k} ${e.message}`);
      }
    }
  });

  if (!isUnset(cfg.dipThreshold)) {
    if (
      !isNumeric(cfg.dipThreshold) ||
      toNum(cfg.dipThreshold) < 0 ||
      toNum(cfg.dipThreshold) > 100
    )
      errors.push("Sniper: dipThreshold must be between 0 and 100 %");
  }

  if (!isUnset(cfg.recoveryWindow)) {
    try {
      parseMinutes(cfg.recoveryWindow, { floor: 1, ceil: 1440 });
    } catch (e) {
      errors.push(`recoveryWindow ${e.message}`);
    }
  }

  if (!isUnset(cfg.delayBeforeBuyMs)) {
    if (!isNumeric(cfg.delayBeforeBuyMs) || toNum(cfg.delayBeforeBuyMs) < 0)
      errors.push("Sniper: delayBeforeBuyMs must be ≥ 0 ms");
  }

  if (!isUnset(cfg.priorityFeeLamports)) {
    if (
      !Number.isInteger(toNum(cfg.priorityFeeLamports)) ||
      toNum(cfg.priorityFeeLamports) < 0
    )
      errors.push("Sniper: priorityFeeLamports must be an integer ≥ 0");
  }

  if (!isUnset(cfg.maxSlippage)) {
    if (
      !isNumeric(cfg.maxSlippage) ||
      toNum(cfg.maxSlippage) < 0 ||
      toNum(cfg.maxSlippage) > 10
    )
      errors.push("Sniper: maxSlippage must be between 0 % and 10 %");
  }

  return errors;
}




function validateScalper(cfg = {}) {
  const errors = validateSharedConfig(cfg);
  validateTokenFeed(cfg, "Scalper", errors);
  requireTokenFeed(cfg, "Scalper", errors);

  if (!isUnset(cfg.entryThreshold)) {
    if (
      !isNumeric(cfg.entryThreshold) ||
      toNum(cfg.entryThreshold) < 0 ||
      toNum(cfg.entryThreshold) > 10
    )
      errors.push("Scalper: entryThreshold must be between 0 and 10 %");
  }

  if (!isUnset(cfg.volumeThreshold)) {
    if (!isNumeric(cfg.volumeThreshold) || toNum(cfg.volumeThreshold) < 0)
      errors.push("Scalper: volumeThreshold (USD) must be ≥ 0");
  }

  ["minMarketCap", "maxMarketCap"].forEach((k) => {
    if (!isUnset(cfg[k]) && (!isNumeric(cfg[k]) || toNum(cfg[k]) < 0))
      errors.push(`Scalper: ${k} must be ≥ 0 USD`);
  });

  if (!isUnset(cfg.volumeSpikeMultiplier)) {
    if (!isNumeric(cfg.volumeSpikeMultiplier) || toNum(cfg.volumeSpikeMultiplier) < 1)
      errors.push("Scalper: volumeSpikeMultiplier must be ≥ 1");
  }

  if (!isUnset(cfg.haltOnFailures)) {
    if (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1)
      errors.push("Scalper: haltOnFailures must be an integer ≥ 1");
  }

  if (!isUnset(cfg.cooldown)) {
    if (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
      errors.push("Scalper: cooldown must be ≥ 0 ms");
  }

  return errors;
}

/* ───── Paper Trader ────────────────────────────────────────────────── */
function validatePaperTrader(cfg = {}) {
  const errors = validateSharedConfig(cfg);
  validateTokenFeed(cfg, "PaperTrader", errors);
  requireTokenFeed(cfg, "PaperTrader", errors);

  if (!isUnset(cfg.entryThreshold)) {
    if (
      !isNumeric(cfg.entryThreshold) ||
      toNum(cfg.entryThreshold) < 0 ||
      toNum(cfg.entryThreshold) > 100
    )
      errors.push("PaperTrader: entryThreshold must be between 0 and 100 %");
  }

  if (!isUnset(cfg.volumeThreshold)) {
    if (!isNumeric(cfg.volumeThreshold) || toNum(cfg.volumeThreshold) < 0)
      errors.push("PaperTrader: volumeThreshold (USD) must be ≥ 0");
  }

  if (!isUnset(cfg.maxDailyTrades)) {
    if (!Number.isInteger(toNum(cfg.maxDailyTrades)) || toNum(cfg.maxDailyTrades) < 1)
      errors.push("PaperTrader: maxDailyTrades must be an integer ≥ 1");
  }

  if (!isUnset(cfg.cooldown)) {
    if (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
      errors.push("PaperTrader: cooldown must be ≥ 0 ms");
  }

  // ✨ Added in paper-sim-upgrade
  // Simulation specific validations.  These options are entirely
  // optional and default values are supplied by the backend.  When
  // present we enforce basic sanity checks to prevent invalid
  // configurations from reaching the simulator.
  if (!isUnset(cfg.execModel)) {
    const allowed = ["ideal", "amm_depth", "jito_fallback"];
    if (!allowed.includes(cfg.execModel)) {
      errors.push("PaperTrader: execModel must be 'ideal', 'amm_depth' or 'jito_fallback'");
    }
  }

  if (!isUnset(cfg.slippageBpsCap)) {
    if (!isNumeric(cfg.slippageBpsCap) || toNum(cfg.slippageBpsCap) < 0) {
      errors.push("PaperTrader: slippageBpsCap must be a number ≥ 0");
    }
  }

  if (cfg.latency !== undefined) {
    if (typeof cfg.latency !== "object") {
      errors.push("PaperTrader: latency must be an object with quoteMs, buildMs, sendMs and landMs");
    } else {
      ["quoteMs", "buildMs", "sendMs", "landMs"].forEach((k) => {
        const v = cfg.latency[k];
        if (v !== undefined && (!isNumeric(v) || toNum(v) < 0)) {
          errors.push(`PaperTrader: latency.${k} must be ≥ 0`);
        }
      });
    }
  }

  if (cfg.failureRates !== undefined) {
    if (typeof cfg.failureRates !== "object") {
      errors.push("PaperTrader: failureRates must be an object");
    } else {
      Object.entries(cfg.failureRates).forEach(([k, v]) => {
        if (!isNumeric(v) || toNum(v) < 0 || toNum(v) > 1) {
          errors.push(`PaperTrader: failureRates.${k} must be between 0 and 1`);
        }
      });
    }
  }

  if (cfg.partials !== undefined) {
    if (typeof cfg.partials !== "object") {
      errors.push("PaperTrader: partials must be an object");
    } else {
      const min = cfg.partials.minParts;
      const max = cfg.partials.maxParts;
      if (min !== undefined) {
        if (!Number.isInteger(toNum(min)) || toNum(min) < 1) {
          errors.push("PaperTrader: partials.minParts must be an integer ≥ 1");
        }
      }
      if (max !== undefined) {
        if (!Number.isInteger(toNum(max)) || toNum(max) < 1) {
          errors.push("PaperTrader: partials.maxParts must be an integer ≥ 1");
        }
        if (min !== undefined && toNum(max) < toNum(min)) {
          errors.push("PaperTrader: partials.maxParts must be ≥ minParts");
        }
      }
    }
  }

  if (!isUnset(cfg.enableShadowMode)) {
    if (typeof cfg.enableShadowMode !== "boolean") {
      errors.push("PaperTrader: enableShadowMode must be a boolean");
    }
  }

  if (!isUnset(cfg.seed)) {
    if (typeof cfg.seed !== "string") {
      errors.push("PaperTrader: seed must be a string");
    }
  }

  if (!isUnset(cfg.paperRunId)) {
    if (typeof cfg.paperRunId !== "string") {
      errors.push("PaperTrader: paperRunId must be a string");
    }
  }

  return errors;
}

/* ───── Breakout ─────────────────────────────────────────────────────── */
function validateBreakout(cfg = {}) {
  const errors = validateSharedConfig(cfg);
  validateTokenFeed(cfg, "Breakout", errors);
  requireTokenFeed(cfg, "Breakout", errors);

  if (!isUnset(cfg.breakoutThreshold)) {
    if (
      !isNumeric(cfg.breakoutThreshold) ||
      toNum(cfg.breakoutThreshold) < 0 ||
      toNum(cfg.breakoutThreshold) > 100
    )
      errors.push("Breakout: breakoutThreshold must be between 0 and 100 %");
  }

  if (!isUnset(cfg.minLiquidity)) {
    if (!isNumeric(cfg.minLiquidity) || toNum(cfg.minLiquidity) < 0)
      errors.push("Breakout: minLiquidity (USD) must be ≥ 0");
  }

  if (!isUnset(cfg.volumeSpikeMultiplier)) {
    if (!isNumeric(cfg.volumeSpikeMultiplier) || toNum(cfg.volumeSpikeMultiplier) < 1)
      errors.push("Breakout: volumeSpikeMultiplier must be ≥ 1");
  }

  ["minMarketCap", "maxMarketCap"].forEach((k) => {
    if (!isUnset(cfg[k]) && (!isNumeric(cfg[k]) || toNum(cfg[k]) < 0))
      errors.push(`Breakout: ${k} must be ≥ 0 USD`);
  });

  if (!isUnset(cfg.haltOnFailures)) {
    if (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1)
      errors.push("Breakout: haltOnFailures must be an integer ≥ 1");
  }

  if (!isUnset(cfg.cooldown)) {
    if (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
      errors.push("Breakout: cooldown must be ≥ 0 ms");
  }

  return errors;
}

/* ───── Chad Mode ───────────────────────────────────────────────── */
function validateChadMode(cfg = {}) {
  const errors = validateSharedConfig(cfg);

  // Allow either outputMint or outputMints
  const hasSingle = !!cfg.outputMint;
  const hasMulti = Array.isArray(cfg.outputMints) && cfg.outputMints.length > 0;

  if (!hasSingle && !hasMulti)
    errors.push("ChadMode: Either outputMint or outputMints is required");

  if (hasMulti) {
    cfg.outputMints.forEach((mint, i) => {
      if (typeof mint !== "string" || !mint.trim())
        errors.push(`ChadMode: outputMints[${i}] is invalid`);
    });
  }

  if (!isUnset(cfg.minVolumeRequired)) {
    if (!isNumeric(cfg.minVolumeRequired) || toNum(cfg.minVolumeRequired) < 0)
      errors.push("ChadMode: minVolumeRequired (USD) must be ≥ 0");
  }

  if (!isUnset(cfg.priorityFeeLamports)) {
    if (
      !Number.isInteger(toNum(cfg.priorityFeeLamports)) ||
      toNum(cfg.priorityFeeLamports) < 0
    )
      errors.push("ChadMode: priorityFeeLamports must be an integer ≥ 0");
  }

  if (!isUnset(cfg.panicDumpPct)) {
    if (!isNumeric(cfg.panicDumpPct) || toNum(cfg.panicDumpPct) < 0)
      errors.push("ChadMode: panicDumpPct must be ≥ 0");
  }

  ["slippageMaxPct", "feeEscalationLamports"].forEach((k) => {
    if (!isUnset(cfg[k])) {
      if (!isNumeric(cfg[k]) || toNum(cfg[k]) < 0)
        errors.push(`ChadMode: ${k} must be ≥ 0`);
    }
  });

  if (cfg.autoSell !== undefined && typeof cfg.autoSell !== "object")
    errors.push("ChadMode: autoSell must be an object");

  if (cfg.autoSell?.randomDelayRange) {
    const [min, max] = cfg.autoSell.randomDelayRange;
    if (
      !isNumeric(min) ||
      !isNumeric(max) ||
      toNum(min) < 0 ||
      toNum(max) < toNum(min)
    )
      errors.push(
        "ChadMode: autoSell.randomDelayRange must be [min,max] with min ≥ 0 ≤ max"
      );
  }

  return errors;
}

/* ───── Delayed Sniper ─────────────────────────────────────────────── */
function validateDelayedSniper(cfg = {}) {
  const errors = validateSharedConfig(cfg);
  validateTokenFeed(cfg, "DelayedSniper", errors);
  requireTokenFeed(cfg, "DelayedSniper", errors);

  if (!isNumeric(cfg.delayMs) || toNum(cfg.delayMs) < 1)
    errors.push("DelayedSniper: delayMs must be > 0 ms");

  if (!isUnset(cfg.scanInterval)) {
    if (!isNumeric(cfg.scanInterval) || toNum(cfg.scanInterval) < 1)
      errors.push("DelayedSniper: scanInterval must be > 0 ms");
  }

  if (!isUnset(cfg.entryThreshold)) {
    if (
      !isNumeric(cfg.entryThreshold) ||
      toNum(cfg.entryThreshold) < 0 ||
      toNum(cfg.entryThreshold) > 100
    )
      errors.push("DelayedSniper: entryThreshold must be between 0 and 100 %");
  }

  if (!isUnset(cfg.volumeThreshold)) {
    if (!isNumeric(cfg.volumeThreshold) || toNum(cfg.volumeThreshold) < 0)
      errors.push("DelayedSniper: volumeThreshold (USD) must be ≥ 0");
  }

  ["minMarketCap", "maxMarketCap"].forEach((k) => {
    if (!isUnset(cfg[k]) && (!isNumeric(cfg[k]) || toNum(cfg[k]) < 0))
      errors.push(`DelayedSniper: ${k} must be ≥ 0 USD`);
  });

  if (!isUnset(cfg.haltOnFailures)) {
    if (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1)
      errors.push("DelayedSniper: haltOnFailures must be an integer ≥ 1");
  }

  if (!isUnset(cfg.cooldown)) {
    if (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
      errors.push("DelayedSniper: cooldown must be ≥ 0 seconds");
  }

  return errors;
}

/* ───── Dip Buyer ────────────────────────────────────────────────────── */
function validateDipBuyer(cfg = {}) {
  const errors = validateSharedConfig(cfg);
  validateTokenFeed(cfg, "DipBuyer", errors);
  requireTokenFeed(cfg, "DipBuyer", errors);

  if (!isUnset(cfg.dipThreshold)) {
    if (
      !isNumeric(cfg.dipThreshold) ||
      toNum(cfg.dipThreshold) < 0 ||
      toNum(cfg.dipThreshold) > 99
    )
      errors.push("DipBuyer: dipThreshold must be between 0 and 99 %");
  }

  if (!isUnset(cfg.volumeThreshold)) {
    if (!isNumeric(cfg.volumeThreshold) || toNum(cfg.volumeThreshold) < 0)
      errors.push("DipBuyer: volumeThreshold (USD) must be ≥ 0");
  }

  ["minMarketCap", "maxMarketCap"].forEach((k) => {
    if (!isUnset(cfg[k]) && (!isNumeric(cfg[k]) || toNum(cfg[k]) < 0))
      errors.push(`DipBuyer: ${k} must be ≥ 0 USD`);
  });

  if (!isUnset(cfg.haltOnFailures)) {
    if (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1)
      errors.push("DipBuyer: haltOnFailures must be an integer ≥ 1");
  }

  if (!isUnset(cfg.cooldown)) {
    if (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
      errors.push("DipBuyer: cooldown must be ≥ 0 ms");
  }


  return errors;
}

/* ───── Rebalancer ─────────────────────────────────────────────────── */
function validateRebalancer(cfg = {}) {

   const errors = [];
      if (cfg.autoWallet) return errors;

  
  /* —— core numeric / address checks —— */
  if (
    cfg.tokenMint !== undefined &&
    cfg.tokenMint !== null &&
    cfg.tokenMint !== ""
  ) {
    if (!isValidSolanaAddress(cfg.tokenMint)) {
      errors.push("tokenMint is provided but is not a valid Solana address");
    }
  }

  const tgt = cfg.targetAllocations ?? cfg.targetWeights;
  if (!tgt || typeof tgt !== "object" || !Object.keys(tgt).length)
    errors.push("Rebalancer: targetAllocations object is required");

  if (!isNumeric(cfg.rebalanceThreshold) || toNum(cfg.rebalanceThreshold) <= 0)
    errors.push("Rebalancer: rebalanceThreshold must be > 0 %");

  if (!isUnset(cfg.rebalanceInterval)) {
    if (!isNumeric(cfg.rebalanceInterval) || toNum(cfg.rebalanceInterval) < 0)
      errors.push("Rebalancer: rebalanceInterval must be ≥ 0 ms");
  }

  if (!isUnset(cfg.minSolBalance)) {
    if (!isNumeric(cfg.minSolBalance) || toNum(cfg.minSolBalance) < 0.01)
      errors.push("minSolBalance must be ≥ 0.01 SOL");
  }

  if (!isUnset(cfg.priorityFeeLamports)) {
    if (
      !Number.isInteger(toNum(cfg.priorityFeeLamports)) ||
      toNum(cfg.priorityFeeLamports) < 0
    )
      errors.push("Rebalancer: priorityFeeLamports must be an integer ≥ 0");
  }

  if (cfg.skipSafety !== undefined && typeof cfg.skipSafety !== "boolean")
    errors.push("Rebalancer: skipSafety must be true/false");

  /* weights > 0 */
  for (const [mint, weight] of Object.entries(tgt ?? {})) {
    if (!isValidSolanaAddress(mint))
      errors.push(`Rebalancer: ${mint} is not a valid mint`);
    if (!isNumeric(weight) || toNum(weight) <= 0)
      errors.push(`Rebalancer: weight for ${mint.slice(0, 4)}… must be > 0`);
  }


  /* required core fields */
 if (
   !isNumeric(cfg.slippage) ||
   toNum(cfg.slippage) < 0.01 ||
   toNum(cfg.slippage) > 99
 ) {
   errors.push("Slippage must be between 0.01 % and 99 %");
 }


  if (
    !isNumeric(cfg.maxRebalances) ||
    toNum(cfg.maxRebalances) < 1 ||
    toNum(cfg.maxRebalances) > 20
  ) {
    errors.push("Max Rebalances must be between 1 and 20");
  }

  if (!isUnset(cfg.maxTradesPerCycle)) {
  if (
    !isNumeric(cfg.maxTradesPerCycle) ||
    toNum(cfg.maxTradesPerCycle) < 1 ||
    toNum(cfg.maxTradesPerCycle) > 20
  ) errors.push("maxTradesPerCycle must be between 1 and 20");
}


  if (!isUnset(cfg.targetPriceUSD)) {
    if (!isNumeric(cfg.targetPriceUSD) || toNum(cfg.targetPriceUSD) < 0)
      errors.push("targetPriceUSD must be ≥ 0");
  }

  if (cfg.buyWithUSDC !== undefined && typeof cfg.buyWithUSDC !== "boolean") {
    errors.push("buyWithUSDC must be true or false");
  }

  if (
    cfg.buyWithUSDC === true &&
    (!isNumeric(cfg.usdcAmount) || toNum(cfg.usdcAmount) <= 0)
  ) {
    errors.push("usdcAmount must be > 0 when buyWithUSDC is true");
  }

  return errors;
}




/* ───── Rotation Bot ─────────────────────────────────────────────────── */
function validateRotationBot(cfg = {}) {
   const errors = [];


  /* —— core numeric / address checks —— */
  if (
    cfg.tokenMint !== undefined &&
    cfg.tokenMint !== null &&
    cfg.tokenMint !== ""
  ) {
    if (!isValidSolanaAddress(cfg.tokenMint)) {
      errors.push("tokenMint is provided but is not a valid Solana address");
    }
  }

  /* required core fields */
 if (
   !isNumeric(cfg.slippage) ||
   toNum(cfg.slippage) < 0.01 ||
   toNum(cfg.slippage) > 99
 ) {
   errors.push("Slippage must be between 0.01 % and 99 %");
 }


  if (
    !isNumeric(cfg.maxTrades) ||
    toNum(cfg.maxTrades) < 1 ||
    toNum(cfg.maxTrades) > 20
  ) {
    errors.push("Max trades must be between 1 and 20");
  }


  if (
    !(Array.isArray(cfg.tokens) && cfg.tokens.length) &&
    !(cfg.sectors && Object.values(cfg.sectors).length)
  ) {
    errors.push("RotationBot: provide either tokens[] or sectors{}");
  }

  if (Array.isArray(cfg.tokens)) {
    cfg.tokens.forEach((m) => {
      if (!isValidSolanaAddress(m))
        errors.push(`RotationBot: token mint ${m} is invalid`);
    });
  }

  if (!isUnset(cfg.rotationInterval)) {
    if (!isNumeric(cfg.rotationInterval) || toNum(cfg.rotationInterval) < 0)
      errors.push("RotationBot: rotationInterval must be ≥ 0 ms");
  }

  if (!isUnset(cfg.minMomentum)) {
    if (
      !isNumeric(cfg.minMomentum) ||
      toNum(cfg.minMomentum) < 0 ||
      toNum(cfg.minMomentum) > 100
    )
      errors.push("RotationBot: minMomentum must be between 0 and 100 %");
  }

  if (!isUnset(cfg.cooldown)) {
    if (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
      errors.push("RotationBot: cooldown must be ≥ 0 ms");
  }

  if (!isUnset(cfg.haltOnFailures)) {
    if (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1)
      errors.push("RotationBot: haltOnFailures must be an integer ≥ 1");
  }



  if (!isUnset(cfg.targetPriceUSD)) {
    if (!isNumeric(cfg.targetPriceUSD) || toNum(cfg.targetPriceUSD) < 0)
      errors.push("targetPriceUSD must be ≥ 0");
  }

  if (cfg.buyWithUSDC !== undefined && typeof cfg.buyWithUSDC !== "boolean") {
    errors.push("buyWithUSDC must be true or false");
  }

  if (
    cfg.buyWithUSDC === true &&
    (!isNumeric(cfg.usdcAmount) || toNum(cfg.usdcAmount) <= 0)
  ) {
    errors.push("usdcAmount must be > 0 when buyWithUSDC is true");
  }

  /* —— safety toggles —— */
  if (
    cfg.safetyEnabled !== undefined &&
    typeof cfg.safetyEnabled !== "boolean"
  ) {
    errors.push("safetyEnabled must be boolean (true / false)");
  }

  if (cfg.safetyChecks !== undefined) {
    if (
      typeof cfg.safetyChecks !== "object" ||
      Array.isArray(cfg.safetyChecks)
    ) {
      errors.push("safetyChecks must be an object with boolean flags");
    } else {
      for (const [k, v] of Object.entries(cfg.safetyChecks)) {
        if (typeof v !== "boolean") {
          errors.push(`safetyChecks.${k} must be boolean`);
        }
      }
    }
  }


  return errors;
}



/* ───── Trend Follower ─────────────────────────────────────────────── */
function validateTrendFollower(cfg = {}) {
  const errors = validateSharedConfig(cfg);
  validateTokenFeed(cfg, "Trendfollower", errors);
  requireTokenFeed(cfg, "Trendfollower", errors);

  ["minMarketCap", "maxMarketCap"].forEach((k) => {
    if (!isUnset(cfg[k]) && (!isNumeric(cfg[k]) || toNum(cfg[k]) < 0))
      errors.push(`Trendfollower: ${k} must be ≥ 0 USD`);
  });

  if (!isUnset(cfg.haltOnFailures)) {
    if (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1)
      errors.push("Trendfollower: haltOnFailures must be an integer ≥ 1");
  }

  if (!isUnset(cfg.cooldown)) {
    if (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
      errors.push("Trendfollower: cooldown must be ≥ 0 seconds");
  }

  ["minTokenAgeMinutes", "maxTokenAgeMinutes"].forEach((k) => {
    if (!isUnset(cfg[k])) {
      try {
        parseMinutes(cfg[k], { floor: 1, ceil: 1440 });
      } catch (e) {
        errors.push(`Trendfollower: ${k} ${e.message}`);
      }
    }
  });

  if (!isUnset(cfg.dipThreshold) && !isUnset(cfg.entryThreshold)) {
    if (toNum(cfg.dipThreshold) > 0 && toNum(cfg.entryThreshold) > 0) {
      errors.push(
        "Trendfollower: cannot set both dipThreshold and entryThreshold at the same time."
      );
    }
  }

  if (!isUnset(cfg.delayBeforeBuyMs)) {
    if (!isNumeric(cfg.delayBeforeBuyMs) || toNum(cfg.delayBeforeBuyMs) < 0)
      errors.push("Trendfollower: delayBeforeBuyMs must be ≥ 0 ms");
  }

  if (!isUnset(cfg.priorityFeeLamports)) {
    if (
      !Number.isInteger(toNum(cfg.priorityFeeLamports)) ||
      toNum(cfg.priorityFeeLamports) < 0
    )
      errors.push("Trendfollower: priorityFeeLamports must be an integer ≥ 0");
  }

  if (!isUnset(cfg.maxSlippage)) {
    if (
      !isNumeric(cfg.maxSlippage) ||
      toNum(cfg.maxSlippage) < 0 ||
      toNum(cfg.maxSlippage) > 10
    )
      errors.push("Trendfollower: maxSlippage must be between 0 % and 10 %");
  }

  return errors;
}



/* ───── Stealth Bot ─────────────────────────────────────────────── */
/* very small validator – only core fields */

function validateStealthBot(cfg = {}) {
  const errs = [];

  if (!Array.isArray(cfg.wallets) || cfg.wallets.length < 1)
    errs.push("wallets[] must have at least one wallet label");

  if (!cfg.tokenMint || !isValidSolanaAddress(cfg.tokenMint))
    errs.push("tokenMint is missing or invalid");

  if (isUnset(cfg.positionSize) || !isNumeric(cfg.positionSize) || toNum(cfg.positionSize) <= 0)
    errs.push("positionSize (SOL per wallet) must be > 0");

  if (!isUnset(cfg.slippage) && (toNum(cfg.slippage) <= 0 || toNum(cfg.slippage) > 99))
    errs.push("slippage must be >0 and <100");

  return errs;
}


function validateScheduleLauncher(cfg = {}) {
  const errs = [];

  if (!cfg.outputMint || typeof cfg.outputMint !== "string") {
    errs.push("Missing or invalid output mint");
  }

  if (+cfg.slippage > 100 || +cfg.slippage < 0) {
    errs.push("Slippage must be between 0 and 100");
  }

  if (
    cfg.name &&
    (typeof cfg.name !== "string" ||
      cfg.name.trim().length < 2 ||
      cfg.name.length > 32)
  ) {
    errs.push("Name must be between 2–32 characters");
  }

  // ────────────────────────
  //  INTERVAL MODE CHECKS
  // ────────────────────────
  if (cfg.buyMode === "interval") {
    const spend = +cfg.amountToSpend;
    const interval = +cfg.interval;
    const maxTrades = +cfg.maxTrades;

    if (!Number.isFinite(spend) || spend <= 0)
      errs.push("Invalid amount to spend");

    if (spend < 0.01)
      errs.push("Amount to spend must be at least 0.01 SOL");

    if (!Number.isFinite(interval) || interval <= 0)
      errs.push("Interval must be a positive number");

    if (interval < 10 || interval > 3600)
      errs.push("Interval must be between 10 and 3600 seconds");

    if (!Number.isFinite(maxTrades) || maxTrades <= 0)
      errs.push("Max trades must be a positive number");

    if (maxTrades > 25)
      errs.push("Max trades capped at 25 for interval mode");
  }

  // ────────────────────────
  // 🟦 LIMIT MODE CHECKS
  // ────────────────────────
  if (cfg.buyMode === "limit") {
    if (!Array.isArray(cfg.limitConfigs) || cfg.limitConfigs.length === 0) {
      errs.push("Limit mode requires at least one limit config");
    } else {
      if (cfg.limitConfigs.length > 10)
        errs.push("Limit mode supports a maximum of 10 tiers");

      cfg.limitConfigs.forEach((t, i) => {
        if (!t || typeof t !== "object") {
          errs.push(`Limit config #${i + 1} is not a valid object`);
          return;
        }

        const { price, amount } = t;

        if (!Number.isFinite(+price) || +price <= 0)
          errs.push(`Limit #${i + 1} has invalid USD price`);

        if (+price < 0.0001)
          errs.push(`Limit #${i + 1} price must be ≥ $0.0001`);

        if (!Number.isFinite(+amount) || +amount <= 0)
          errs.push(`Limit #${i + 1} has invalid USD amount`);

        if (+amount < 0.01)
          errs.push(`Limit #${i + 1} amount must be ≥ $0.01 USD`);
      });
    }
  }

  return errs;
}

/* ───── Turbo Sniper ─────────────────────────────────────────────── */
/**
 * Validate Turbo Sniper configs.  Builds on the base Sniper validator and
 * enforces bounds on the additional turbo settings (e.g. multi-buy count,
 * RPC failover, kill switch).  Boolean flags must be boolean when
 * provided; numeric parameters are coerced and checked for sane ranges.
 */
'use strict';

// Assumes these exist in the module scope or are imported by the caller file:
// - validateSniper(cfg)
// - isUnset(v)
// - isNumeric(v)
// - toNum(v)

// backend/services/strategies/validators/turboSniperValidator.js

export function validateTurboConfig(cfg) {
  const errors = [];

  const mode = cfg.smartExitMode || SmartExitMode.NONE;
  const push = (m) => errors.push(String(m));

  // LP Gate
  if (cfg.minPoolUsd != null && (isNaN(cfg.minPoolUsd) || cfg.minPoolUsd < 0)) {
    push("minPoolUsd must be ≥ 0");
  }
  if (
    cfg.maxPriceImpactPct != null &&
    (isNaN(cfg.maxPriceImpactPct) || cfg.maxPriceImpactPct < 0 || cfg.maxPriceImpactPct > 100)
  ) {
    push("maxPriceImpactPct must be between 0 and 100");
  }

  // Smart Exit
  if (mode === SmartExitMode.TIME) {
    const v = cfg.smartExitTimeMins;
    if (v == null || isNaN(v) || v < 1 || v > 1440) push("smartExitTimeMins must be 1–1440 minutes");
  } else if (mode === SmartExitMode.VOLUME) {
    const lb = cfg.smartVolLookbackSec;
    const th = cfg.smartVolThreshold;
    if (lb == null || isNaN(lb) || lb < 5 || lb > 600) push("smartVolLookbackSec must be 5–600 seconds");
    if (th == null || isNaN(th) || th < 0) push("smartVolThreshold must be ≥ 0 (quote units)");
  } else if (mode === SmartExitMode.LIQUIDITY) {
    const lb = cfg.smartLiqLookbackSec;
    const dp = cfg.smartLiqDropPct;
    if (lb == null || isNaN(lb) || lb < 5 || lb > 600) push("smartLiqLookbackSec must be 5–600 seconds");
    if (dp == null || isNaN(dp) || dp < 0 || dp > 100) push("smartLiqDropPct must be between 0 and 100");
  }

  if (errors.length) {
    const e = new Error("Invalid Turbo config");
    e.details = errors;
    throw e;
  }
  return true;
}


/* ------------------------------------------------------------------ */
/* Smart Exit enum + helpers (from "your file")                       */
/* ------------------------------------------------------------------ */
export const SmartExitMode = {
  NONE: "none",
  TIME: "time",
  VOLUME: "volume",
  LIQUIDITY: "liquidity",
};


/**
 * Normalizer for the new flat fields so downstream code receives numbers.
 */
export function normalizeTurboConfig(cfg = {}) {
  const out = { ...cfg };
  // Coerce numbers safely
  const keys = [
    "smartExitTimeMins",
    "smartVolLookbackSec",
    "smartVolThreshold",
    "smartLiqLookbackSec",
    "smartLiqDropPct",
    "minPoolUsd",
    "maxPriceImpactPct",
  ];
  for (const k of keys) {
    if (out[k] != null) out[k] = Number(out[k]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Main project validator (your existing function), now with          */
/* Smart Exit + LP Gate checks merged in (non-destructive).           */
/* ------------------------------------------------------------------ */
function validateTurboSniper(cfg = {}) {
  const errors = validateSniper(cfg);

  // ---------------------------
  // NEW: Smart Exit + LP Gate (flat fields)
  // ---------------------------
  const modeRaw = cfg.smartExitMode || "";
  const mode =
    modeRaw === "" || modeRaw === SmartExitMode.NONE
      ? SmartExitMode.NONE
      : String(modeRaw).toLowerCase();

  // LP Gate
  if (!isUnset(cfg.minPoolUsd)) {
    const v = toNum(cfg.minPoolUsd);
    if (!isNumeric(v) || v < 0) errors.push("TurboSniper: minPoolUsd must be ≥ 0");
  }
  if (!isUnset(cfg.maxPriceImpactPct)) {
    const v = toNum(cfg.maxPriceImpactPct);
    if (!isNumeric(v) || v < 0 || v > 100) {
      errors.push("TurboSniper: maxPriceImpactPct must be between 0 and 100");
    }
  }

  // Smart Exit
  if (mode === SmartExitMode.TIME) {
    const v = toNum(cfg.smartExitTimeMins);
    if (!isNumeric(v) || v < 1 || v > 1440) {
      errors.push("TurboSniper: smartExitTimeMins must be 1–1440 minutes");
    }
  } else if (mode === SmartExitMode.VOLUME) {
    const lb = toNum(cfg.smartVolLookbackSec);
    const th = toNum(cfg.smartVolThreshold);
    if (!isNumeric(lb) || lb < 5 || lb > 600) {
      errors.push("TurboSniper: smartVolLookbackSec must be 5–600 seconds");
    }
    if (!isNumeric(th) || th < 0) {
      errors.push("TurboSniper: smartVolThreshold must be ≥ 0 (quote units)");
    }
  } else if (mode === SmartExitMode.LIQUIDITY) {
    const lb = toNum(cfg.smartLiqLookbackSec);
    const dp = toNum(cfg.smartLiqDropPct);
    if (!isNumeric(lb) || lb < 5 || lb > 600) {
      errors.push("TurboSniper: smartLiqLookbackSec must be 5–600 seconds");
    }
    if (!isNumeric(dp) || dp < 0 || dp > 100) {
      errors.push("TurboSniper: smartLiqDropPct must be between 0 and 100");
    }
  }

  // ---------------------------
  // Simple boolean toggles (existing)
  // ---------------------------
  [
    "ghostMode",
    "multiBuy",
    "prewarmAccounts",
    "multiRoute",
    "autoRug",
    "useJitoBundle",
    "autoPriorityFee",
    "killSwitch",
    "poolDetection",
    "splitTrade",
    "turboMode",
    "autoRiskManage",
    "cuAdapt",
    "skipPreflight",
    "directAmmFallback",
  ].forEach((k) => {
    if (cfg[k] !== undefined && typeof cfg[k] !== "boolean") {
      errors.push(`TurboSniper: ${k} must be boolean`);
    }
  });

  // ---------------------------
  // ADDED: Support nested flags booleans (from frontend)
  // ---------------------------
  if (cfg.flags) {
    ["directAmm", "bundles", "leaderTiming", "relay", "probe"].forEach((k) => {
      if (cfg.flags[k] !== undefined && typeof cfg.flags[k] !== "boolean") {
        errors.push(`TurboSniper: flags.${k} must be boolean`);
      }
    });
  }

  // ghost-mode cover wallet requirement
  if (cfg.ghostMode === true) {
    if (!cfg.coverWalletId || typeof cfg.coverWalletId !== "string") {
      errors.push("TurboSniper: coverWalletId required when ghostMode is enabled");
    }
  }

  // multi-buy count 1–3
  if (!isUnset(cfg.multiBuyCount)) {
    if (
      !Number.isInteger(toNum(cfg.multiBuyCount)) ||
      toNum(cfg.multiBuyCount) < 1 ||
      toNum(cfg.multiBuyCount) > 3
    ) {
      errors.push("TurboSniper: multiBuyCount must be an integer between 1 and 3");
    }
  }

  // priority fee (lamports) ≥ 0
  if (!isUnset(cfg.priorityFeeLamports)) {
    if (!Number.isInteger(toNum(cfg.priorityFeeLamports)) || toNum(cfg.priorityFeeLamports) < 0) {
      errors.push("TurboSniper: priorityFeeLamports must be an integer ≥ 0");
    }
  }

  // Jito tip lamports ≥ 0
  if (!isUnset(cfg.jitoTipLamports)) {
    if (!Number.isInteger(toNum(cfg.jitoTipLamports)) || toNum(cfg.jitoTipLamports) < 0) {
      errors.push("TurboSniper: jitoTipLamports must be an integer ≥ 0");
    }
  }

  // rpcMaxErrors ≥ 1
  if (!isUnset(cfg.rpcMaxErrors)) {
    if (!Number.isInteger(toNum(cfg.rpcMaxErrors)) || toNum(cfg.rpcMaxErrors) < 1) {
      errors.push("TurboSniper: rpcMaxErrors must be an integer ≥ 1");
    }
  }

  // killThreshold ≥ 1
  if (!isUnset(cfg.killThreshold)) {
    if (!Number.isInteger(toNum(cfg.killThreshold)) || toNum(cfg.killThreshold) < 1) {
      errors.push("TurboSniper: killThreshold must be an integer ≥ 1");
    }
  }

  // trailingStopPct ≥ 0
  if (!isUnset(cfg.trailingStopPct)) {
    if (!isNumeric(cfg.trailingStopPct) || toNum(cfg.trailingStopPct) < 0) {
      errors.push("TurboSniper: trailingStopPct must be ≥ 0");
    }
  }

  // ---------------------------
  // Leader timing (enabled → require sane numbers)
  // ---------------------------
  if (cfg.leaderTiming && cfg.leaderTiming.enabled) {
    if (!(toNum(cfg.leaderTiming.preflightMs) > 0)) {
      errors.push("TurboSniper: leaderTiming.preflightMs must be > 0 when enabled");
    }
    if (!(toNum(cfg.leaderTiming.windowSlots) >= 1)) {
      errors.push("TurboSniper: leaderTiming.windowSlots must be ≥ 1 when enabled");
    }
  }

  // Quote TTL (ms) > 0
  if (!isUnset(cfg.quoteTtlMs)) {
    if (!Number.isInteger(toNum(cfg.quoteTtlMs)) || toNum(cfg.quoteTtlMs) <= 0) {
      errors.push("TurboSniper: quoteTtlMs must be a positive integer (ms)");
    }
  }

  // ---------------------------
  // ADDED: Entry/Volume thresholds (from frontend)
  // ---------------------------
  if (!isUnset(cfg.entryThreshold) && !(toNum(cfg.entryThreshold) >= 0)) {
    errors.push("TurboSniper: entryThreshold must be ≥ 0");
  }
  if (!isUnset(cfg.volumeThreshold) && !(toNum(cfg.volumeThreshold) >= 0)) {
    errors.push("TurboSniper: volumeThreshold must be ≥ 0");
  }

  // ---------------------------
  // Idempotency
  // ---------------------------
  if (cfg.idempotency) {
    const v = cfg.idempotency;
    if (!(toNum(v.ttlSec) > 0)) errors.push("TurboSniper: idempotency.ttlSec must be > 0");
    if (typeof v.salt !== "string" || !v.salt.length) {
      errors.push("TurboSniper: idempotency.salt must be a non-empty string");
    }
    if (typeof v.resumeFromLast !== "boolean") {
      errors.push("TurboSniper: idempotency.resumeFromLast must be boolean");
    }
  }
  // Legacy alias support (optional): idempotencyTtlSec
  if (!isUnset(cfg.idempotencyTtlSec)) {
    if (!Number.isInteger(toNum(cfg.idempotencyTtlSec)) || toNum(cfg.idempotencyTtlSec) <= 0) {
      errors.push("TurboSniper: idempotencyTtlSec must be a positive integer (seconds)");
    }
  }

  // ---------------------------
  // Retry policy
  // ---------------------------
  if (cfg.retryPolicy) {
    const rp = cfg.retryPolicy;
    if (!(toNum(rp.max) >= 1)) errors.push("TurboSniper: retryPolicy.max must be ≥ 1");
    if (!(toNum(rp.bumpCuStep) >= 0)) errors.push("TurboSniper: retryPolicy.bumpCuStep must be ≥ 0");
    if (!(toNum(rp.bumpTipStep) >= 0)) errors.push("TurboSniper: retryPolicy.bumpTipStep must be ≥ 0");
    if (!isUnset(rp.routeSwitch) && typeof rp.routeSwitch !== "boolean") {
      errors.push("TurboSniper: retryPolicy.routeSwitch must be boolean");
    }
    if (!isUnset(rp.rpcFailover) && typeof rp.rpcFailover !== "boolean") {
      errors.push("TurboSniper: retryPolicy.rpcFailover must be boolean");
    }
  }

  // ---------------------------
  // Parallel wallets
  // ---------------------------
  if (cfg.parallelWallets && cfg.parallelWallets.enabled) {
    const { walletIds = [], splitPct = [], maxParallel } = cfg.parallelWallets;
    if (!Array.isArray(walletIds) || walletIds.length === 0) {
      errors.push("TurboSniper: parallelWallets.walletIds must be a non-empty array when enabled");
    }
    if (!Array.isArray(splitPct) || splitPct.length !== walletIds.length) {
      errors.push("TurboSniper: parallelWallets.splitPct length must match walletIds length");
    } else {
      const sum = splitPct.reduce((a, b) => a + (Number(b) || 0), 0);
      if (Math.abs(sum - 1) > 0.05) {
        errors.push("TurboSniper: parallelWallets.splitPct values must sum to ~1.0");
      }
      splitPct.forEach((pct, i) => {
        if (!(toNum(pct) > 0)) {
          errors.push(`TurboSniper: parallelWallets.splitPct[${i}] must be > 0`);
        }
      });
    }
    if (!(toNum(maxParallel) >= 1 && toNum(maxParallel) <= walletIds.length)) {
      errors.push("TurboSniper: parallelWallets.maxParallel must be between 1 and walletIds.length");
    }
  }

  // ---------------------------
  // Pump.fun & airdrops
  // ---------------------------
  if (cfg.pumpfun && cfg.pumpfun.enabled) {
    const pf = cfg.pumpfun;
    const tp = toNum(pf.thresholdPct);
    if (!(tp >= 0 && tp <= 1)) errors.push("TurboSniper: pumpfun.thresholdPct must be between 0 and 1");
    if (!(toNum(pf.minSolLiquidity) >= 0)) errors.push("TurboSniper: pumpfun.minSolLiquidity must be ≥ 0");
    if (!(toNum(pf.cooldownSec) >= 0)) errors.push("TurboSniper: pumpfun.cooldownSec must be ≥ 0");
  }

  if (cfg.airdrops && cfg.airdrops.enabled) {
    const ad = cfg.airdrops;
    if (!(toNum(ad.minUsdValue) >= 0)) errors.push("TurboSniper: airdrops.minUsdValue must be ≥ 0");
    if (!(toNum(ad.maxSellSlippagePct) >= 0 && toNum(ad.maxSellSlippagePct) <= 100)) {
      errors.push("TurboSniper: airdrops.maxSellSlippagePct must be between 0 and 100");
    }
    if (!isUnset(ad.whitelistMints)) {
      if (!Array.isArray(ad.whitelistMints)) {
        errors.push("TurboSniper: airdrops.whitelistMints must be an array");
      } else {
        ad.whitelistMints.forEach((m, i) => {
          if (typeof m !== "string" || !m.trim()) {
            errors.push(`TurboSniper: airdrops.whitelistMints[${i}] must be a non-empty string`);
          }
        });
      }
    }
  }

  // ---------------------------
  // Private relay (bundle/tx)
  // ---------------------------
  if (cfg.privateRelay && cfg.privateRelay.enabled) {
    const pr = cfg.privateRelay;
    if (!Array.isArray(pr.urls) || pr.urls.length === 0) {
      errors.push("TurboSniper: privateRelay.urls must contain at least one URL when enabled");
    } else {
      pr.urls.forEach((u, i) => {
        if (typeof u !== "string" || !u.trim()) {
          errors.push(`TurboSniper: privateRelay.urls[${i}] must be a non-empty string`);
        }
      });
    }
    if (!isUnset(pr.mode) && !["bundle", "tx"].includes(pr.mode)) {
      errors.push('TurboSniper: privateRelay.mode must be either "bundle" or "tx"');
    }
  }

  // ---------------------------
  // Advanced sizing & probe
  // ---------------------------
  if (cfg.sizing) {
    const s = cfg.sizing;
    if (!isUnset(s.maxImpactPct) && !(toNum(s.maxImpactPct) > 0)) {
      errors.push("TurboSniper: sizing.maxImpactPct must be > 0");
    }
    if (!isUnset(s.maxPoolPct)) {
      const v = toNum(s.maxPoolPct);
      if (!(v > 0 && v <= 1)) errors.push("TurboSniper: sizing.maxPoolPct must be between 0 and 1");
    }
    if (!isUnset(s.minUsd) && !(toNum(s.minUsd) >= 0)) {
      errors.push("TurboSniper: sizing.minUsd must be ≥ 0");
    }
  }

  if (cfg.probe && cfg.probe.enabled) {
    const p = cfg.probe;
    if (!(toNum(p.usd) > 0)) errors.push("TurboSniper: probe.usd must be > 0");
    if (!(toNum(p.scaleFactor) > 1)) errors.push("TurboSniper: probe.scaleFactor must be > 1");
    if (!(toNum(p.abortOnImpactPct) > 0)) errors.push("TurboSniper: probe.abortOnImpactPct must be > 0");
    if (!(toNum(p.delayMs) >= 0)) errors.push("TurboSniper: probe.delayMs must be ≥ 0");
  }

  // ---------------------------
  // CU/tip tuning & routing prefs
  // ---------------------------
  if (!isUnset(cfg.cuPriceMicroLamportsMin) && !(toNum(cfg.cuPriceMicroLamportsMin) >= 0)) {
    errors.push("TurboSniper: cuPriceMicroLamportsMin must be ≥ 0");
  }
  if (!isUnset(cfg.cuPriceMicroLamportsMax) && !(toNum(cfg.cuPriceMicroLamportsMax) >= 0)) {
    errors.push("TurboSniper: cuPriceMicroLamportsMax must be ≥ 0");
  }
  if (!isUnset(cfg.cuPriceMicroLamportsMin) && !isUnset(cfg.cuPriceMicroLamportsMax)) {
    if (toNum(cfg.cuPriceMicroLamportsMax) < toNum(cfg.cuPriceMicroLamportsMin)) {
      errors.push("TurboSniper: cuPriceMicroLamportsMax must be ≥ cuPriceMicroLamportsMin");
    }
  }

  if (!isUnset(cfg.bundleStrategy) && !["topOfBlock", "mid", "nearEnd"].includes(cfg.bundleStrategy)) {
    errors.push("TurboSniper: bundleStrategy must be one of topOfBlock|mid|nearEnd");
  }
  if (!isUnset(cfg.tipCurve) && !["flat", "linear", "expo"].includes(cfg.tipCurve)) {
    errors.push("TurboSniper: tipCurve must be one of flat|linear|expo");
  }

  // cuPriceCurve / tipCurveCoefficients
  if (cfg.cuPriceCurve !== undefined && cfg.cuPriceCurve !== null) {
    const curve = cfg.cuPriceCurve;
    const coeffs = Array.isArray(curve) ? curve : curve && curve.coeffs;
    if (!Array.isArray(coeffs) || !coeffs.every((c) => isNumeric(c))) {
      errors.push("TurboSniper: cuPriceCurve must be an array of numbers or an object with a coeffs array");
    }
  }
  if (cfg.tipCurveCoefficients !== undefined && cfg.tipCurveCoefficients !== null) {
    const curve = cfg.tipCurveCoefficients;
    const coeffs = Array.isArray(curve) ? curve : curve && curve.coeffs;
    if (!Array.isArray(coeffs) || !coeffs.every((c) => isNumeric(c))) {
      errors.push("TurboSniper: tipCurveCoefficients must be an array of numbers or an object with a coeffs array");
    }
  }

  // allowed/excluded DEXes must be string or array if provided
  ["allowedDexes", "excludedDexes"].forEach((k) => {
    if (cfg[k] !== undefined && !Array.isArray(cfg[k]) && typeof cfg[k] !== "string") {
      errors.push(`TurboSniper: ${k} must be a comma-separated string or array`);
    }
  });

  // Direct AMM fallback % guard (0–1) if provided
  if (!isUnset(cfg.directAmmFirstPct)) {
    const v = toNum(cfg.directAmmFirstPct);
    if (!(v >= 0 && v <= 1)) {
      errors.push("TurboSniper: directAmmFirstPct must be between 0 and 1");
    }
  }

  // ---------------------------
  // Post-buy watcher / Iceberg / Impact guards
  // ---------------------------
  if (cfg.postBuyWatch) {
    const w = cfg.postBuyWatch;
    if (!isUnset(w.durationSec) && !(toNum(w.durationSec) >= 0)) {
      errors.push("TurboSniper: postBuyWatch.durationSec must be ≥ 0");
    }
    if (!isUnset(w.lpPullExit) && typeof w.lpPullExit !== "boolean") {
      errors.push("TurboSniper: postBuyWatch.lpPullExit must be boolean");
    }
    if (!isUnset(w.authorityFlipExit) && typeof w.authorityFlipExit !== "boolean") {
      errors.push("TurboSniper: postBuyWatch.authorityFlipExit must be boolean");
    }
  }

  if (cfg.iceberg) {
    const ic = cfg.iceberg;
    if (!isUnset(ic.enabled) && typeof ic.enabled !== "boolean") {
      errors.push("TurboSniper: iceberg.enabled must be boolean");
    }
    if (!isUnset(ic.tranches) && (!Number.isInteger(toNum(ic.tranches)) || toNum(ic.tranches) < 1)) {
      errors.push("TurboSniper: iceberg.tranches must be an integer ≥ 1");
    }
    if (!isUnset(ic.trancheDelayMs) && !(toNum(ic.trancheDelayMs) >= 0)) {
      errors.push("TurboSniper: iceberg.trancheDelayMs must be ≥ 0");
    }
  }

  if (!isUnset(cfg.impactAbortPct) && !(toNum(cfg.impactAbortPct) >= 0)) {
    errors.push("TurboSniper: impactAbortPct must be ≥ 0");
  }
  if (!isUnset(cfg.dynamicSlippageMaxPct) && !(toNum(cfg.dynamicSlippageMaxPct) >= 0)) {
    errors.push("TurboSniper: dynamicSlippageMaxPct must be ≥ 0");
  }

  // ---------------------------
  // Dev/Creator heuristics (nested devWatch, plus legacy top-level)
  // ---------------------------
  if (!isUnset(cfg.devWatch)) {
    const dw = cfg.devWatch;
    if (dw === null || typeof dw !== "object" || Array.isArray(dw)) {
      errors.push("TurboSniper: devWatch must be an object");
    } else {
      if (!isUnset(dw.whitelist)) {
        if (!Array.isArray(dw.whitelist)) {
          errors.push("TurboSniper: devWatch.whitelist must be an array");
        } else {
          dw.whitelist.forEach((m, i) => {
            if (typeof m !== "string" || !m.trim()) {
              errors.push(`TurboSniper: devWatch.whitelist[${i}] must be a non-empty string`);
            }
          });
        }
      }
      if (!isUnset(dw.blacklist)) {
        if (!Array.isArray(dw.blacklist)) {
          errors.push("TurboSniper: devWatch.blacklist must be an array");
        } else {
          dw.blacklist.forEach((m, i) => {
            if (typeof m !== "string" || !m.trim()) {
              errors.push(`TurboSniper: devWatch.blacklist[${i}] must be a non-empty string`);
            }
          });
        }
      }
      if (!isUnset(dw.holderTop5MaxPct)) {
        const v = toNum(dw.holderTop5MaxPct);
        if (!isNumeric(v) || v < 0 || v > 100) {
          errors.push("TurboSniper: devWatch.holderTop5MaxPct must be between 0 and 100");
        }
      }
      if (!isUnset(dw.maxHolderPercent)) {
        const v = toNum(dw.maxHolderPercent);
        if (!isNumeric(v) || v < 0 || v > 100) {
          errors.push("TurboSniper: devWatch.maxHolderPercent must be between 0 and 100");
        }
      }
      if (!isUnset(dw.lpBurnMinPct)) {
        const v = toNum(dw.lpBurnMinPct);
        if (!isNumeric(v) || v < 0 || v > 100) {
          errors.push("TurboSniper: devWatch.lpBurnMinPct must be between 0 and 100");
        }
      }
      if (!isUnset(dw.minLpBurnPercent)) {
        const v = toNum(dw.minLpBurnPercent);
        if (!isNumeric(v) || v < 0 || v > 100) {
          errors.push("TurboSniper: devWatch.minLpBurnPercent must be between 0 and 100");
        }
      }
      if (!isUnset(dw.enableInsiderHeuristics) && typeof dw.enableInsiderHeuristics !== "boolean") {
        errors.push("TurboSniper: devWatch.enableInsiderHeuristics must be boolean");
      }
    }
  }

  // Back-compat top-level toggles/thresholds (still accepted)
  if (!isUnset(cfg.enableInsiderHeuristics) && typeof cfg.enableInsiderHeuristics !== "boolean") {
    errors.push("TurboSniper: enableInsiderHeuristics must be boolean");
  }
  if (!isUnset(cfg.maxHolderPercent)) {
    const v = toNum(cfg.maxHolderPercent);
    if (!isNumeric(v) || v < 0 || v > 100) errors.push("TurboSniper: maxHolderPercent must be between 0 and 100");
  }
  if (!isUnset(cfg.requireFreezeRevoked) && typeof cfg.requireFreezeRevoked !== "boolean") {
    errors.push("TurboSniper: requireFreezeRevoked must be boolean");
  }

  // ---------------------------
  // Feeds (advanced)
  // ---------------------------
  if (!isUnset(cfg.enableLaserStream) && typeof cfg.enableLaserStream !== "boolean") {
    errors.push("TurboSniper: enableLaserStream must be boolean");
  }
  if (!isUnset(cfg.multiWallet)) {
    if (!Number.isInteger(toNum(cfg.multiWallet)) || toNum(cfg.multiWallet) < 1) {
      errors.push("TurboSniper: multiWallet must be a positive integer");
    }
  }
  if (!isUnset(cfg.alignToLeader) && typeof cfg.alignToLeader !== "boolean") {
    errors.push("TurboSniper: alignToLeader must be boolean");
  }
  if (!isUnset(cfg.riskLevels) && (typeof cfg.riskLevels !== "object" || Array.isArray(cfg.riskLevels))) {
    errors.push("TurboSniper: riskLevels must be an object if provided");
  }
  if (!isUnset(cfg.stopLossPercent)) {
    const v = toNum(cfg.stopLossPercent);
    if (!isNumeric(v) || v < 0 || v > 100) errors.push("TurboSniper: stopLossPercent must be between 0 and 100");
  }
  if (!isUnset(cfg.rugDelayBlocks)) {
    const v = toNum(cfg.rugDelayBlocks);
    if (!Number.isInteger(v) || v < 0) errors.push("TurboSniper: rugDelayBlocks must be an integer ≥ 0");
  }

  if (cfg.feeds) {
    const feeds = cfg.feeds;
    if (!isUnset(feeds.order)) {
      if (!Array.isArray(feeds.order) || feeds.order.length === 0) {
        errors.push("TurboSniper: feeds.order must be a non-empty array");
      } else {
        const allowed = ["ws", "birdeye", "onchain"];
        feeds.order.forEach((s, i) => {
          if (!allowed.includes(s)) errors.push(`TurboSniper: feeds.order[${i}] must be one of ${allowed.join(", ")}`);
        });
      }
    }
    if (!isUnset(feeds.ttlMs) && !(toNum(feeds.ttlMs) > 0)) {
      errors.push("TurboSniper: feeds.ttlMs must be positive");
    }
  }

  // ---------------------------
  // RPC endpoints / URLs (best-effort type checks)
  // ---------------------------
  if (!isUnset(cfg.rpcEndpoints)) {
    if (Array.isArray(cfg.rpcEndpoints)) {
      if (!cfg.rpcEndpoints.every((ep) => typeof ep === "string" && ep.trim())) {
        errors.push("TurboSniper: rpcEndpoints (array) must contain non-empty strings");
      }
    } else if (typeof cfg.rpcEndpoints !== "string") {
      errors.push("TurboSniper: rpcEndpoints must be a comma-separated string or array of URLs");
    }
  }
  if (!isUnset(cfg.privateRpcUrl) && typeof cfg.privateRpcUrl !== "string") {
    errors.push("TurboSniper: privateRpcUrl must be a string (URL)");
  }
  if (!isUnset(cfg.jitoRelayUrl) && typeof cfg.jitoRelayUrl !== "string") {
    errors.push("TurboSniper: jitoRelayUrl must be a string (URL)");
  }
  if (!isUnset(cfg.rpcFailover) && typeof cfg.rpcFailover !== "boolean") {
    errors.push("TurboSniper: rpcFailover must be boolean");
  }

  // ---------------------------
  // ADDED: RPC quorum + blockhash TTL (from frontend)
  // ---------------------------
  if (cfg.rpc) {
    const q = cfg.rpc.quorum || {};
    if (!(toNum(q.size) >= 1)) {
      errors.push("TurboSniper: rpc.quorum.size must be ≥ 1");
    }
    if (!(toNum(q.require) >= 1 && toNum(q.require) <= toNum(q.size))) {
      errors.push("TurboSniper: rpc.quorum.require must be between 1 and quorum.size");
    }
    if (!(toNum(cfg.rpc.blockhashTtlMs) > 0)) {
      errors.push("TurboSniper: rpc.blockhashTtlMs must be > 0");
    }
  }

  // ---------------------------
  // ADDED: DEX watch flags + pool freshness window
  // ---------------------------
  ["watchRaydium", "watchOrca", "watchMeteora", "watchStep", "watchCrema"].forEach((flag) => {
    if (!isUnset(cfg[flag]) && typeof cfg[flag] !== "boolean") {
      errors.push(`TurboSniper: ${flag} must be boolean`);
    }
  });
  if (!isUnset(cfg.poolFreshnessWindowSlots)) {
    const v = toNum(cfg.poolFreshnessWindowSlots);
    if (!Number.isInteger(v) || v <= 0) {
      errors.push("TurboSniper: poolFreshnessWindowSlots must be a positive integer");
    }
  }

  // ---------------------------
  // DEX prefs already covered above
  // ---------------------------
  if (cfg.tpLadder !== undefined && cfg.tpLadder !== null && cfg.tpLadder !== "") {
    const parts = Array.isArray(cfg.tpLadder)
      ? cfg.tpLadder
      : String(cfg.tpLadder)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    parts.forEach((p) => {
      if (!isNumeric(p) || toNum(p) < 0 || toNum(p) > 100) {
        errors.push("TurboSniper: tpLadder percentages must be numbers between 0 and 100");
      }
    });
  }

  return errors;
}






/* ---------- map of strategy → validator ------------------------------ */
const VALIDATORS = {
  sniper: validateSniper,
  scalper: validateScalper,
  breakout: validateBreakout,
  dipbuyer: validateDipBuyer,
  chadmode: validateChadMode,
  delayedsniper: validateDelayedSniper,
  trendfollower: validateTrendFollower,
  rotationbot: validateRotationBot,
  rebalancer: validateRebalancer,
  papertrader: validatePaperTrader,
  stealthBot: validateStealthBot, 
  stealthbot: validateStealthBot,
  schedulelauncher : validateScheduleLauncher,
  turboSniper: validateTurboSniper,
  turbosniper: validateTurboSniper,
};

/* ---------- main entry point ----------------------------------------- */
function validateStrategyConfig(mode = "", cfg = {}) {
  const fn = VALIDATORS[mode.toLowerCase()];
  return fn ? fn(cfg) : validateSharedConfig(cfg);
}

module.exports.default = validateTurboSniper

module.exports = {
  validateStrategyConfig,
  validateSharedConfig,
  validateScheduleLauncher, 
   validateTurboSniper,
};