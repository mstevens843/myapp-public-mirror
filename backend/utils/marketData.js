/**
 * marketData.js - Enhanced Market Data Utilities
 * ------------------------------------------------
 * This version of marketData wraps all external HTTP calls in a
 * resilient http client that adds automatic timeouts, retries with
 * exponential backoff and jitter, and a circuit breaker per service.
 * Responses are cached in-memory for a configurable TTL to reduce
 * external API churn. On failure the last fresh cached value is
 * returned; otherwise a descriptive error is thrown to allow callers
 * to handle the lack of data gracefully.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Connection, PublicKey } = require('@solana/web3.js');
const httpClient = require('../utils/httpClient');
const cache = require('../utils/cache');

// API keys and constants
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const RPC = process.env.SOLANA_RPC_URL;

// Solana RPC connection
const connection = new Connection(RPC, 'confirmed');

// Endpoint URLs
const BIRDEYE_DEFI_PRICE_URL = 'https://public-api.birdeye.so/defi/price';
const JUP_TOKEN_URL = 'https://lite-api.jup.ag/tokens/v1/token';
const JUP_PRICE_URL = 'https://lite-api.jup.ag/price/v2';

// Known mints
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Cache TTLs (ms) – can be overridden via environment
const PRICE_CACHE_TTL_MS        = parseInt(process.env.PRICE_CACHE_TTL_MS || '30000', 10);
const PRICE_CHANGE_CACHE_TTL_MS = parseInt(process.env.PRICE_CHANGE_CACHE_TTL_MS || '60000', 10);
const VOLUME_CACHE_TTL_MS       = parseInt(process.env.VOLUME_CACHE_TTL_MS || '60000', 10);
const TOKEN_INFO_CACHE_TTL_MS   = parseInt(process.env.TOKEN_INFO_CACHE_TTL_MS || '60000', 10);

/**
 * Fetch token information (price, change, volume) from Jupiter. Results
 * are cached to avoid repeated calls. Returns null on failure.
 *
 * @param {string} mint
 * @returns {Promise<Object|null>}
 */
async function fetchTokenInfo(mint) {
  const key = `tokenInfo:${mint}`;
  return cache.withCache(key, TOKEN_INFO_CACHE_TTL_MS, async () => {
    try {
      const res = await httpClient({
        url: `${JUP_TOKEN_URL}/${mint}`,
        method: 'get',
        circuitKey: 'jupiter',
      });
      return res.data || null;
    } catch (err) {
      console.warn(`⚠️ fetchTokenInfo failed for ${mint}:`, err.message);
      return null;
    }
  });
}

/**
 * Retrieve the SOL price via Jupiter. Cached for a short TTL. Throws
 * if price data is unavailable and no cache exists.
 *
 * @returns {Promise<number>}
 */
async function getSolPrice() {
  const key = `price:${SOL_MINT}`;
  const cached = cache.get(key);
  if (cached != null) return cached;
  try {
    const res = await httpClient({
      url: `${JUP_PRICE_URL}?ids=${SOL_MINT}`,
      method: 'get',
      circuitKey: 'jupiter',
    });
    const price = parseFloat(res.data?.data?.[SOL_MINT]?.price ?? 0);
    if (price) {
      cache.set(key, price, PRICE_CACHE_TTL_MS);
      return price;
    }
  } catch (err) {
    console.warn(`⚠️ Failed to fetch SOL price:`, err.message);
  }
  throw new Error(`Price unavailable for ${SOL_MINT}`);
}

/**
 * Get the latest USD price for a token. Attempts Birdeye first then
 * falls back to Jupiter. Uses per-service circuit breakers and caches
 * successful responses. If both APIs fail and no cached value exists
 * an error is thrown.
 *
 * @param {string} mint
 * @returns {Promise<number>}
 */
async function getTokenPrice(mint) {
  // Shortcut for SOL and USDC
  if (mint === SOL_MINT) return getSolPrice();
  if (mint === USDC_MINT) return 1;
  const key = `price:${mint}`;
  const cached = cache.get(key);
  if (cached != null) return cached;
  // Birdeye
  try {
    const res = await httpClient({
      url: BIRDEYE_DEFI_PRICE_URL,
      method: 'get',
      params: { address: mint },
      headers: {
        'x-chain': 'solana',
        'X-API-KEY': BIRDEYE_API_KEY,
      },
      circuitKey: 'birdeye',
    });
    const price = parseFloat(res.data?.data?.value ?? 0);
    if (price) {
      cache.set(key, price, PRICE_CACHE_TTL_MS);
      return price;
    }
  } catch (err) {
    console.warn(`⚠️ Birdeye price fetch failed for ${mint}:`, err.message);
  }
  // Jupiter fallback
  try {
    const res = await httpClient({
      url: `${JUP_TOKEN_URL}/${mint}`,
      method: 'get',
      circuitKey: 'jupiter',
    });
    const price = parseFloat(res.data?.price ?? res.data?.data?.value ?? 0);
    if (price) {
      cache.set(key, price, PRICE_CACHE_TTL_MS);
      return price;
    }
  } catch (err) {
    console.warn(`⚠️ Jupiter fallback failed for ${mint}:`, err.message);
  }
  throw new Error(`Price unavailable for ${mint}`);
}

