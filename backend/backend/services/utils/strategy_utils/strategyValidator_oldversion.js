// // backend/services/utils/strategy_utils/strategyValidator.js
// // ------------------------------------------------------------
// //  Central place to validate ALL strategy configs
// // ------------------------------------------------------------

// /* ---------- helpers --------------------------------------------------- */
//  const parseMinutes = require("../math/parseMinutes");



// function isValidSolanaAddress(address = "") {
//   return /^([1-9A-HJ-NP-Za-km-z]{32,44})$/.test(address);
// }

// /** numeric string OR number */
// function isNumeric(v) {
//   return (
//     (typeof v === "number" && !isNaN(v)) ||
//     (typeof v === "string" && v.trim() !== "" && !isNaN(v))
//   );
// }

// function toNum(v) {
//   return typeof v === "string" ? Number(v) : v;
// }

// /* ---------- helper: unified amount resolver --------------------------- */
// function resolveAmount(cfg = {}) {
//   return (
//     cfg.amountToSpend ??
//     cfg.snipeAmount ??
//     cfg.spendAmount ??
//     cfg.amount
//   );
// }



// /* ---------- token-feed helper (shared) ----------------------------- */
// function validateTokenFeed(cfg = {}, label, errors) {
//   // accept only these three literals
//   if (
//     cfg.tokenFeed !== undefined &&
//     !["new", "trending", "all"].includes(cfg.tokenFeed)
//   ) {
//     errors.push(`${label}: tokenFeed must be 'new', 'trending', or 'all'`);
//   }

//   if (
//     cfg.overrideMonitored !== undefined &&
//     typeof cfg.overrideMonitored !== "boolean"
//   ) {
//     errors.push(`${label}: overrideMonitored must be boolean`);
//   }

//   if (cfg.monitoredTokens !== undefined) {
//     if (!Array.isArray(cfg.monitoredTokens)) {
//       errors.push(`${label}: monitoredTokens must be an array of mint strings`);
//     } else {
//       cfg.monitoredTokens.forEach((m) => {
//         if (!isValidSolanaAddress(m))
//           errors.push(`${label}: monitoredTokens mint ${m} is invalid`);
//       });
//     }
//   }
// }





// /* ---------- SHARED RULES (apply to EVERY strategy) -------------------- */
// function validateSharedConfig(cfg = {}) {
//   const errors = [];

//   /* —— core numeric / address checks —— */
//   if (
//     cfg.tokenMint !== undefined &&
//     cfg.tokenMint !== null &&
//     cfg.tokenMint !== ""
//   ) {
//     if (!isValidSolanaAddress(cfg.tokenMint)) {
//       errors.push("tokenMint is provided but is not a valid Solana address");
//     }
//   }

//   if (cfg.entryThreshold !== undefined) {
//     if (
//       !isNumeric(cfg.entryThreshold) ||
//       toNum(cfg.entryThreshold) <= 0 ||
//       toNum(cfg.entryThreshold) > 100
//     ) {
//       errors.push("entryThreshold must be a number between 0 and 100 %");
//     }
//   }

//    if (
//      cfg.volumeThreshold !== undefined &&
//     (!isNumeric(cfg.volumeThreshold) || toNum(cfg.volumeThreshold) < 0)
//   ) {
//      errors.push("volumeThreshold (USD) must be ≥ 0");
//    }

//   if (!isNumeric(cfg.slippage) || toNum(cfg.slippage) < 0.1 || toNum(cfg.slippage) > 5) {
//     errors.push("Slippage must be between 0.1 % and 5 %");
//   }

//   if (!isNumeric(cfg.interval) || toNum(cfg.interval) < 1 || toNum(cfg.interval) > 3600) {
//   errors.push("Scan interval must be between 1 and 3600 seconds");
// }

//   if (!isNumeric(cfg.maxRotations) || toNum(cfg.maxRotations) < 1 || toNum(cfg.maxRotations) > 20)
//     errors.push("Max rotations must be between 1 and 20");

