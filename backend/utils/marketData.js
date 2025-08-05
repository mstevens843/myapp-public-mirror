/**
 * marketData.js - Market Data Utilities
 * --------------------------------------
 * Features:
 * - Get token price, 24h % change, and volume via Jupiter API
 * - Fetch token balances (SOL and SPL tokens) via Solana RPC
 * - Per-token lookup using Jupiter's new token endpoint
 *
 * Used by: sniper, trendFollower, breakout, rebalancer, etc.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const axios = require("axios");
const { Connection, PublicKey } = require("@solana/web3.js");
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;

const RPC = process.env.SOLANA_RPC_URL;
const connection = new Connection(RPC, "confirmed");

const BIRDEYE_URL = "https://public-api.birdeye.so/defi/price";

// ⚠️ This is the new per-token Jupiter API, not the old bulk list
const JUP_TOKEN_URL = "https://lite-api.jup.ag/tokens/v1/token";


const tokenPriceCache = new Map();      // ✅ store fetched prices
const fetchedOnce     = new Set();      // ✅ l
/* ─── simple in-memory cache ───────────────────────────── */
const priceCache = new Map(); // optional: you can keep this just to avoid double fetching in rare fallback cases
       // mint ⇒ { price, ts }
/* fetch guard so we don’t hammer Birdeye while a call is already in flight */
const inflight    = new Map();            // mint ⇒ Promise

// ✅ Returns token info (price, change, volume, etc.)
async function getTokenList(mint) {
  try {
    const res = await axios.get(`${JUP_TOKEN_URL}/${mint}`);
    return res.data;
  } catch (err) {
    console.warn(`⚠️ Failed to fetch token info for ${mint}`);
    return null;
  }
}

async function getSolPrice() {
  try {
    const res = await axios.get("https://lite-api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112");
    const price = res.data?.data?.["So11111111111111111111111111111111111111112"]?.price;
    return price || 0;
  } catch (err) {
    console.warn("⚠️ Failed to fetch SOL price from Jupiter:", err.message);
    return 0;
  }
}

/**
 * ✅ Returns current price of a token (in USD)
 */
async function getTokenPrice(mint) {
    try {
      // Special case for SOL (Jupiter no longer includes price in token metadata)
      if (mint === "So11111111111111111111111111111111111111112") {
        const url = `https://lite-api.jup.ag/price/v2?ids=${mint}`;
        const res = await axios.get(url);
        return parseFloat(res.data?.data?.[mint]?.price) || 0;
      }
  
      // Default path for other tokens
      const token = await getTokenList(mint);
      return token?.price || 0;
    } catch (err) {
      console.warn(`⚠️ Failed to fetch price for ${mint}`);
      return 0;
    }
  }

// ✅ Get token price from Birdeye first, fallback to Jupiter
async function getTokenPrice(mint) {
  try {
    const res = await axios.get(BIRDEYE_URL, {
      params: { address: mint },
      headers: {
        "x-chain": "solana",
        "X-API-KEY": BIRDEYE_API_KEY,
      },
    });
    const price = +res.data?.data?.value;
    if (price) {
      priceCache.set(mint, { price, ts: Date.now() });
      return price;
    }
  } catch (err) {
    console.warn(`⚠️ Birdeye price fetch failed for ${mint}:`, err.message);
  }

  // Jupiter fallback
  try {
    const jup = await axios.get(`${JUP_TOKEN_URL}/${mint}`);
    const jPrice = +jup.data?.price;
    if (jPrice) {
      priceCache.set(mint, { price: jPrice, ts: Date.now() });
      return jPrice;
    }
  } catch (err) {
    console.warn(`⚠️ Jupiter fallback failed for ${mint}:`, err.message);
  }

  priceCache.set(mint, { price: 0, ts: Date.now() });
  return 0;
}

