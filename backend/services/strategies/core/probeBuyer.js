// backend/services/strategies/core/probeBuyer.js
//
// The probe buyer implements an optional two‑step acquisition strategy: a small
// “probe” purchase is executed first to evaluate live price impact. If the
// realised impact remains below a configurable threshold the strategy quickly
// scales up to the target size. Otherwise the full purchase is aborted and
// metrics are recorded accordingly. All heavy operations (execution and
// estimation) are delegated to caller‑provided functions, keeping the hot path
// lightweight.
//
// Configuration parameters:
// {
//   enabled: boolean,     // whether probing is active
//   usd: number,          // size of the probe buy in USD terms
//   scaleFactor: number,  // multiplier to derive full size from probe
//   abortOnImpactPct: number, // abort if realised impact exceeds this
//   delayMs: number       // delay between probe confirmation and scale
// }
//
// Usage:
// await performProbe({ enabled, usd, scaleFactor, abortOnImpactPct, delayMs,
//   executeBuy, estimateImpact, amount, metrics });

async function performProbe({
  enabled,
  usd,
  scaleFactor,
  abortOnImpactPct,
  delayMs,
  executeBuy,
  estimateImpact,
  amount,
  metrics,
}) {
  // If probing is not enabled then perform the full buy immediately
  if (!enabled) {
    return executeBuy(amount);
  }

  // Determine probe size: prefer explicit usd if provided, otherwise derive from
  // full amount via scale factor. Fallback to full amount if insufficient data.
  let probeSize;
  if (usd != null && usd > 0) {
    probeSize = usd;
  } else if (amount != null && scaleFactor && scaleFactor > 1) {
    probeSize = amount / scaleFactor;
  } else {
    probeSize = amount;
  }

  // Record probe sent metric
  if (metrics && typeof metrics.increment === 'function') {
    metrics.increment('probe_sent_total', 1);
  }

  // Execute the probe purchase
  const probeResult = await executeBuy(probeSize);

  // Estimate price impact after the probe. The caller is expected to update
  // whatever state the estimator uses (e.g. reloading pool reserves) before
  // calling performProbe.
  let impactPct = 0;
  if (estimateImpact && typeof estimateImpact === 'function') {
    try {
      impactPct = await estimateImpact(probeSize);
    } catch (_) {
      impactPct = 0;
    }
  }

  // Abort if the realised impact exceeds the threshold
  if (abortOnImpactPct != null && impactPct > abortOnImpactPct) {
    if (metrics && typeof metrics.increment === 'function') {
      metrics.increment('probe_abort_total', 1);
    }
    return {
      aborted: true,
      reason: `Price impact ${impactPct}% exceeds threshold ${abortOnImpactPct}%`,
      probeResult,
    };
  }

  // Wait a brief delay before scaling up. The delay allows on‑chain state and
  // price feeds to stabilise.
  const waitMs = delayMs || 0;
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  // Determine remaining size: final target is probeSize * scaleFactor. If amount
  // was provided use that as the full target to support explicit amounts.
  let fullTarget;
  if (amount != null) {
    fullTarget = amount;
  } else {
    fullTarget = probeSize * (scaleFactor || 1);
  }
  const remaining = Math.max(fullTarget - probeSize, 0);

  // Execute the scaled purchase
  const scaleResult = await executeBuy(remaining);

  if (metrics && typeof metrics.increment === 'function') {
    metrics.increment('probe_scale_success_total', 1);
  }

  return { probeResult, scaleResult };
}

module.exports = { performProbe };