//   /* —— unified amount check —— */
//   const amt = resolveAmount(cfg);
//   if (!isNumeric(amt) || toNum(amt) <= 0) {
//     errors.push(
//       "Amount field missing or ≤ 0 (accepted keys: amountToSpend, snipeAmount, spendAmount, amount)"
//     );
//   }

//   if (
//     cfg.takeProfit !== undefined &&
//     (!isNumeric(cfg.takeProfit) || toNum(cfg.takeProfit) < 0 || toNum(cfg.takeProfit) > 100)
//   ) {
//     errors.push("Take-profit must be between 0 % and 100 %");
//   }

//   if (
//     cfg.stopLoss !== undefined &&
//     (!isNumeric(cfg.stopLoss) || toNum(cfg.stopLoss) < 0 || toNum(cfg.stopLoss) > 100)
//   ) {
//     errors.push("Stop-loss must be between 0 % and 100 %");
//   }

//     if (
//     cfg.targetPriceUSD !== undefined &&
//     (!isNumeric(cfg.targetPriceUSD) || toNum(cfg.targetPriceUSD) <= 0)
//   ) {
//     errors.push("targetPriceUSD must be a number > 0");
//   }

//   if (
//     cfg.buyWithUSDC !== undefined &&
//     typeof cfg.buyWithUSDC !== "boolean"
//   ) {
//     errors.push("buyWithUSDC must be true or false");
//   }

//   if (
//     cfg.buyWithUSDC === true &&
//     (!isNumeric(cfg.usdcAmount) || toNum(cfg.usdcAmount) <= 0)
//   ) {
//     errors.push("usdcAmount must be a number > 0 when buyWithUSDC is true");
//   }

//   /* —— safety toggles —— */
//   if (cfg.safetyEnabled !== undefined && typeof cfg.safetyEnabled !== "boolean") {
//     errors.push("safetyEnabled must be boolean (true / false)");
//   }

//   if (cfg.safetyChecks !== undefined) {
//     if (typeof cfg.safetyChecks !== "object" || Array.isArray(cfg.safetyChecks)) {
//       errors.push("safetyChecks must be an object with boolean flags");
//     } else {
//       for (const [k, v] of Object.entries(cfg.safetyChecks)) {
//         if (typeof v !== "boolean") {
//           errors.push(`safetyChecks.${k} must be boolean`);
//         }
//       }
//     }
//   }

//   return errors;
// }

// /* ---------- STRATEGY-SPECIFIC VALIDATORS ----------------------------- */
// function validateSniper(cfg = {}) {
//   const errors = validateSharedConfig(cfg);
//   validateTokenFeed(cfg, "Sniper", errors);

//   // market-cap filters (optional)
//   if (cfg.minMarketCap !== undefined && (!isNumeric(cfg.minMarketCap) || toNum(cfg.minMarketCap) < 0))
//     errors.push("Sniper: minMarketCap must be ≥ 0 USD");
//   if (cfg.maxMarketCap !== undefined && (!isNumeric(cfg.maxMarketCap) || toNum(cfg.maxMarketCap) < 0))
//     errors.push("Sniper: maxMarketCap must be ≥ 0 USD");

//   // fail-halt & cooldown
//   if (cfg.haltOnFailures !== undefined &&
//       (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1))
//     errors.push("Sniper: haltOnFailures must be an integer ≥ 1");
//   if (cfg.cooldown !== undefined && (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0))
//     errors.push("Sniper: cooldown must be ≥ 0 seconds");

//   // min/max token age
//   if (cfg.minTokenAgeMinutes !== undefined) {
//     try { parseMinutes(cfg.minTokenAgeMinutes, { floor: 1, ceil: 1440 }); }
//     catch (e) { errors.push(`minTokenAgeMinutes ${e.message}`); }
//   }
//   if (cfg.maxTokenAgeMinutes !== undefined) {
//     try { parseMinutes(cfg.maxTokenAgeMinutes, { floor: 1, ceil: 1440 }); }
//     catch (e) { errors.push(`maxTokenAgeMinutes ${e.message}`); }
//   }

