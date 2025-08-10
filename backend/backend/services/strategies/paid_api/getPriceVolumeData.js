/**
 * getPriceVolumeData.js (PAID)
 * ---------------------------------
 * Fetches price, volume, and change % from Birdeye Starter.
 * Endpoint: /defi/price_volume/single
 */

require("dotenv").config({ path: __dirname + "/../../../.env" });
const { birdeyeCUCounter } = require("./birdeyeCUCounter");
const CU_TABLE = require("./cuTable");

const URL = "https://public-api.birdeye.so/defi/price_volume/single";
const cache = new Map();
const TTL_MS = 60_000;

/**
 * Fetches price/volume/change% for a given mint.
 * @param {string} mint - Token mint
 * @param {string|null} userId - User ID for CU tracking
 */
async function getPriceVolumeData(mint, userId = null) {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;

  try {
    const data = await birdeyeCUCounter({
      url: URL,
      params: {
        address: mint,
        type: "24h",
      },
      cuCost: CU_TABLE["/defi/price_volume/single"], // centralized CU
      userId,
    });

    const result = {
      price: Number(data?.data?.price ?? 0),
      volumeUSD: Number(data?.data?.volumeUSD ?? 0),
      priceChangePercent: Number(data?.data?.priceChangePercent ?? 0) / 100,
      volumeChangePercent: Number(data?.data?.volumeChangePercent ?? 0) / 100,
    };

    cache.set(mint, { ts: Date.now(), data: result });
    return result;

  } catch (err) {
    console.warn(`⚠️ getPriceVolumeData failed for ${mint}:`, err.message);
    return {
      price: 0,
      volumeUSD: 0,
      priceChangePercent: 0,
      volumeChangePercent: 0,
    };
  }
}

module.exports = getPriceVolumeData;
