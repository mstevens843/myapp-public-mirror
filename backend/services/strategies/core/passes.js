// backend/services/strategies/core/passes.js
const getTokenShortTermChange = require("../paid_api/getTokenShortTermChanges");
const { incCounter } = require("../logging/metrics");
// Import paid API heuristics
const { estimateHolderConcentration } = require('../paid_api/holderConcentration');
const { estimateLpBurnPct } = require('../paid_api/lpBurnPct');
// Import insider detector
const { insiderDetector } = require('./heuristics/insiderDetector');

/*
 * Dev/Creator Heuristics v2
 *
 * This helper runs a series of risk checks against a token mint
 * before it is purchased.  The heuristics attempt to identify
 * potential rug pulls by inspecting developer addresses, holder
 * concentration and LP burn percentages.  The checks are
 * intentionally conservative – if any threshold is breached the
 * function returns { ok: false, reason: <string> } to signal that
 * the token should be skipped.  Metrics are incremented to
 * provide visibility into how often tokens fail these heuristics.
 *
 * The `devWatch` configuration object has the following fields:
 *   whitelist: array of mints that bypass all checks
 *   blacklist: array of mints that are always rejected
 *   holderTop5MaxPct: maximum allowable percentage held by the
 *     top 5 holders (e.g. 65 means top five collectively own up
 *     to 65% of the supply)
 *   lpBurnMinPct: minimum percentage of liquidity burned.  A
 *     value below this threshold is considered suspicious.
 */
async function checkDevHeuristics(mint, devWatch) {
  const cfg = devWatch || {};
  const whitelist = Array.isArray(cfg.whitelist) ? cfg.whitelist.map((s) => String(s).toLowerCase()) : [];
  const blacklist = Array.isArray(cfg.blacklist) ? cfg.blacklist.map((s) => String(s).toLowerCase()) : [];
  // Support both legacy holderTop5MaxPct and new maxHolderPercent fields
  const holderMax = Number(cfg.holderTop5MaxPct ?? cfg.maxHolderPercent);
  // Support both legacy lpBurnMinPct and new minLpBurnPercent
  const burnMin = Number(cfg.lpBurnMinPct ?? cfg.minLpBurnPercent);
  const enableInsider = Boolean(cfg.enableInsiderHeuristics);
  const m = String(mint).toLowerCase();
  if (whitelist.includes(m)) return { ok: true };
  if (blacklist.includes(m)) {
    incCounter('devwatch_filtered_total', { reason: 'blacklist' });
    return { ok: false, reason: 'blacklist' };
  }
  // Holder concentration check using paid API adapter
  try {
    if (Number.isFinite(holderMax) && holderMax > 0) {
      const pct = await estimateHolderConcentration(mint);
      if (pct != null && pct > holderMax) {
        incCounter('holders_conc_exceeded_total', { pct });
        return { ok: false, reason: 'holder-concentration' };
      }
    }
  } catch (_) {
    // ignore errors in heuristic
  }
  // LP burn check
  try {
    if (Number.isFinite(burnMin) && burnMin > 0) {
      const pct = await estimateLpBurnPct(mint);
      if (pct != null && pct < burnMin) {
        incCounter('lp_burn_below_min_total', { pct });
        return { ok: false, reason: 'lp-burn-low' };
      }
    }
  } catch (_) {
    // ignore
  }
  // Insider detection heuristics
  if (enableInsider) {
    try {
      const ins = await insiderDetector({ mint });
      if (!ins.ok) {
        incCounter('insider_detected_total', { reason: ins.reason || 'insider' });
        return { ok: false, reason: ins.reason || 'insider' };
      }
    } catch (_) {
      // ignore errors
    }
  }
  return { ok: true };
}

// Note: placeholder heuristics have been moved to paid_api modules

const reasonMessages = {
  "pump-fail":     (pct, th, win) => `Skipped — ${win} change ${(pct * 100).toFixed(2)}% < ${(th * 100)}%`,
  "dip-fail": (pct, th, win) => `Skipped — ${win} change ${(pct*100).toFixed(2)}% > –${th}%`,
  "vol-fail":      (vol, th, win) => `Skipped — ${win} vol $${vol.toLocaleString()} < $${th.toLocaleString()}`,
  "usd-limit":     (price, lim)  => `Skipped — $${price.toFixed(4)} > $${lim}`,
  "mcap-min":      (mcap, min)   => `Skipped — mcap $${mcap.toLocaleString()} < min $${min.toLocaleString()}`,
  "mcap-max":      (mcap, max)   => `Skipped — mcap $${mcap.toLocaleString()} > max $${max.toLocaleString()}`,
  "volSpike": (vol, mult, avg) =>   `Skipped — vol $${vol.toLocaleString()} < ${mult}× avg $${avg.toLocaleString()}`,
  "overview-fail": ()            => "Skipped — overview fetch failed",
  
};