//   // // dip vs pump constraint
//   // if (cfg.dipThreshold !== undefined && cfg.entryThreshold !== undefined) {
//   //   if (toNum(cfg.dipThreshold) > 0 && toNum(cfg.entryThreshold) > 0) {
//   //     errors.push("Sniper: cannot set both dipThreshold and entryThreshold at the same time.");
//   //   }
//   // }

//   // dipThreshold (optional)
//   if (cfg.dipThreshold !== undefined && (!isNumeric(cfg.dipThreshold) || toNum(cfg.dipThreshold) < 0 || toNum(cfg.dipThreshold) > 100)) {
//     errors.push("Sniper: dipThreshold must be between 0 and 100 %");
//   }

//   // recoveryWindow (optional)
//   if (cfg.recoveryWindow !== undefined) {
//     try { parseMinutes(cfg.recoveryWindow, { floor: 1, ceil: 1440 }); }
//     catch (e) { errors.push(`recoveryWindow ${e.message}`); }
//   }

//   // delayBeforeBuyMs (optional)
//   if (cfg.delayBeforeBuyMs !== undefined && (!isNumeric(cfg.delayBeforeBuyMs) || toNum(cfg.delayBeforeBuyMs) < 0))
//     errors.push("Sniper: delayBeforeBuyMs must be ≥ 0 ms");

//   // priorityFeeLamports (optional)
//   if (cfg.priorityFeeLamports !== undefined &&
//       (!Number.isInteger(toNum(cfg.priorityFeeLamports)) || toNum(cfg.priorityFeeLamports) < 0))
//     errors.push("Sniper: priorityFeeLamports must be an integer ≥ 0");

//   // maxSlippage (optional)a
//   if (cfg.maxSlippage !== undefined &&
//       (!isNumeric(cfg.maxSlippage) || toNum(cfg.maxSlippage) < 0 || toNum(cfg.maxSlippage) > 10))
//     errors.push("Sniper: maxSlippage must be between 0 % and 10 %");

//   return errors;
// }






// function validateScalper(cfg = {}) {
//   const errors = validateSharedConfig(cfg);
//   validateTokenFeed(cfg, "Scalper", errors);

//   if (
//     !isNumeric(cfg.entryThreshold) ||
//     toNum(cfg.entryThreshold) <= 0 ||
//     toNum(cfg.entryThreshold) > 10   // scalpers use small %
//   ) {
//     errors.push("Scalper: entryThreshold must be between 0 and 10 %");
//   }

//   if (
//     cfg.volumeThreshold !== undefined &&
//     (!isNumeric(cfg.volumeThreshold) || toNum(cfg.volumeThreshold) < 0)
//   ) {
//     errors.push("Scalper: volumeThreshold (USD) must be ≥ 0");
//   }

//   /* OPTIONAL market-cap filters */
//   if (
//     cfg.minMarketCap !== undefined &&
//     (!isNumeric(cfg.minMarketCap) || toNum(cfg.minMarketCap) < 0)
//   ) errors.push("Scalper: minMarketCap must be ≥ 0 USD");

//   if (
//     cfg.maxMarketCap !== undefined &&
//     (!isNumeric(cfg.maxMarketCap) || toNum(cfg.maxMarketCap) < 0)
//   ) errors.push("Scalper: maxMarketCap must be ≥ 0 USD");



//   /* volumeSpikeMultiplier (≥ 1) */
//   if (
//     cfg.volumeSpikeMultiplier !== undefined &&
//     (!isNumeric(cfg.volumeSpikeMultiplier) || toNum(cfg.volumeSpikeMultiplier) < 1)
//   ) {
//     errors.push("Breakout: volumeSpikeMultiplier must be ≥ 1");
//   }

//   /* OPTIONAL halt / cooldown */
//   if (
//     cfg.haltOnFailures !== undefined &&
//     (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1)
//   ) errors.push("Scalper: haltOnFailures must be an integer ≥ 1");

//   if (
//     cfg.cooldown !== undefined &&
//     (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
//   ) errors.push("Scalper: cooldown must be ≥ 0 ms");

//   return errors;
// }



