// utils/getTokenMarketStats.js

require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });
const axios = require("axios");

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;

if (!BIRDEYE_API_KEY) {
  throw new Error("❌ Missing BIRDEYE_API_KEY in environment variables");
}

const HEADERS = {
  "x-chain": "solana",
  "x-api-key": BIRDEYE_API_KEY,
  "accept": "application/json",
};

async function getTokenMarketStats(mint) {
  const stats = {
    symbol: null,
    name: null,
    logoURI: null,
    price: null,
    liquidity: null,
    change24h: null,
    marketCap: null,
    volume24h: null,
    holders: null,
    fdv: null,
    uniqueWallet24h: null,
        // 🆕 New Fields
    volume24hUSD: null,
    buyVol24hUSD: null,
    sellVol24hUSD: null,
    totalSupply: null,
    circulatingSupply: null,
    lastTradeTime: null,
  };

  try {
    // Preferred: Paid token_overview
    const res = await axios.get(`https://public-api.birdeye.so/defi/token_overview?address=${mint}`, {
      headers: HEADERS,
    });

    const d = res?.data?.data;
    if (d) {
      stats.symbol = d.symbol ?? null;
      stats.name = d.name ?? null;
      stats.logoURI = d.logoURI ?? null;
      stats.price = Number(d.price ?? 0);
      stats.liquidity = Number(d.liquidity ?? 0);
      stats.marketCap = Number(d.marketCap ?? 0);
      stats.fdv = Number(d.fdv ?? 0);
      stats.holders = Number(d.holder ?? 0);
      stats.uniqueWallet24h = Number(d.uniqueWallet24h ?? 0);
      stats.change24h = Number(d.priceChange24hPercent ?? 0) / 100;
      stats.volume24h = Number(d.v24hUSD ?? 0);

      // 🆕 Additional Metrics
      stats.volume24hUSD = Number(d.v24hUSD ?? 0);
      stats.buyVol24hUSD = Number(d.vBuy24hUSD ?? 0);
      stats.sellVol24hUSD = Number(d.vSell24hUSD ?? 0);
      stats.totalSupply = Number(d.totalSupply ?? 0);
      stats.circulatingSupply = Number(d.circulatingSupply ?? 0);
      stats.lastTradeTime = d.lastTradeHumanTime ?? null;
      return stats;
    }
  } catch (err) {
    console.warn(`⚠️ [Birdeye] token_overview failed for ${mint}, falling back to free APIs...`);
  }

  // Fallback: Free APIs
  try {
    const baseUrl = "https://public-api.birdeye.so/defi";
    const [marketRes, volRes] = await Promise.all([
      axios.get(`${baseUrl}/v3/token/market-data?address=${mint}`, { headers: HEADERS }),
      axios.get(`${baseUrl}/price_volume/single?address=${mint}&type=24h`, { headers: HEADERS }),
    ]);

    const market = marketRes?.data?.data;
    const vol = volRes?.data?.data;

    if (market) {
      stats.price = Number(market.price ?? 0);
      stats.liquidity = Number(market.liquidity ?? 0);
      stats.marketCap = Number(market.market_cap ?? 0);
    }

    if (vol) {
      stats.change24h = Number(vol.priceChangePercent ?? 0) / 100;
      stats.volume24h = Number(vol.volumeUSD ?? 0);
    }

    return stats;
  } catch (err) {
    console.error(`❌ [Birdeye Fallback] Failed for ${mint}:`, err.message);
    return null;
  }
}

module.exports = getTokenMarketStats;
