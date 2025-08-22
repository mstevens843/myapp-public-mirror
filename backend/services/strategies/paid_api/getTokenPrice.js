// services/strategies/paid_api/getTokenPrice.js
// Liquidity-aware Birdeye helper that keeps old API intact
// - getTokenPrice(userId, mint)                  // unchanged
// - getSolPrice(userId)
// - getPriceAndLiquidity(userId, mint)
// - getPricesWithLiquidityBatch(userId, mints)   // batched, includes liquidity/updateUnixTime
// - isTokenLiquid(userId, mint, {minLiquidityUsd, maxStalenessSec})
//
// Uses only: /defi/multi_price  (with include_liquidity=true when needed)

require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });
const { birdeyeCUCounter } = require("./birdeyeCUCounter");
const CU_TABLE = require("./cuTable");

const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BIRDEYE   = "https://public-api.birdeye.so/defi/multi_price";

const PRICE_TTL_MS = 30_000;       // price cache
const META_TTL_MS  = 60_000;       // liquidity/metadata cache
const MIN_LIQUIDITY_USD_DEFAULT = Number(process.env.MIN_LIQUIDITY_USD || 1000);
const MAX_PRICE_STALENESS_SEC   = Number(process.env.MAX_PRICE_STALENESS_SEC || 6 * 3600);

const priceCache = new Map(); // mint -> { ts, price }
const metaCache  = new Map(); // mint -> { ts, price, liquidity, updateUnixTime, priceChange24h }

function _num(x, d=0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

/* ----------------------------------------------------- */
/*  internal: fetch quotes for 1..N mints in one request */
/* ----------------------------------------------------- */
async function fetchQuotes(mints, userId = null, { includeLiquidity = false, checkLiquidity = null } = {}) {
  const mintsClean = (mints || []).filter(Boolean);
  if (!mintsClean.length) return {};

  const params = {
    list_address: mintsClean.join(","),
    ui_amount_mode: "raw",
  };
  if (includeLiquidity) params.include_liquidity = true;
  if (checkLiquidity != null) params.check_liquidity = checkLiquidity;

  const data = await birdeyeCUCounter({
    url: BIRDEYE,
    params,
    cuCost: CU_TABLE["/defi/multi_price"],
    userId,
  });

  if (!data?.success) throw new Error("Birdeye multi_price not OK");

  // Normalize: mint -> { price, liquidity?, updateUnixTime?, priceChange24h? }
  const out = {};
  for (const mint of mintsClean) {
    const row = data.data?.[mint];
    if (!row) continue;
    const price = _num(row.value, 0);
    out[mint] = {
      price: price || 0,
      liquidity: includeLiquidity ? _num(row.liquidity, 0) : undefined,
      updateUnixTime: _num(row.updateUnixTime, 0) || undefined,
      priceChange24h: row.priceChange24h != null ? _num(row.priceChange24h, 0) : undefined,
    };
  }

  return out;
}

/* ----------------------- public API ------------------ */
async function getTokenPrice(userId = null, mint) {
  if (!mint) return 0;
  if (mint === USDC_MINT) return 1;

  const hit = priceCache.get(mint);
  if (hit && Date.now() - hit.ts < PRICE_TTL_MS) return hit.price;

  try {
    const quotes = await fetchQuotes([mint], userId, { includeLiquidity: false });
    const price = quotes[mint]?.price || 0;
    priceCache.set(mint, { ts: Date.now(), price });
    return price;
  } catch (err) {
    console.warn(`❌ Birdeye price error for ${mint}:`, err.message);
    return 0;
  }
}

/* price + liquidity for a single mint (cached briefly) */
async function getPriceAndLiquidity(userId = null, mint) {
  if (!mint) return { price: 0, liquidity: 0, updateUnixTime: 0, priceChange24h: 0 };
  if (mint === USDC_MINT) return { price: 1, liquidity: 1e12, updateUnixTime: Math.floor(Date.now()/1000), priceChange24h: 0 };

  const hit = metaCache.get(mint);
  if (hit && Date.now() - hit.ts < META_TTL_MS) return { ...hit };

  try {
    const quotes = await fetchQuotes([mint], userId, { includeLiquidity: true });
    const q = quotes[mint] || { price: 0, liquidity: 0, updateUnixTime: 0, priceChange24h: 0 };
    const rec = { ts: Date.now(), ...q };
    metaCache.set(mint, rec);
    return { ...rec };
  } catch (err) {
    console.warn(`❌ Birdeye price+liq error for ${mint}:`, err.message);
    return { price: 0, liquidity: 0, updateUnixTime: 0, priceChange24h: 0 };
  }
}

/* batch price + liquidity for many mints (best CU/latency) */
async function getPricesWithLiquidityBatch(userId = null, mints = []) {
  const CHUNK = 100;
  const need = [];
  const out  = {};

  // hit cache first
  for (const mint of mints) {
    const hit = metaCache.get(mint);
    if (hit && Date.now() - hit.ts < META_TTL_MS) {
      out[mint] = { ...hit };
    } else {
      need.push(mint);
    }
  }

  // chunk the rest
  for (let i = 0; i < need.length; i += CHUNK) {
    const slice = need.slice(i, i + CHUNK);
    try {
      const quotes = await fetchQuotes(slice, userId, { includeLiquidity: true });
      for (const mint of slice) {
        const q = quotes[mint] || { price: 0, liquidity: 0, updateUnixTime: 0, priceChange24h: 0 };
        const rec = { ts: Date.now(), ...q };
        metaCache.set(mint, rec);
        out[mint] = { ...rec };
      }
    } catch (err) {
      console.warn(`❌ Birdeye batch price+liq error:`, err.message);
      for (const mint of slice) out[mint] = { price: 0, liquidity: 0, updateUnixTime: 0, priceChange24h: 0 };
    }
  }

  return out; // { mint: { ts, price, liquidity, updateUnixTime, priceChange24h } }
}


/* convenience wrapper for SOL (still cached) */
async function getSolPrice(userId = null) {
  return getTokenPrice(userId, SOL_MINT);
}

/* helper to decide if a token should be counted/injected */
async function isTokenLiquid(userId, mint, { minLiquidityUsd = MIN_LIQUIDITY_USD_DEFAULT, maxStalenessSec = MAX_PRICE_STALENESS_SEC } = {}) {
  const { liquidity, updateUnixTime } = await getPriceAndLiquidity(userId, mint);
  const fresh = updateUnixTime ? (Date.now()/1000 - updateUnixTime) <= maxStalenessSec : false;
  return liquidity >= minLiquidityUsd && fresh;
}

module.exports = getTokenPrice; // default
module.exports.getSolPrice = getSolPrice;
module.exports.getPriceAndLiquidity = getPriceAndLiquidity;
module.exports.getPricesWithLiquidityBatch = getPricesWithLiquidityBatch;
module.exports.isTokenLiquid = isTokenLiquid;
module.exports.SOL_MINT = SOL_MINT;
module.exports.USDC_MINT = USDC_MINT;