// /* ───── Paper Trader ────────────────────────────────────────────────── */
// function validatePaperTrader(cfg = {}) {
//   const errors = validateSharedConfig(cfg);
//   validateTokenFeed(cfg, "PaperTrader", errors);
//   // entry % (0–100)
//   if (
//     cfg.entryThreshold !== undefined &&
//     (!isNumeric(cfg.entryThreshold) ||
//       toNum(cfg.entryThreshold) <= 0 ||
//       toNum(cfg.entryThreshold) > 100)
//   ) {
//     errors.push("PaperTrader: entryThreshold must be between 0 and 100 %");
//   }

//   // 1-hour volume gate
//   if (
//     cfg.volumeThreshold !== undefined &&
//     (!isNumeric(cfg.volumeThreshold) || toNum(cfg.volumeThreshold) < 0)
//   ) {
//     errors.push("PaperTrader: volumeThreshold (USD) must be ≥ 0");
//   }

//   // daily trade cap
//   if (
//     cfg.maxDailyTrades !== undefined &&
//     (!Number.isInteger(toNum(cfg.maxDailyTrades)) ||
//       toNum(cfg.maxDailyTrades) < 1)
//   ) {
//     errors.push("PaperTrader: maxDailyTrades must be an integer ≥ 1");
//   }

//   // cooldown ≥ 0 ms
//   if (
//     cfg.cooldown !== undefined &&
//     (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
//   ) {
//     errors.push("PaperTrader: cooldown must be ≥ 0 ms");
//   }

//   return errors;
// }

// /* ───── Breakout ─────────────────────────────────────────────────────── */
// function validateBreakout(cfg = {}) {
// const errors = validateSharedConfig(cfg);
// validateTokenFeed(cfg, "Breakout", errors);
//   /* breakoutThreshold (positive %) */
//   if (
//     !isNumeric(cfg.breakoutThreshold) ||
//     toNum(cfg.breakoutThreshold) <= 0 ||
//     toNum(cfg.breakoutThreshold) > 100
//   ) {
//     errors.push("Breakout: breakoutThreshold must be between 0 and 100 %");
//   }

//   /* minLiquidity (USD) – optional */
//   if (
//     cfg.minLiquidity !== undefined &&
//     (!isNumeric(cfg.minLiquidity) || toNum(cfg.minLiquidity) < 0)
//   ) {
//     errors.push("Breakout: minLiquidity (USD) must be ≥ 0");
//   }

//   /* volumeSpikeMultiplier (≥ 1) */
//   if (
//     cfg.volumeSpikeMultiplier !== undefined &&
//     (!isNumeric(cfg.volumeSpikeMultiplier) || toNum(cfg.volumeSpikeMultiplier) < 1)
//   ) {
//     errors.push("Breakout: volumeSpikeMultiplier must be ≥ 1");
//   }

//   /* OPTIONAL market-cap filters */
//   if (
//     cfg.minMarketCap !== undefined &&
//     (!isNumeric(cfg.minMarketCap) || toNum(cfg.minMarketCap) < 0)
//   ) {
//     errors.push("Breakout: minMarketCap must be ≥ 0 USD");
//   }
//   if (
//     cfg.maxMarketCap !== undefined &&
//     (!isNumeric(cfg.maxMarketCap) || toNum(cfg.maxMarketCap) < 0)
//   ) {
//     errors.push("Breakout: maxMarketCap must be ≥ 0 USD");
//   }

//   /* OPTIONAL fail-halt + cooldown */
//   if (
//     cfg.haltOnFailures !== undefined &&
//     (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1)
//   ) {
//     errors.push("Breakout: haltOnFailures must be an integer ≥ 1");
//   }
//   if (
//     cfg.cooldown !== undefined &&
//     (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
//   ) {
//     errors.push("Breakout: cooldown must be ≥ 0 ms");
//   }

  

//   return errors;
// }

// /* ───── Chad Mode ───────────────────────────────────────────────── */
// function validateChadMode (cfg = {}) {
//   const errors = validateSharedConfig(cfg);


//   if (!cfg.outputMint)
//     errors.push("ChadMode: outputMint is mandatory");


