// utils/autoNameConfig.js

function autoNameConfig(strategy, cfg = {}) {
  const parts = [];

  // Strategy label
  const title = strategy.charAt(0).toUpperCase() + strategy.slice(1);
  parts.push(title);

  // Key fields
  if (cfg.takeProfit) parts.push(`TP${cfg.takeProfit}`);
  if (cfg.stopLoss) parts.push(`SL${cfg.stopLoss}`);

  const spend = resolveAmount(cfg);
  if (spend !== "?") parts.push(`$${spend}`);

  if (cfg.interval) parts.push(`${cfg.interval}ms`);
  if (cfg.maxTrades) parts.push(`${cfg.maxTrades}x`);

  if (cfg.safetyEnabled) parts.push("🛡️");

  return parts.join(" - ");
}

// Reused unified amount resolver
function resolveAmount(cfg = {}) {
  return (
    cfg.amountToSpend ??
    cfg.snipeAmount ??
    cfg.spendAmount ??
    cfg.amount ??
    "?"
  );
}

export default autoNameConfig;
