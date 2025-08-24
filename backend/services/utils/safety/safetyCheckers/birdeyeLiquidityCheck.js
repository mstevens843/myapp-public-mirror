const { isThawAccountInstruction } = require("@solana/spl-token");
const axios = require("axios");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const URL = "https://public-api.birdeye.so/defi/multi_price";
const HEADERS = {
  "x-api-key": BIRDEYE_API_KEY,
  "x-chain": "solana",
  accept: "application/json",
};

/* ───────── meta ───────── */
const KEY        = "liquidity";
const LABEL      = "Ensure Liquidity Exists";
const MIN_LIQUID = 5_000;
const CACHE      = new Map();
const TTL        = 30_000;

/**
 * Uses /multi_price to check liquidity for a single token.
 */
async function checkBirdeyeLiquidity(mint, { min = MIN_LIQUID } = {}) {
  const now    = Date.now();
  const cached = CACHE.get(mint);
  if (cached && now - cached.t < TTL) return cached.result;

  try {
    const { data } = await axios.get(URL, {
      headers: HEADERS,
      params: {
        list_address: mint,           // ✅ Single token is fine
        include_liquidity: true,
      },
      timeout: 6000,
    });

    const tokenData = data?.data?.[mint];
    const liquidity = tokenData?.liquidity;

    let result;

    if (typeof liquidity === "number") {
      const passed = liquidity >= min;
      result = passed
        ? {
            key: KEY,
            label: LABEL,
            passed: true,
            detail: `$${liquidity.toFixed(2)} ≥ $${min.toFixed(2)}`,
            data:  { liquidity, min, source: "birdeye" },
          }
        : {
            key: KEY,
            label: LABEL,
            passed: false,
            reason: "Low liquidity",
            detail: `$${liquidity.toFixed(2)} < $${min.toFixed(2)}`,
            data:  { liquidity, min, source: "birdeye" },
          };
    } else {
      result = {
        key: KEY,
        label: LABEL,
        passed: true,                      // soft-pass
        reason: "No liquidity field",
        detail: "Missing data from Birdeye",
        data: { source: "birdeye" },
      };
    }

    CACHE.set(mint, { t: now, result });
    return result;

  } catch (err) {
    return {
      key: KEY,
      label: LABEL,
      passed: true,                          // soft-pass on crash
      reason: "Birdeye API error",
      detail: err.response?.data?.message || err.message,
      data: { source: "birdeye", error: true },
    };
  }
}

module.exports = { checkBirdeyeLiquidity };
