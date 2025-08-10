// backend/services/strategies/paid_api/getTokenShortTermChanges.js
// ────────────────────────────────────────────────────────────────
// Birdeye helper – now requests only the frames you need and
// falls back to longer-window volume when the target window is 0
// or missing.
//
// Usage:  getTokenShortTermChange(mint, "1m", "2h")

const { birdeyeCUCounter } = require("./birdeyeCUCounter");
const { getCache, setCache } = require("../../../lruCache");

const URL = "https://public-api.birdeye.so/defi/token_overview";

/* ── field maps ─────────────────────────────────────────────── */
const CU_COST = 30;

const pctField = {
  "1m":  "priceChange1mPercent",
  "5m":  "priceChange5mPercent",
  "15m": "priceChange15mPercent", 
  "30m": "priceChange30mPercent",
  "1h":  "priceChange1hPercent",
  "2h":  "priceChange2hPercent",
  "4h":  "priceChange4hPercent",
  "6h":  "priceChange6hPercent",
  "8h":  "priceChange8hPercent",
  "12h": "priceChange12hPercent",
  "24h": "priceChange24hPercent",
};

const volField = {
  "1m":  "v1mUSD",
  "5m":  "v5mUSD",
  "30m": "v30mUSD",
  "1h":  "v1hUSD",
  "2h":  "v2hUSD",
  "4h":  "v4hUSD",
  "8h":  "v8hUSD",
  "24h": "v24hUSD",
};

/* ── thin wrapper around Birdeye ────────────────────────────── */
async function fetchBirdeyeOverview(mint, framesCSV, userId) {
  const data = await birdeyeCUCounter({
    url: URL,
    params: { address: mint, frames: framesCSV },
    cuCost: CU_COST,
    userId,
  });

  return data?.data || {};
}

/* ── main exported helper ───────────────────────────────────── */
async function getTokenShortTermChange(
  userId = null,
  mint,
  pumpWin = "5m",
  volWin  = "1h",
) {
  const cacheKey = `${mint}:${pumpWin}:${volWin}`;
  const cached   = getCache(cacheKey);
  if (cached) return cached;

  /* Automatically ask Birdeye only for the frames we need        *
   * (plus 24 h for a universal fallback).                        */
  const frames = "1m,5m,15m,30m,1h,2h,4h,6h,8h,12h,24h";

  let d = {};
  for (let i = 0; i < 2; i++) {
    try {
      d = await fetchBirdeyeOverview(mint, frames, userId);
      break;
    } catch (err) {
      if (i === 1) {
        console.warn(`❌ Birdeye overview failed for ${mint}: ${err.message}`);
        return { price: 0, priceChange: 0, volumeUSD: 0, marketCap: 0 }; // last-ditch fallback
      }
    }
  }

  /* ── choose the correct volume field with sensible fallback ── */
  const primaryVol = d[volField[volWin]];
  const volumeUSD  = Number(
    primaryVol ??
    d.v1hUSD ??
    d.v4hUSD ??
    d.v24hUSD ??
    0,
  );

  const res = {
    /* core fields */
    price       : Number(d.price ?? 0),
    marketCap   : Number(d.marketCap ?? 0),
    priceChange : Number(d[pctField[pumpWin]] ?? 0) / 100,
    volumeUSD,
    symbol      : String(d.symbol ?? ""), 
    volPrevAvgUSD : Number(d.vHistory1hUSD ?? 0), 

    /* extras for logging / UI */
    priceChange1m  : Number(d.priceChange1mPercent  ?? 0) / 100,
    priceChange5m  : Number(d.priceChange5mPercent  ?? 0) / 100,
    priceChange15m : Number(d.priceChange15mPercent ?? 0) / 100,
    priceChange30m : Number(d.priceChange30mPercent ?? 0) / 100,
    priceChange1h  : Number(d.priceChange1hPercent  ?? 0) / 100,
    priceChange2h  : Number(d.priceChange2hPercent  ?? 0) / 100,
    priceChange4h  : Number(d.priceChange4hPercent  ?? 0) / 100,
    priceChange6h  : Number(d.priceChange6hPercent  ?? 0) / 100,
    priceChange8h  : Number(d.priceChange8hPercent  ?? 0) / 100,
    priceChange12h : Number(d.priceChange12hPercent ?? 0) / 100,
    priceChange24h : Number(d.priceChange24hPercent ?? 0) / 100,

    volume1m  : Number(d.v1mUSD  ?? 0),
    volume5m  : Number(d.v5mUSD  ?? 0),
    volume30m : Number(d.v30mUSD ?? 0),
    volume1h  : Number(d.v1hUSD  ?? 0),
    volume2h  : Number(d.v2hUSD  ?? 0),
    volume4h  : Number(d.v4hUSD  ?? 0),
    volume8h  : Number(d.v8hUSD  ?? 0),
    volume24h : Number(d.v24hUSD ?? 0),
  };

  /* cache for 60 s so multiple strategies share one quota hit */
  setCache(cacheKey, res, 60_000);
  return res;
}

module.exports = getTokenShortTermChange;