/**
 * Get the price change (in decimal) for the specified interval. Uses
 * Birdeye for both 1h and 24h intervals. Falls back to CoinGecko for
 * SOL 24h when Birdeye returns zero. Cached to reduce load.
 *
 * @param {string} mint
 * @param {number} interval Accepts 1 or 24. Defaults to 24.
 * @returns {Promise<number>}
 */
async function getTokenPriceChange(mint, interval = 24) {
  const key = `pct:${mint}:${interval}`;
  const cached = cache.get(key);
  if (cached != null) return cached;
  try {
    const res = await httpClient({
      url: BIRDEYE_DEFI_PRICE_URL,
      method: 'get',
      params: { address: mint },
      headers: {
        'x-chain': 'solana',
        'X-API-KEY': BIRDEYE_API_KEY,
      },
      circuitKey: 'birdeye',
    });
    const field = interval === 1 ? 'priceChange1h' : 'priceChange24h';
    let raw = res.data?.data?.[field];
    let pct = Number(raw ?? 0) / 100; // convert to decimal
    // Special case: SOL 24h fallback to CoinGecko
    if (!pct && mint === SOL_MINT && interval === 24) {
      try {
        const cg = await httpClient({
          url: 'https://api.coingecko.com/api/v3/coins/solana',
          method: 'get',
          params: { localization: false, market_data: true },
          circuitKey: 'coingecko',
          timeout: 6000,
        });
        pct = (cg.data?.market_data?.price_change_percentage_24h || 0) / 100;
      } catch (err) {
        console.warn('⚠️ CoinGecko fallback failed:', err.message);
      }
    }
    cache.set(key, pct, PRICE_CHANGE_CACHE_TTL_MS);
    return pct;
  } catch (err) {
    console.warn(`⚠️ getTokenPriceChange failed for ${mint}:`, err.message);
  }
  throw new Error(`Price change unavailable for ${mint}`);
}

/**
 * Retrieve the 24h trading volume (USD) for a mint. Uses Jupiter token
 * endpoint and caches the result. Throws if data unavailable.
 *
 * @param {string} mint
 * @returns {Promise<number>}
 */
async function getTokenVolume(mint) {
  const key = `volume:${mint}`;
  const cached = cache.get(key);
  if (cached != null) return cached;
  try {
    const info = await fetchTokenInfo(mint);
    const volume = Number(info?.daily_volume ?? info?.volume ?? 0);
    cache.set(key, volume, VOLUME_CACHE_TTL_MS);
    return volume;
  } catch (err) {
    console.warn(`⚠️ getTokenVolume failed for ${mint}:`, err.message);
  }
  throw new Error(`Volume unavailable for ${mint}`);
}

/**
 * Returns token balance for a given wallet and mint. Handles both
 * native SOL and SPL tokens. This function retains the original
 * behaviour and does not utilise caching because RPC queries are
 * already idempotent and inexpensive relative to price queries.
 *
 * @param {string|PublicKey} walletPublicKey
 * @param {string} mintAddress
 * @returns {Promise<number>}
 */
async function getTokenBalance(walletPublicKey, mintAddress) {
  const walletKey =
    typeof walletPublicKey === 'string'
      ? new PublicKey(walletPublicKey)
      : walletPublicKey;
  const mint = new PublicKey(mintAddress);
  // SOL case
  if (mintAddress === SOL_MINT) {
    const solBalance = await connection.getBalance(walletKey);
    return solBalance / 1e9;
  }
  // SPL token
  const accounts = await connection.getTokenAccountsByOwner(walletKey, {
    mint,
  });
  const balance =
    accounts.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
  return balance;
}

/**
 * Stubbed fetchTokenList to maintain backwards compatibility. Can be
 * enhanced to return tradable mints from Jupiter.
 */
async function fetchTokenList() {
  return [];
}

/**
 * Retrieves the raw token balance (lamports) by scanning all parsed
 * accounts. Preserved from the original implementation. Not cached.
 *
 * @param {PublicKey} walletPublicKey
 * @param {string} mintAddress
 * @returns {Promise<bigint>}
 */
async function getTokenBalanceRaw(walletPublicKey, mintAddress) {
  const mint = mintAddress.toString();
  const accounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  });
  for (const acc of accounts.value) {
    const parsed = acc.account.data.parsed;
    if (parsed?.info?.mint === mint) {
      return BigInt(parsed.info.tokenAmount.amount);
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
  getSolPrice,
};