// Token fetch specifically for usdc and sol for wallet balance. Saves Api calls to birdeye. 

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ✅ Optimized: skip unnecessary price API calls
async function getTokenPriceApp(mint) {
  if (mint === SOL_MINT) return await getSolPrice();
  if (mint === USDC_MINT) return 1.0;

  if (fetchedOnce.has(mint) && tokenPriceCache.has(mint)) {
    return tokenPriceCache.get(mint);
  }

  try {
    const res = await axios.get(BIRDEYE_URL, {
      params: { address: mint },
      headers: {
        "x-chain": "solana",
        "X-API-KEY": BIRDEYE_API_KEY,
      },
    });
    const price = parseFloat(res.data?.data?.value);
    if (price) {
      tokenPriceCache.set(mint, price);
      fetchedOnce.add(mint);
      return price;
    }
  } catch (err) {
    console.warn(`⚠️ Birdeye price fetch failed for ${mint}:`, err.message);
  }

  try {
    const jup = await axios.get(`${JUP_TOKEN_URL}/${mint}`);
    const jupPrice = parseFloat(jup.data?.price);
    if (jupPrice) {
      tokenPriceCache.set(mint, jupPrice);
      fetchedOnce.add(mint);
      return jupPrice;
    }
  } catch (err) {
    console.warn(`⚠️ Jupiter fallback failed for ${mint}:`, err.message);
  }

  tokenPriceCache.set(mint, 0);
  fetchedOnce.add(mint);
  return 0;
}
/**
 * ✅ Returns 24h % change for a token (decimal format from Jupiter)
 */
/**
 * ✅ Returns 24h % change for a token (decimal format)
 * Falls back to CoinGecko for SOL if Jupiter omits it
 */
async function getTokenPriceChange(mint) {
    const token = await getTokenList(mint);
  
    if (
      (!token?.price_change_24h || token.price_change_24h === 0) &&
      mint === "So11111111111111111111111111111111111111112"
    ) {
      try {
        const { data } = await axios.get(
          "https://api.coingecko.com/api/v3/coins/solana?localization=false&market_data=true"
        );
        return data?.market_data?.price_change_percentage_24h / 100 || 0;
      } catch (err) {
        console.warn("⚠️ CoinGecko fallback failed:", err.message);
      }
    }
  
    return token?.price_change_24h || 0;
  }


  /**
 * ✅ Returns 24h trading volume for a token
 */
async function getTokenVolume(mint) {
    try {
      const token = await getTokenList(mint);
      return token?.daily_volume || 0;
    } catch (err) {
      console.warn(`⚠️ Failed to fetch volume for ${mint}`);
      return 0;
    }
  }

//
/**
 * ✅ Returns token balance for a given wallet and mint
 * Handles both native SOL and SPL tokens
 * Hardened: accepts PublicKey or string for walletPublicKey
 */
async function getTokenBalance(walletPublicKey, mintAddress) {
  const walletKey =
    typeof walletPublicKey === "string"
      ? new PublicKey(walletPublicKey)
      : walletPublicKey;

  const mint = new PublicKey(mintAddress);

  // If SOL, return native SOL balance
  if (mintAddress === "So11111111111111111111111111111111111111112") {
    const solBalance = await connection.getBalance(walletKey);
    return solBalance / 1e9;
  }

  // Else fetch SPL token account balance
  const accounts = await connection.getTokenAccountsByOwner(walletKey, {
    mint,
  });

  const balance =
    accounts.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
  return balance;
}

/**
 * ❌ Deprecated - fetchTokenList is now a stub to maintain compatibility
 */
async function fetchTokenList() {
  return []; // Optional: you can fetch tradable token mints from Jupiter if needed
}


// ✅ Fetch raw balance (lamports) by scanning *all* parsed accounts
async function getTokenBalanceRaw(walletPublicKey, mintAddress) {
  const mint = mintAddress.toString();
  const accounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  });

  for (const acc of accounts.value) {
    const parsed = acc.account.data.parsed;
    if (parsed?.info?.mint === mint) {
      return BigInt(parsed.info.tokenAmount.amount); // raw lamports
    }
  }

  return 0n;
}


module.exports = {
  getTokenPrice,
  getTokenPriceChange,
  getTokenVolume,
  getTokenBalance,
  fetchTokenList,
  getTokenBalanceRaw,
  getTokenPriceApp, 
  getSolPrice, 
};