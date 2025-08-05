// // backend/services/strategies/api/tokenListCache.js

// const axios = require("axios");
// const { strategyLog } = require("../logging/strategyLogger");  // ✅ Logging into Mini Console
// const log = strategyLog("tokenCache", "sys");

// let cachedTokenList = [];
// let lastFetched = 0;
// const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// async function fetchCachedTokenList() {
//   const now = Date.now();

//   // ✅ Use cache if still fresh
//   if (cachedTokenList.length && now - lastFetched < CACHE_TTL) {
//     log("info", `🧠 Using cached list (${cachedTokenList.length} tokens, ${(now - lastFetched) / 1000}s old)`);
//     return cachedTokenList;
//   }

//   log("info", "🌐 Cache expired/empty — fetching from Jupiter…");

//   try {
//     const res = await axios.get("https://quote-api.jup.ag/v6/tokens");
//     const tokens = res.data;

//     if (!Array.isArray(tokens) || !tokens.length) {
//       log("warn", "⚠️ Token list response invalid or empty");
//       return cachedTokenList.length ? cachedTokenList : [];
//     }

//     // 🧠 If array contains strings, use directly as mints
//     if (typeof tokens[0] === "string") {
//       cachedTokenList = tokens;
//     } else {
//       // 🧠 Otherwise extract addresses from token objects
//       cachedTokenList = tokens.map((t) => t.address).filter(Boolean);
//     }

//     lastFetched = now;

//     log("info", `✅ Token list refreshed — ${cachedTokenList.length} valid mints`);
//     log("debug", `🧪 Sample token: ${JSON.stringify(tokens[0])?.slice(0, 200)}…`);
//     return cachedTokenList;
//   } catch (err) {
//     log("error", `🚨 fetchCachedTokenList() failed: ${err.message}`);

//     if (cachedTokenList.length) {
//       log("warn", "🔁 Returning stale cached token list as fallback");
//     } else {
//       log("error", "❌ No cached token list available — returning empty array");
//     }

//     return cachedTokenList.length ? cachedTokenList : [];
//   }
// }

// module.exports = {
//   fetchCachedTokenList,
// };
