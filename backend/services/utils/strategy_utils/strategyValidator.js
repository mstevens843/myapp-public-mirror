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

/* ───── Turbo Sniper ─────────────────────────────────────────────── */
/**
 * Validate Turbo Sniper configs.  Builds on the base Sniper validator and
 * enforces bounds on the additional turbo settings (e.g. multi-buy count,
 * RPC failover, kill switch).  Boolean flags must be boolean when
 * provided; numeric parameters are coerced and checked for sane ranges.
 */
function validateTurboSniper(cfg = {}) {
  const errors = validateSniper(cfg);

  // boolean toggles
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
  ].forEach((k) => {
    if (cfg[k] !== undefined && typeof cfg[k] !== "boolean") {
      errors.push(`TurboSniper: ${k} must be boolean`);
    }
  });

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

  // Jito tip lamports ≥ 0
  if (!isUnset(cfg.jitoTipLamports)) {
    if (
      !Number.isInteger(toNum(cfg.jitoTipLamports)) ||
      toNum(cfg.jitoTipLamports) < 0
    ) {
      errors.push("TurboSniper: jitoTipLamports must be an integer ≥ 0");
    }
  }

  // rpcMaxErrors ≥ 1
  if (!isUnset(cfg.rpcMaxErrors)) {
    if (
      !Number.isInteger(toNum(cfg.rpcMaxErrors)) ||
      toNum(cfg.rpcMaxErrors) < 1
    ) {
      errors.push("TurboSniper: rpcMaxErrors must be an integer ≥ 1");
    }
  }

  // killThreshold ≥ 1
  if (!isUnset(cfg.killThreshold)) {
    if (
      !Number.isInteger(toNum(cfg.killThreshold)) ||
      toNum(cfg.killThreshold) < 1
    ) {
      errors.push("TurboSniper: killThreshold must be an integer ≥ 1");
    }
  }

  // trailingStopPct ≥ 0
  if (!isUnset(cfg.trailingStopPct)) {
    if (!isNumeric(cfg.trailingStopPct) || toNum(cfg.trailingStopPct) < 0) {
      errors.push("TurboSniper: trailingStopPct must be ≥ 0");
    }
  }

  // allowed/excluded DEXes must be string or array if provided
  ["allowedDexes", "excludedDexes"].forEach((k) => {
    if (
      cfg[k] !== undefined &&
      !Array.isArray(cfg[k]) &&
      typeof cfg[k] !== "string"
    ) {
      errors.push(`TurboSniper: ${k} must be a comma-separated string or array`);
    }
  });

  // tpLadder percentages between 0 and 100
  if (cfg.tpLadder !== undefined && cfg.tpLadder !== null && cfg.tpLadder !== "") {
    const parts = Array.isArray(cfg.tpLadder)
      ? cfg.tpLadder
      : String(cfg.tpLadder)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    parts.forEach((p) => {
      if (!isNumeric(p) || toNum(p) < 0 || toNum(p) > 100) {
        errors.push(
          "TurboSniper: tpLadder percentages must be numbers between 0 and 100"
        );
      }
    });
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

module.exports = {
  validateStrategyConfig,
  validateSharedConfig,
  validateScheduleLauncher, 
};