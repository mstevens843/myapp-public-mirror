const getTokenShortTermChange = require("../paid_api/getTokenShortTermChanges");

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
  return (
    reason === "pump-fail" ? reasonMessages["pump-fail"](pct, cfg.entryTh, cfg.pumpWin)       :
    reason === "dip-fail"   ? reasonMessages["dip-fail"](pct, cfg.dipThreshold, cfg.recoveryWindow) :
    reason === "vol-fail"      ? reasonMessages["vol-fail"](vol, cfg.volTh, cfg.volWin)           :
    reason === "usd-limit"     ? reasonMessages["usd-limit"](price, cfg.limitUsd)                 :
    reason === "mcap-min"      ? reasonMessages["mcap-min"](mcap, cfg.minMarketCap)               :
    reason === "mcap-max"      ? reasonMessages["mcap-max"](mcap, cfg.maxMarketCap)               :
    reason === "volSpike" ? reasonMessages["volSpike"](vol, cfg.volumeSpikeMult, avg) :

    reasonMessages["overview-fail"]()
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

    return { ok: true, overview: o };
  } catch (err) {
    return { ok: false, reason: "overview-fail" };
  }
}

module.exports = {
  passes,
  explainFilterFail,
};
