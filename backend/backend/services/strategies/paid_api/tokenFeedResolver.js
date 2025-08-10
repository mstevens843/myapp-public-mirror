/* backend/utils/tokenFeedResolver.js
 * ─────────────────────────────────
 * ONE place that turns   {strategyName,cfg}   →   [mint,…]
 */
const uniq = (arr) => [...new Set(arr)];

/* paid-API helpers (keep the paths that exist in your repo) */
const getNewListings               = require("./Token_Lists/getNewListings");
const getTrendingTokensList       = require("./Token_Lists/getTrendingTokensList");
// const prefilteredTrendingList     = require("./Token_Lists/getTrendingCoins");
// const prefilteredTokenAgeList     = require("./Token_Lists/getBirdeyNew");
// const prefilteredTopGainersList   = require("./Token_Lists/getTopGainers");

/* 🧠 Feed fallback map per strategy */
const DEFAULTS = {
  sniper:        "new",
  delayedsniper: "new",
  scalper:       "trending",
  breakout:      "trending",
  trendfollower: "trending",
  dipbuyer:      "trending",
  rotationbot:   "all",
  papertrader:   "new",
};

async function fetchFeed(userId, src) {
  switch (src) {
    case "new":
      return (await getNewListings(userId, 20, true)).map((t) => t.address);
    case "trending":
      return (await getTrendingTokensList(userId, 20)).map((t) => t.address);
    case "top-gainers-prefiltered":
      return (await prefilteredTopGainersList(userId, 20)).map((t) => t.address);
    case "new-prefiltered":
      return (await prefilteredTokenAgeList(userId, 20)).map((t) => t.address);
     case "trending-prefiltered":
      return (await prefilteredTrendingList(userId, 50)).map((t) => t.address); // ✅ FIXED
    default:
      return [];
  }
}

/**
 * Resolve the final mint list used by a strategy tick.
 * Precedence:
 *   1. cfg.overrideMonitored === true → ONLY use monitoredTokens
 *   2. Otherwise, fetch from API feed (cfg.tokenFeed || DEFAULTS[strategy])
 *      and merge with monitoredTokens (deduped)
 */
module.exports = async function tokenFeedResolver(strategyName, cfg = {}, userId = null) {
  const mon = Array.isArray(cfg.monitoredTokens) ? cfg.monitoredTokens : [];

  console.log("[resolver] ⚙️  Received cfg.tokenFeed:", cfg.tokenFeed);
  console.log("[resolver] 🧪 cfg.monitoredTokens:", cfg.monitoredTokens);
  console.log("[resolver] 🧪 cfg.overrideMonitored:", cfg.overrideMonitored);

  /* 1️⃣ hard override */
  if (cfg.overrideMonitored && mon.length) return uniq(mon);

  const feed = cfg.tokenFeed || DEFAULTS[strategyName] || "trending";
  const apiMints = await fetchFeed(cfg.userId || userId, feed);

  console.log("[resolver] 📥 apiMints from", feed, "=", apiMints);
  console.log("[resolver] 🧾 Final mint list:", [...apiMints, ...mon]);

  return uniq([...apiMints, ...mon]);
};


//**
// We return full token objects from getNewListings() and getTrendingTokensList() because they’re reused elsewhere.
// We return mints only from getFreshTokenList() because it’s a sniper-focused function, not a general-purpose token fetcher.
// 
//  */