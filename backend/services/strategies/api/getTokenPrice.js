/**
 * getTokenPriceApp.js
 * ---------------------------------
 * “One-shot” latest USD price for any mint.
 * Uses Birdeye → Jupiter fallback, plus SOL/USDC fast-path.
 */

require("dotenv").config({ path: __dirname + "/../../../.env" });
const axios = require("axios");
console.log("Birdeye Key:", process.env.BIRDEYE_API_KEY);
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const BIRDEYE = "https://public-api.birdeye.so/defi/price";
const JUPITER = "https://lite-api.jup.ag/tokens/v1/token";

const cache = new Map();
const TTL_MS = 30_000;

async function getSolPrice() {
  const { data } = await axios.get(
    "https://lite-api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112"
  );
  return Number(data?.data?.[SOL_MINT]?.price || 0);
}

async function getTokenPrice(mint) {
  if (mint === SOL_MINT) return getSolPrice();
  if (mint === USDC_MINT) return 1;

  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.price;

  /* 1️⃣  Birdeye first */
  try {
    const { data } = await axios.get(BIRDEYE, {
      params: { address: mint },
      headers: { "x-chain": "solana", "X-API-KEY": BIRDEYE_API_KEY },
      timeout: 6000,
    });
    const p = Number(data?.data?.value || 0);
    if (p) { cache.set(mint, { ts: Date.now(), price: p }); return p; }
  } catch (err) {
    if (err?.response?.status !== 429)
      console.warn(`⚠️ Birdeye price failed for ${mint}:`, err.message);
  }

  /* 2️⃣  Jupiter fallback */
  try {
    const { data } = await axios.get(`${JUPITER}/${mint}`, { timeout: 6000 });
    const price = Number(data?.price || 0);
    cache.set(mint, { ts: Date.now(), price });
    return price;
  } catch (err) {
    console.warn(`⚠️ Jupiter price failed for ${mint}:`, err.message);
    return 0;
  }
}

module.exports = getTokenPrice;