/* Translate a filter-fail reason into a readable line */
function explainFilterFail({ reason, pct, vol, price, mcap, avg }, cfg) {
  // Provide simple explanations for common filter failures.  Developer
  // heuristics are summarised generically since the detailed reason
  // (e.g. blacklist, holder-concentration) is typically logged elsewhere.
  if (reason === 'dev-fail') {
    return 'Skipped — dev/creator risk';
  }
  return (
    reason === 'pump-fail' ? reasonMessages['pump-fail'](pct, cfg.entryTh, cfg.pumpWin)       :
    reason === 'dip-fail'   ? reasonMessages['dip-fail'](pct, cfg.dipThreshold, cfg.recoveryWindow) :
    reason === 'vol-fail'      ? reasonMessages['vol-fail'](vol, cfg.volTh, cfg.volWin)           :
    reason === 'usd-limit'     ? reasonMessages['usd-limit'](price, cfg.limitUsd)                 :
    reason === 'mcap-min'      ? reasonMessages['mcap-min'](mcap, cfg.minMarketCap)               :
    reason === 'mcap-max'      ? reasonMessages['mcap-max'](mcap, cfg.maxMarketCap)               :
    reason === 'volSpike' ? reasonMessages['volSpike'](vol, cfg.volumeSpikeMult, avg) :

    reasonMessages['overview-fail']()
  );
}

/* Shared price/volume/mcap filter */
async function passes(mint, {
  entryThreshold     = 0.03,
  volumeThresholdUSD = 50000,
  pumpWindow         = "5m",
  dipThreshold,
  recoveryWindow,
  volumeWindow       = "1h",
  avgVolumeWindow    = "24h",
  volumeSpikeMult    = 2.5,
  limitUsd           = null,
  minMarketCap       = null,
  maxMarketCap       = null,
  fetchOverview,
  devWatch,
}) {
    fetchOverview = fetchOverview || getTokenShortTermChange; // ✅ safe fallback

  try {
const o = await fetchOverview(mint, recoveryWindow ?? pumpWindow, volumeWindow);
    if (!o || !o.price) return { ok: false, reason: "overview-fail" };


    const pct   = o?.priceChange || 0;
    const vol   = o?.volumeUSD   || 0;
    // const avgVol = o[`volume${avgVolumeWindow}`] || 0; // uses extras
    const mcap  = o?.marketCap   || 0;
    const price = o?.price;

    if (entryThreshold && pct < entryThreshold) return { ok: false, reason: "pump-fail", pct, overview: o };
if (vol < volumeThresholdUSD)
  return { ok: false, reason: "vol-fail", vol: Math.floor(vol), overview: o };

if (Number.isFinite(volumeSpikeMult) && volumeSpikeMult > 0 && o?.volPrevAvgUSD) {
  if (o.volumeUSD < o.volPrevAvgUSD * volumeSpikeMult) {
    return { ok:false, reason:"volSpike", vol:Math.floor(o.volumeUSD),
             avg:Math.floor(o.volPrevAvgUSD), overview:o };
  }
}


// 🔄 If DIP mode is active, reject tokens that aren't below dipThreshold
if (typeof dipThreshold === "number" && dipThreshold > 0) {
  const dipPct = -dipThreshold / 100;
  if (pct > dipPct) {
return {
  ok: false,
  reason: "dip-fail",
  pct,
  overview: o,
};
  }
}


    if (limitUsd && price > limitUsd) return { ok: false, reason: "usd-limit", price, overview: o };
    if (minMarketCap && mcap < minMarketCap) return { ok: false, reason: "mcap-min", mcap, overview: o };
    if (maxMarketCap && mcap > maxMarketCap) return { ok: false, reason: "mcap-max", mcap, overview: o };

    /* ── Dev/Creator heuristics v2 ────────────────────────── */
    if (devWatch) {
      const heur = await checkDevHeuristics(mint, devWatch);
      if (!heur.ok) {
        return { ok: false, reason: 'dev-fail', detail: heur.reason, overview: o };
      }
    }

    return { ok: true, overview: o };
  } catch (err) {
    return { ok: false, reason: "overview-fail" };
  }
}

module.exports = {
  passes,
  explainFilterFail,
};