//   /* spend-per-trade  */
//   const spend = cfg.maxSpendPerToken;
//   if (!isNumeric(cfg.amountToSpend) || toNum(cfg.amountToSpend) <= 0)
//   errors.push("ChadMode: amountToSpend must be > 0 SOL");

//   /* liquidity filter (optional) */
//   const minVol = cfg.minVolumeRequired ?? cfg.minVolume;
//   if (minVol !== undefined &&
//       (!isNumeric(minVol) || toNum(minVol) < 0))
//     errors.push("ChadMode: minVolumeRequired (USD) must be ≥ 0");

//   /* priority-fee sanity */
//   if (cfg.priorityFeeLamports !== undefined &&
//       (!Number.isInteger(toNum(cfg.priorityFeeLamports)) ||
//        toNum(cfg.priorityFeeLamports) < 0))
//     errors.push("ChadMode: priorityFeeLamports must be an integer ≥ 0");

//   /* auto-sell block (if provided) */
//   if (cfg.autoSell !== undefined && typeof cfg.autoSell !== "object")
//     errors.push("ChadMode: autoSell must be an object with { enabled, delay, … }");

//   if (cfg.autoSell?.randomDelayRange) {
//     const [min,max] = cfg.autoSell.randomDelayRange;
//     if (!isNumeric(min) || !isNumeric(max) || min < 0 || max < min)
//       errors.push("ChadMode: autoSell.randomDelayRange must be [min,max] with min ≥ 0 ≤ max");
//   }

//   /* panic-dump % */
// if (cfg.panicDumpPct !== undefined &&
//     (!isNumeric(cfg.panicDumpPct) || toNum(cfg.panicDumpPct) <= 0))
//   errors.push("ChadMode: panicDumpPct must be > 0");

// /* slippage / fee escalation */
// if (cfg.slippageMaxPct !== undefined &&
//     (!isNumeric(cfg.slippageMaxPct) || toNum(cfg.slippageMaxPct) <= 0))
//   errors.push("ChadMode: slippageMaxPct must be > 0");

// if (cfg.feeEscalationLamports !== undefined &&
//     (!Number.isInteger(toNum(cfg.feeEscalationLamports)) || toNum(cfg.feeEscalationLamports) < 0))
//   errors.push("ChadMode: feeEscalationLamports must be an integer ≥ 0");

//   return errors;
// }

// /* ───── Delayed Sniper ─────────────────────────────────────────────── */
// function validateDelayedSniper(cfg = {}) {
//   const errors = validateSharedConfig(cfg);
//   validateTokenFeed(cfg, "DelayedSniper", errors);
//   // delay in ms > 0
//   if (!isNumeric(cfg.delayMs) || toNum(cfg.delayMs) < 1)
//     errors.push("DelayedSniper: delayMs must be > 0 ms");

//   // scan interval > 0
//   if (
//     cfg.scanInterval !== undefined &&
//     (!isNumeric(cfg.scanInterval) || toNum(cfg.scanInterval) < 1)
//   )
//     errors.push("DelayedSniper: scanInterval must be > 0 ms");

//   // entryThreshold 0-100 %
//   if (
//     cfg.entryThreshold !== undefined &&
//     (!isNumeric(cfg.entryThreshold) ||
//       toNum(cfg.entryThreshold) <= 0 ||
//       toNum(cfg.entryThreshold) > 100)
//   )
//     errors.push("DelayedSniper: entryThreshold must be between 0 and 100 %");

//   // volume USD ≥ 0
//   if (
//     cfg.volumeThreshold !== undefined &&
//     (!isNumeric(cfg.volumeThreshold) || toNum(cfg.volumeThreshold) < 0)
//   )
//     errors.push("DelayedSniper: volumeThreshold (USD) must be ≥ 0");

// // optional market-cap guards
// if (cfg.minMarketCap !== undefined && (!isNumeric(cfg.minMarketCap) || toNum(cfg.minMarketCap) < 0))
//   errors.push("DelayedSniper: minMarketCap must be ≥ 0 USD");
// if (cfg.maxMarketCap !== undefined && (!isNumeric(cfg.maxMarketCap) || toNum(cfg.maxMarketCap) < 0))
//   errors.push("DelayedSniper: maxMarketCap must be ≥ 0 USD");
// // optional fail-halt
// if (cfg.haltOnFailures !== undefined &&
//     (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1))
//   errors.push("DelayedSniper: haltOnFailures must be an integer ≥ 1");

