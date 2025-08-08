// utils/getTokenMarketStats.js
import axios from "axios";
// import getTokenAgePrecise from "./getTokenAgePrecise"; // already built by you

const BIRDEYE_API_KEY = import.meta.env.VITE_BIRDEYE_API_KEY;
const HEADERS = {
  accept: "application/json",
  "x-api-key": BIRDEYE_API_KEY,
};

/**
 * Fetches combined market stats for a token mint:
 * - price
 * - 24h change
 * - liquidity
 * - 24h volume (optional)
 * - token age (days)
 */
export default async function getTokenMarketStats(mint) {
  try {
    const priceUrl = `https://public-api.birdeye.so/defi/price?address=${mint}&include_liquidity=true`;
    const volUrl = `https://public-api.birdeye.so/defi/price_volume/single?address=${mint}`;

    const [priceRes, volRes ] = await Promise.all([
      axios.get(priceUrl, { headers: HEADERS }),
      axios.get(volUrl, { headers: HEADERS }).catch(() => null),
    //   getTokenAgePrecise(mint).catch(() => null),
    ]);

    const priceData = priceRes?.data?.data || {};
    const volData = volRes?.data?.data || {};
    // const ageDays = ageRes?.ageDays ?? null;

    return {
      price: priceData.value ?? 0,
      change24h: priceData.priceChange24h ?? 0,
      liquidity: priceData.liquidity ?? 0,
      volume24h: volData.value ?? null,
    //   ageDays,
    };
  } catch (err) {
    console.warn("getTokenMarketStats error:", err.message);
    return null;
  }
}
