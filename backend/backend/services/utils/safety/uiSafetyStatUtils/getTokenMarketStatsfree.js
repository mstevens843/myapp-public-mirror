require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });
const axios = require("axios");

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const HEADERS = {
  "x-chain": "solana",
  "x-api-key": BIRDEYE_API_KEY,
  accept: "application/json",
};

async function getTokenMarketStats(mint) {
  const baseUrl = "https://public-api.birdeye.so/defi";
  let stats = {
    price: null,
    liquidity: null,
    change24h: null,
    marketCap: null,
    volume24h: null,
  };

  try {
    // Primary: Market Data
    const marketRes = await axios.get(`${baseUrl}/v3/token/market-data?address=${mint}`, { headers: HEADERS });
    const market = marketRes?.data?.data;
    if (market) {
      stats.price = market.price ?? null;
      stats.liquidity = market.liquidity ?? null;
      stats.marketCap = market.market_cap ?? null;
    }
  } catch (err) {
    console.warn(`[Birdeye] market-data error for ${mint}: ${err.message}`);
  }

  try {
    // Secondary: Price/Volume 24h
    const volRes = await axios.get(`${baseUrl}/price_volume/single?address=${mint}&type=24h`, { headers: HEADERS });
    const vol = volRes?.data?.data;
    if (vol) {
      stats.change24h = vol.priceChangePercent ?? null;
      stats.volume24h = vol.volumeUSD ?? null;
    }
  } catch (err) {
    console.warn(`[Birdeye] price_volume error for ${mint}: ${err.message}`);
  }

  return stats;
}

module.exports = getTokenMarketStats;
