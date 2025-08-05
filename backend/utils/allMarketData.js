/**
 * marketData.js - Market Data Utilities
 * --------------------------------------
 * Features:
 * - Get token price, 24h % change, and volume via Jupiter API
 * - Fetch token balances (SOL and SPL tokens) via Solana RPC
 * - Cached token list lookup
 *
 * Used by: sniper, trendFollower, breakout, rebalancer, etc.
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const axios = require("axios");
const { Connection, PublicKey } = require("@solana/web3.js");

const RPC = process.env.SOLANA_RPC_URL;
const connection = new Connection(RPC, "confirmed");

const JUP_TOKEN_URL = "https://lite-api.jup.ag/tokens/v1/all";
let TOKEN_LIST = null;

/**
 * ✅ Fetches full token list from Jupiter and caches it
 */
async function getTokenList() {
  if (!TOKEN_LIST) {
    const res = await axios.get(JUP_TOKEN_URL);
    TOKEN_LIST = res.data;
  }
  return TOKEN_LIST;
}

/**
 * ✅ Returns current price of a token (in USD)
 */
async function getTokenPrice(mint) {
  const list = await getTokenList();
  const token = list.find((t) => t.address === mint.toBase58());
  return token?.price || null;
}

/**
 * ✅ Returns 24h % change for a token (decimal format from Jupiter)
 */
async function getTokenPriceChange(mint) {
  const list = await getTokenList();
  const token = list.find((t) => t.address === mint.toBase58());
  return token?.change || 0;
}

/**
 * ✅ Returns 24h trading volume for a token
 */
async function getTokenVolume(mint) {
  const list = await getTokenList();
  const token = list.find((t) => t.address === mint.toBase58());
  return token?.volume || 0;
}

/**
 * ✅ Returns token balance for a given wallet and mint
 * Handles both native SOL and SPL tokens
 */
async function getTokenBalance(walletPublicKey, mintAddress) {
  const mint = new PublicKey(mintAddress);

  // If SOL, return native SOL balance
  if (mintAddress === "So11111111111111111111111111111111111111112") {
    const solBalance = await connection.getBalance(walletPublicKey);
    return solBalance / 1e9;
  }

  // Else fetch SPL token account balance
  const accounts = await connection.getTokenAccountsByOwner(walletPublicKey, {
    mint,
  });

  const balance =
    accounts.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
  return balance;
}

/**
 * ✅ Returns all known token mint addresses from Jupiter token list
 * Useful for pre-validating against known tokens in sniper strategies
 */
async function fetchTokenList() {
  const list = await getTokenList();
  return list.map((t) => t.address);
}

// module.exports = {
//   getTokenPrice,
//   getTokenPriceChange,
//   getTokenVolume,
//   getTokenBalance,
//   fetchTokenList,
// };


// ✅ Optional Enhancements:
// If you're hitting this API frequently (and running strategies like sniper, trendFollower, etc.), add a disk cache:

// js
// Copy
// Edit
// // Optional: cache TOKEN_LIST to disk on first fetch
// const fs = require("fs");
// const TOKEN_CACHE_FILE = "./cache/tokenList.json";

// async function getTokenList() {
//   if (TOKEN_LIST) return TOKEN_LIST;

//   try {
//     if (fs.existsSync(TOKEN_CACHE_FILE)) {
//       const raw = fs.readFileSync(TOKEN_CACHE_FILE, "utf-8");
//       TOKEN_LIST = JSON.parse(raw);
//       return TOKEN_LIST;
//     }

//     const res = await axios.get(JUP_TOKEN_URL);
//     TOKEN_LIST = res.data;

//     fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(TOKEN_LIST));
//     return TOKEN_LIST;
//   } catch (err) {
//     console.error("❌ Failed to load token list:", err.message);
//     return [];
//   }
// }