const API_KEY = process.env.BIRDEYE_API_KEY;

async function getTokenStatsFromBirdeye(mint) {
  try {
    const res = await fetch(`https://public-api.birdeye.so/public/token/${mint}?include_volume=true`, {
      headers: { "X-API-KEY": API_KEY },
    });
    if (!res.ok) throw new Error("Failed fetch");
    const json = await res.json();
    const data = json.data;

    return {
      marketCap: data.market_cap,
      change24h: data.price_change_percentage_24h,
      change6h: data.price_change_percentage_6h,
      change1h: data.price_change_percentage_1h,
      change5m: data.price_change_percentage_5m,
    };
  } catch (err) {
    return {
      marketCap: "—",
      change24h: "—",
      change6h: "—",
      change1h: "—",
      change5m: "—",
    };
  }
}

module.exports = { getTokenStatsFromBirdeye };



require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const fetch = require("node-fetch");

/* ────────────────────────────────────────────────
 *  Birdeye DeFi-price helper
 *  – 30-second in-memory cache per mint
 *  – graceful fallback on API errors / rate-limits
 * ──────────────────────────────────────────────── */
const defiCache = new Map();               // mint → { t, data }

async function getBirdeyeDefiPrice(mint) {
  try {
    /* ---------- tiny cache (30 s) ---------- */
    const now     = Date.now();
    const cached  = defiCache.get(mint);
    if (cached && now - cached.t < 30_000) return cached.data;

    /* ---------- fetch from Birdeye ---------- */
    const res = await fetch(
      `https://public-api.birdeye.so/defi/price?address=${mint}`,
      {
        headers: {
          accept      : "application/json",
          "x-chain"   : "solana",
          "x-api-key" : process.env.BIRDEYE_API_KEY,
        },
        timeout: 7_000,
      }
    );

    const json = await res.json();

    if (!json.success || !json.data) {
      if (json.message === "Too many requests") {
        console.warn("⏱️ Birdeye rate-limit hit — retrying will be delayed.");
      }
      throw new Error(json.message || "No data returned from Birdeye");
    }

    /* ---------- shape the output ---------- */
    const out = {
      price          : json.data.value,          // USD
      priceChange24h : json.data.priceChange24h, // decimal
      liquidity      : json.data.liquidity,
      lastUpdated    : json.data.updateUnixTime, // unix
    };

    /* save to cache */
    defiCache.set(mint, { t: now, data: out });
    return out;

  } catch (err) {
    console.error("Birdeye DeFi fetch error:", err.message);
    return null;   // caller will fall back to Jupiter if needed
  }
}

module.exports = { getBirdeyeDefiPrice };