// // optional cooldown
// if (cfg.cooldown !== undefined && (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0))
//   errors.push("DelayedSniper: cooldown must be ≥ 0 seconds");
//   return errors;
// }


// /* ───── Dip Buyer ────────────────────────────────────────────────────── */
// function validateDipBuyer(cfg = {}) {
//   const errors = validateSharedConfig(cfg);
//   validateTokenFeed(cfg, "DipBuyer", errors);
//   // positive % 1-99
//   if (
//     !isNumeric(cfg.dipThreshold) ||
//     toNum(cfg.dipThreshold) <= 0 ||
//     toNum(cfg.dipThreshold) > 99
//   ) {
//     errors.push("DipBuyer: dipThreshold must be between 1 and 99 %");
//   }

//   // volume (USD)
//   if (
//     cfg.volumeThreshold !== undefined &&
//     (!isNumeric(cfg.volumeThreshold) || toNum(cfg.volumeThreshold) < 0)
//   ) {
//     errors.push("DipBuyer: volumeThreshold (USD) must be ≥ 0");
//   }

//   // OPTIONAL market-cap filters
//   if (
//     cfg.minMarketCap !== undefined &&
//     (!isNumeric(cfg.minMarketCap) || toNum(cfg.minMarketCap) < 0)
//   ) {
//     errors.push("DipBuyer: minMarketCap must be ≥ 0 USD");
//   }
//   if (
//     cfg.maxMarketCap !== undefined &&
//     (!isNumeric(cfg.maxMarketCap) || toNum(cfg.maxMarketCap) < 0)
//   ) {
//     errors.push("DipBuyer: maxMarketCap must be ≥ 0 USD");
//   }

//   // OPTIONAL fail-halt + cooldown
//   if (
//     cfg.haltOnFailures !== undefined &&
//     (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1)
//   ) {
//     errors.push("DipBuyer: haltOnFailures must be an integer ≥ 1");
//   }
//   if (
//     cfg.cooldown !== undefined &&
//     (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
//   ) {
//     errors.push("DipBuyer: cooldown must be ≥ 0 ms");
//   }


//   // maxSlippage 0-5 %
//   // if (
//   //   cfg.maxSlippage !== undefined &&
//   //   (!isNumeric(cfg.maxSlippage) ||
//   //     toNum(cfg.maxSlippage) < 0 ||
//   //     toNum(cfg.maxSlippage) > 5)
//   // ) {
//   //   errors.push("DipBuyer: maxSlippage must be between 0 % and 5 %");
//   // }

//   // maxOpenTrades ≥ 1
//   if (
//     cfg.maxOpenTrades !== undefined &&
//     (!Number.isInteger(toNum(cfg.maxOpenTrades)) ||
//       toNum(cfg.maxOpenTrades) < 1)
//   ) {
//     errors.push("DipBuyer: maxOpenTrades must be an integer ≥ 1");
//   }

//   return errors;
// }


// /* ───── Rebalancer ─────────────────────────────────────────────────── */
// function validateRebalancer(cfg = {}) {
//   const errors = validateSharedConfig(cfg);

//   /* targetAllocations required */
//   const tgt = cfg.targetAllocations ?? cfg.targetWeights;
//   if (!tgt || typeof tgt !== "object" || !Object.keys(tgt).length)
//     errors.push("Rebalancer: targetAllocations object is required");

//   let thresh = toNum(cfg.rebalanceThreshold);
//   // default if user left it blank
//   if (!isNumeric(thresh)) {
//     thresh = 2;
//   }
//   if (thresh < 0) {
//     errors.push("Rebalancer: rebalanceThreshold must be ≥ 0 %");
//   } else {
//     // 0 = interpreted as "always rebalance"
//     cfg.rebalanceThreshold = thresh === 0 ? 0.0001 : thresh;
//   }

