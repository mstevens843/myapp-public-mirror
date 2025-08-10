/**
 * getTokenPriceChange.js (PAID)
 * ---------------------------------
 * Fetches price change % (1h or 24h) using Birdeye Starter-tier.
 * Includes fallback via history endpoint if 1h not available.
 */

require("dotenv").config({ path: __dirname + "/../../../.env" });
const { birdeyeCUCounter } = require("./birdeyeCUCounter");
const CU_TABLE = require("./cuTable");

const BASE_URL = "https://public-api.birdeye.so/defi";
const cache = new Map(); // key: mint:interval → { ts, pct }
const TTL_MS = 60_000;

async function getTokenPriceChange(mint, interval = 24, userId = null) {
  const key = `${mint}:${interval}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.pct;

  try {
    const data = await birdeyeCUCounter({
      url: `${BASE_URL}/price`,
      params: { address: mint },
      cuCost: CU_TABLE["/defi/price"],
      userId,
    });

    const fieldMap = {
      1: "priceChange1h",
      24: "priceChange24h",
    };

    const field = fieldMap[interval] || "priceChange24h";
    const raw = data?.data?.[field];

    let pct = Number(raw);
    if (!pct && interval === 1) {
      // Fallback via history_price
      const fallbackData = await birdeyeCUCounter({
        url: `${BASE_URL}/history_price`,
        params: { address: mint, timeframe: 3600 },
        cuCost: CU_TABLE["/defi/price"], // reuse same cost for fallback
        userId,
      });

      const items = fallbackData?.data?.items || [];
      const first = items[0]?.value;
      const last = items[items.length - 1]?.value;

      if (first && last) {
        pct = ((last - first) / first) * 100;
      }
    }

    const pctNormalized = pct / 100;
    cache.set(key, { ts: Date.now(), pct: pctNormalized });
    return pctNormalized;
  } catch (err) {
    console.warn(`⚠️ getTokenPriceChange failed for ${mint}:`, err.message);
    return 0;
  }
}

module.exports = getTokenPriceChange;
