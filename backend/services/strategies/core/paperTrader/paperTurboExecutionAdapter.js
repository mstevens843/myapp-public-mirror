// backend/services/strategies/core/paperTrader/paperTurboExecutionAdapter.js
// Thin wrapper over paperExecutionAdapter with Turbo-friendly defaults.

const { executePaperTrade } = require("../paperTrader/paperExecutionAdapter");

module.exports.executePaperTradeTurbo = async ({ quote, mint, meta, config = {} }) => {
  const turboDefaults = {
    latency: { quoteMs: 20, buildMs: 8, sendMs: 15, landMs: 350 },
    partials: { minParts: 1, maxParts: 2 },
    slippageBpsCap: 120, // 1.2%
    failureRates: { blockhashNotFound: 0.00, accountInUse: 0.00, slippageExceeded: 0.02, bundleNotLanded: 0.00 },
  };
  return executePaperTrade({ quote, mint, meta, config: { ...turboDefaults, ...config } });
};