//   if (!isNumeric(cfg.minTradeSize) || toNum(cfg.minTradeSize) <= 0) {
//     errors.push("Rebalancer: minTradeSize must be > 0 SOL");
//   }

//   if (cfg.priorityFeeLamports !== undefined &&
//     (!Number.isInteger(toNum(cfg.priorityFeeLamports)) ||
//      toNum(cfg.priorityFeeLamports) < 0))
//   errors.push("Rebalancer: priorityFeeLamports must be an integer ≥ 0");

// if (cfg.skipSafety !== undefined && typeof cfg.skipSafety !== "boolean")
//   errors.push("Rebalancer: skipSafety must be true/false");

//   /* Accept either targetAllocations or legacy targetWeights */
//   const weights = cfg.targetAllocations ?? cfg.targetWeights;
//   if (!weights || typeof weights !== "object") {
//     errors.push("Rebalancer: targetAllocations object is required");
//   } else {
//     for (const [mint, weight] of Object.entries(weights)) {
//       if (!isValidSolanaAddress(mint)) {
//         errors.push(`Rebalancer: ${mint} is not a valid mint`);
//       }
//       if (!isNumeric(weight) || toNum(weight) <= 0) {
//         errors.push(`Rebalancer: weight for ${mint.slice(0,4)}… must be > 0`);
//       }
//     }
//   }

//   return errors;
// }

// /* ───── Rotation Bot ─────────────────────────────────────────────────── */
// function validateRotationBot(cfg = {}) {
//   const errors = validateSharedConfig(cfg);
//   validateTokenFeed(cfg, "RotationBot", errors);
//   /* wallets (optional) */
//  // Flatten tokens from bundles if tokens[] is empty
//   let allTokens = Array.isArray(cfg.tokens) ? [...cfg.tokens] : [];

//   if (Array.isArray(cfg.bundles)) {
//     for (const bundle of cfg.bundles) {
//       if (Array.isArray(bundle.tokens)) {
//         allTokens.push(...bundle.tokens);
//       }
//     }
//   }

//   // Require at least 1 token (from tokens[] or bundles[])
//   if (!allTokens.length && !(cfg.sectors && Object.values(cfg.sectors).length)) {
//     errors.push("RotationBot: tokens list cannot be empty");
//   }

//   // Validate each token
//   for (const mint of allTokens) {
//     if (!isValidSolanaAddress(mint)) {
//       errors.push(`RotationBot: token mint ${mint} is invalid`);
//     }
//   }

//   return errors;
// }
//   /* rotation interval > 0 ms */
//   if (
//     cfg.rotationInterval !== undefined &&
//     (!isNumeric(cfg.rotationInterval) || toNum(cfg.rotationInterval) <= 0)
//   )
//     errors.push("RotationBot: rotationInterval must be a number > 0 ms");

//   /* momentum & volume gates */
//   if (
//     cfg.minMomentum !== undefined &&
//     (!isNumeric(cfg.minMomentum) ||
//       toNum(cfg.minMomentum) <= 0 ||
//       toNum(cfg.minMomentum) > 100)
//   )
//     errors.push("RotationBot: minMomentum must be between 0 and 100 %");

//   if (
//     cfg.volumeThreshold !== undefined &&
//     (!isNumeric(cfg.volumeThreshold) || toNum(cfg.volumeThreshold) < 0)
//   )
//     errors.push("RotationBot: volumeThreshold (USD) must be ≥ 0");

//   /* optional cooldown / fails */
//   if (
//     cfg.cooldown !== undefined &&
//     (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0)
//   )
//     errors.push("RotationBot: cooldown must be ≥ 0 ms");

//   if (
//     cfg.haltOnFailures !== undefined &&
//     (!Number.isInteger(toNum(cfg.haltOnFailures)) ||
//       toNum(cfg.haltOnFailures) < 1)
//   )
//     errors.push("RotationBot: haltOnFailures must be an integer ≥ 1");

//   return errors;
// }

