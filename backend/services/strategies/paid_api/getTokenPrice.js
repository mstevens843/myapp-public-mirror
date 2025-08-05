require("dotenv").config({ path: __dirname + "/../../../.env" });
const { birdeyeCUCounter } = require("./birdeyeCUCounter");
const CU_TABLE = require("./cuTable");

const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BIRDEYE   = "https://public-api.birdeye.so/defi/multi_price";

const cache  = new Map();              // mint → { ts, price }
const TTL_MS = 30_000;                 // 30 s

/* ----------------------------------------------------- */
/*  internal: fetch prices for 1-N mints in one request  */
/* ----------------------------------------------------- */
async function fetchPrices(mints, userId = null) {
  const mintsClean = (mints || []).filter(Boolean);

  if (!mintsClean.length) {
    console.warn(`⚠️ fetchPrices called with empty or invalid mints`);
    return {};
  }

  const listParam = mintsClean.join(",");

  const data = await birdeyeCUCounter({
    url: BIRDEYE,
    params: { list_address: listParam, ui_amount_mode: "raw" },
    cuCost: CU_TABLE["/defi/multi_price"],
    userId,
  });

  if (!data?.success) {
    console.warn(`⚠️ fetchPrices: Birdeye returned unsuccessful response`);
    throw new Error("Birdeye response not OK");
  }

  const out = {};
  for (const mint of mintsClean) {
    const p = Number(data.data?.[mint]?.value || 0);
    if (p) out[mint] = p;
  }

  if (Object.keys(out).length === 0) {
    console.warn(`⚠️ fetchPrices: no valid prices returned for [${listParam}]`);
  }

  return out;          // { mint: price }
}

/* ----------------------- public API ------------------ */
async function getTokenPrice(userId = null, mint) {
  if (!mint) {
    console.warn(`⚠️ getTokenPrice called without a mint`);
    return 0;
  }

  if (mint === USDC_MINT) return 1;             // 1 USDC = 1 USD

  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < TTL_MS) {
    return hit.price;
  }

  try {
    const prices = await fetchPrices([mint], userId);
    const price  = prices[mint] || 0;

    cache.set(mint, { ts: Date.now(), price });
    return price;
  } catch (err) {
    console.warn(`❌ Birdeye price error for ${mint}:`, err.message);
    return 0;
  }
}

/* convenience wrapper for SOL (still cached) */
async function getSolPrice(userId = null) {
  return getTokenPrice(userId, SOL_MINT);
}

module.exports             = getTokenPrice;
module.exports.getSolPrice = getSolPrice;
module.exports.SOL_MINT    = SOL_MINT;   // handy
