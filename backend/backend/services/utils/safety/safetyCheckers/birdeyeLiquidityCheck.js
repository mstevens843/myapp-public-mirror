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
      result = liquidity >= min
        ? {
            key: KEY,
            label: LABEL,
            passed: true,
            data: { liquidity },
          }
        : {
            key: KEY,
            label: LABEL,
            passed: false,
            reason: "Low liquidity",
            detail: `$${liquidity.toFixed(2)} < $${min}`,
            data: { liquidity },
          };
    } else {
      result = {
        key: KEY,
        label: LABEL,
        passed: true,                      // soft-pass
        reason: "No liquidity field",
        detail: "Missing data from Birdeye",
        data: null,
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
      data: null,
    };
  }
}

module.exports = { checkBirdeyeLiquidity };






// old api call that well revert back to once they fix it 
// // services/utils/birdeyeLiquidityCheck.js
// require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });
// const axios = require("axios");

// /* ───────── constants ───────── */
// const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
// const PRICE_URL       = "https://public-api.birdeye.so/defi/multi_price";
// const HEADERS         = { "x-api-key": BIRDEYE_API_KEY, accept: "application/json" };

// const KEY        = "liquidity";
// const LABEL      = "Ensure Liquidity Exists";
// const MIN_LIQUID = 5_000;            // USD threshold
// const CACHE      = new Map();        // mint → { t, result }
// const CACHE_TTL  = 30_000;           // 30 s

// /**
//  * Passes if Birdeye reports ≥ MIN_LIQUID in pool liquidity.
//  * Soft-passes when Birdeye throws a 5xx so sniper keeps rolling.
//  */
// async function checkBirdeyeLiquidity (mint, { min = MIN_LIQUID } = {}) {
//   const now     = Date.now();
//   const cached  = CACHE.get(mint);
//   if (cached && now - cached.t < CACHE_TTL) return cached.result;

//   try {
//     /* ── primary hit ── */
//     const { data } = await axios.get(
//       `${PRICE_URL}?address=${mint}&include_liquidity=true`,
//       { headers: HEADERS, timeout: 6_000 }
//     );
//     return storeAndReturn(parseResult(data, min));

//   } catch (err) {
//     const status = err.response?.status ?? 0;

//     /* ── Birdeye loves to 500 on fresh mints – retry on /token_data ── */
//     if (status >= 500) {
//       try {
//         const { data } = await axios.get(
//           `${FALLBACK_URL}?address=${mint}`,
//           { headers: HEADERS, timeout: 6_000 }
//         );
//         return storeAndReturn(parseResult(data, min));
//       } catch { /* fall through to soft-pass */ }
//     }

//     /* ── final soft-pass so the bot doesn’t choke ── */
//     return storeAndReturn({
//       key: KEY,
//       label: LABEL,
//       passed: true,                       // treat as “unknown”, not “fail”
//       reason: "Birdeye unavailable",
//       detail: `HTTP ${status || "network"} – ${err.message}`,
//       data: null,
//     });
//   }

//   /* helpers */
//   function parseResult (apiData, threshold) {
//     const liquidity = apiData?.data?.liquidity ?? 0;
//     return liquidity >= threshold
//       ? {
//           key:   KEY,
//           label: LABEL,
//           passed: true,
//           data: { liquidity },
//         }
//       : {
//           key:   KEY,
//           label: LABEL,
//           passed: false,
//           reason: "Low liquidity",
//           detail: `$${liquidity.toFixed(2)} < $${threshold}`,
//           data: { liquidity },
//         };
//   }

//   function storeAndReturn (result) {
//     CACHE.set(mint, { t: now, result });
//     return result;
//   }
// }

// module.exports = { checkBirdeyeLiquidity };