// /* ───── Trend Follower ─────────────────────────────────────────────── */
// /* ───── Trend Follower ─────────────────────────────────────────────── */
// function validateTrendFollower(cfg = {}) {
//   const errors = validateSharedConfig(cfg);
//   validateTokenFeed(cfg, "Trendfollower", errors);

//   // market-cap filters (optional)
//   if (cfg.minMarketCap !== undefined && (!isNumeric(cfg.minMarketCap) || toNum(cfg.minMarketCap) < 0))
//     errors.push("Trendfollower: minMarketCap must be ≥ 0 USD");
//   if (cfg.maxMarketCap !== undefined && (!isNumeric(cfg.maxMarketCap) || toNum(cfg.maxMarketCap) < 0))
//     errors.push("Trendfollower: maxMarketCap must be ≥ 0 USD");

//   // fail-halt & cooldown
//   if (cfg.haltOnFailures !== undefined &&
//       (!Number.isInteger(toNum(cfg.haltOnFailures)) || toNum(cfg.haltOnFailures) < 1))
//     errors.push("Trendfollower: haltOnFailures must be an integer ≥ 1");
//   if (cfg.cooldown !== undefined && (!isNumeric(cfg.cooldown) || toNum(cfg.cooldown) < 0))
//     errors.push("Trendfollower: cooldown must be ≥ 0 seconds");

//   // min/max token age
//   if (cfg.minTokenAgeMinutes !== undefined) {
//     try { parseMinutes(cfg.minTokenAgeMinutes, { floor: 1, ceil: 1440 }); }
//     catch (e) { errors.push(`Trendfollower: minTokenAgeMinutes ${e.message}`); }
//   }
//   if (cfg.maxTokenAgeMinutes !== undefined) {
//     try { parseMinutes(cfg.maxTokenAgeMinutes, { floor: 1, ceil: 1440 }); }
//     catch (e) { errors.push(`Trendfollower: maxTokenAgeMinutes ${e.message}`); }
//   }

//   // dip vs pump constraint
//   if (cfg.dipThreshold !== undefined && cfg.entryThreshold !== undefined) {
//     if (toNum(cfg.dipThreshold) > 0 && toNum(cfg.entryThreshold) > 0) {
//       errors.push("Trendfollower: cannot set both dipThreshold and entryThreshold at the same time.");
//     }
//   }

//   // delayBeforeBuyMs (optional)
//   if (cfg.delayBeforeBuyMs !== undefined && (!isNumeric(cfg.delayBeforeBuyMs) || toNum(cfg.delayBeforeBuyMs) < 0))
//     errors.push("Trendfollower: delayBeforeBuyMs must be ≥ 0 ms");

//   // priorityFeeLamports (optional)
//   if (cfg.priorityFeeLamports !== undefined &&
//       (!Number.isInteger(toNum(cfg.priorityFeeLamports)) || toNum(cfg.priorityFeeLamports) < 0))
//     errors.push("Trendfollower: priorityFeeLamports must be an integer ≥ 0");

//   // maxSlippage (optional)
//   if (cfg.maxSlippage !== undefined &&
//       (!isNumeric(cfg.maxSlippage) || toNum(cfg.maxSlippage) < 0 || toNum(cfg.maxSlippage) > 10))
//     errors.push("Trendfollower: maxSlippage must be between 0 % and 10 %");

//   return errors;
// }
// /* ---------- map of strategy → validator ------------------------------ */
// const VALIDATORS = {
//   sniper        : validateSniper,
//   scalper       : validateScalper,
//   breakout      : validateBreakout,
//   dipbuyer      : validateDipBuyer,
//   chadmode      : validateChadMode,
//   delayedsniper : validateDelayedSniper,
//   trendfollower : validateTrendFollower,
//   rotationbot   : validateRotationBot,
//   rebalancer    : validateRebalancer,
//   papertrader   : validatePaperTrader,
// };

// /* ---------- main entry point ----------------------------------------- */
// function validateStrategyConfig(mode = "", cfg = {}) {
//   const fn = VALIDATORS[mode.toLowerCase()];
//   return fn ? fn(cfg) : validateSharedConfig(cfg);
// }

// module.exports = {
//   validateStrategyConfig,
//   validateSharedConfig,
// };
