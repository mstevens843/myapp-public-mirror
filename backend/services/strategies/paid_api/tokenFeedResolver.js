/* 
 * ────────────────────────────────────────────────────────────────────
 * ONE place that turns   {strategyName, cfg}   →   [mint,…]
 *
 * Notes:
 * - Uses your new Token_Lists helpers exclusively (no old “prefiltered” fns).
 * - All helpers return full token objects; we standardize to mints via toMint().
 */

const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const toMint = (t) =>
  typeof t === "string"
    ? t
    : t?.address || t?.mint || t?.mintAddress || t?.tokenAddress || null;

/*  Paid-API helpers (keep these paths as they exist in your repo) */
const getNewListings                        = require("./Token_Lists/getNewListings");
const getTrendingTokensList                 = require("./Token_Lists/getTrendingTokensList");
const getHighLiquidityList                  = require("./Token_Lists/getHighLiquidityList");
const getMidCapGrowthList                   = require("./Token_Lists/getMidCapGrowthList");
const getPriceSurgeList                     = require("./Token_Lists/getPriceSurgeList");
const getVolumeSpikeList                    = require("./Token_Lists/getVolumeSpikeList");
const getHighTradeCountList                 = require("./Token_Lists/getHighTradeCountList");
const getRecentlyListedGoodLiquidityList    = require("./Token_Lists/getRecentlyListedGoodLiquidityList");

/* 🧠 Feed fallback map per strategy (unchanged unless you want different defaults) */
const DEFAULTS = {
  sniper:        "new",
  delayedsniper: "new",
  scalper:       "trending",
  breakout:      "trending",
  trendfollower: "trending",
  dipbuyer:      "trending",
  rotationbot:   "all",       // handled below
  papertrader:   "new",
};

/* Centralized fetchers for each feed key */
const FETCHERS = {
  /* Core */
  "new":                   (u) => getNewListings(u, 20, true),
  "trending":              (u) => getTrendingTokensList(u, 20),
  /* New lists you provided */
  "high-liquidity":        (u) => getHighLiquidityList(u, 20),
  "mid-cap-growth":        (u) => getMidCapGrowthList(u, 20),
  "price-surge":           (u) => getPriceSurgeList(u, 20),
  "volume-spike":          (u) => getVolumeSpikeList(u, 20),
  "high-trade":            (u) => getHighTradeCountList(u, 20),
  "recent-good-liquidity": (u) => getRecentlyListedGoodLiquidityList(u, 20),
};

/* Build a list from a single feed key */
async function fetchFeed(userId, src) {
  if (src === "all") {
    // “All” is a sane union without exploding CU:
    // combine trending + high-liquidity + mid-cap-growth
    const [a, b, c] = await Promise.all([
      FETCHERS["trending"]?.(userId) || [],
      FETCHERS["high-liquidity"]?.(userId) || [],
      FETCHERS["mid-cap-growth"]?.(userId) || [],
    ]);
    return uniq([...a, ...b, ...c].map(toMint));
  }

  const fn = FETCHERS[src];
  if (!fn) return [];
  try {
    const tokens = await fn(userId);
    return uniq((tokens || []).map(toMint));
  } catch (e) {
    console.warn(`[resolver] feed "${src}" failed:`, e?.message || e);
    return [];
  }
}

/**
 * Resolve the final mint list used by a strategy tick.
 * Precedence:
 *   1) cfg.overrideMonitored === true → ONLY use monitoredTokens
 *   2) Otherwise, fetch from API feed (cfg.tokenFeed || DEFAULTS[strategy])
 *      and merge with monitoredTokens (deduped)
 */
module.exports = async function tokenFeedResolver(strategyName, cfg = {}, userId = null) {
  const mon = Array.isArray(cfg.monitoredTokens) ? cfg.monitoredTokens.map(toMint) : [];

  console.log("[resolver] ⚙️  cfg.tokenFeed:", cfg.tokenFeed);
  console.log("[resolver] 🧪 cfg.monitoredTokens:", cfg.monitoredTokens);
  console.log("[resolver] 🧪 cfg.overrideMonitored:", cfg.overrideMonitored);

  /* 1️⃣ hard override */
  if (cfg.overrideMonitored && mon.length) return uniq(mon);

  const feedKey = cfg.tokenFeed || DEFAULTS[strategyName] || "trending";
  const apiMints = await fetchFeed(cfg.userId || userId, feedKey);

  console.log("[resolver] 📥 apiMints from", feedKey, "=", apiMints);
  console.log("[resolver] 🧾 Final mint list:", [...apiMints, ...mon]);

  return uniq([...apiMints, ...mon]);
};

/*
We return full token objects from helpers like getNewListings() and getTrendingTokensList()
because they’re reused elsewhere; the resolver normalizes them to mint strings only.
*/
