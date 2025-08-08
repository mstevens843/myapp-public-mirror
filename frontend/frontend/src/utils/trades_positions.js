import { authFetch } from "@/utils/authFetch";

/** GET /api/trades — Fetch latest trades */
export async function getRecentTrades() {
  const res = await authFetch("/api/trades");
  return res.json();
}

/** GET /api/trades/history — windowed / paginated */
export async function getTradeHistory({ from, to, limit, offset } = {}) {
  const qs = new URLSearchParams();
  if (from)   qs.append("from",   from);
  if (to)     qs.append("to",     to);
  if (limit)  qs.append("limit",  limit);
  if (offset) qs.append("offset", offset);

  const res = await authFetch(`/api/trades/history?${qs.toString()}`);
  return res.json();
}

/** GET /api/trades/history — Fetch full trade history */
export async function getFullTradeHistory() {
  const res = await authFetch("/api/trades/history");
  return res.json();
}

/** GET /api/trades/download — Get CSV export */
export async function downloadTradeCSV({ from, to, strategy = "all", preset = "raw" }) {
  const qs = new URLSearchParams();
  if (from)      qs.append("from",      from);
  if (to)        qs.append("to",        to);
  if (strategy)  qs.append("strategy",  strategy);
  if (preset)    qs.append("preset",    preset);
  const res = await authFetch(`/api/trades/download?${qs.toString()}`);
  return res.text(); // CSV is text
}

/** GET /api/trades/recap — Daily PnL Summary */
export const fetchRecap = async () => {
  try {
    const res = await authFetch("/api/trades/recap");
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch (err) {
    console.error("❌ fetchRecap error:", err.message);
    return null;
  }
};

/** GET /api/trades/:strategy/logs — Last 20 trades for a strategy */
export async function getStrategyLogs(strategy) {
  const res = await authFetch(`/api/trades/${strategy}/logs`);
  return res.json();
}

/** POST /api/trades/reset — Clear all trade logs */
export async function resetTradeLogs() {
  const res = await authFetch("/api/trades/reset", {
    method: "POST",
  });
  return res.json();
}

/** GET /api/trades/positions — Token holdings + net worth */
export async function getPositions() {
  const res = await authFetch("/api/trades/positions");
  const json = await res.json();
  return json;  // must include .positions and .refetchOpenTrades
}

/** GET /api/trades/open — Active open trades */
export async function getOpenTrades() {
  const res = await authFetch("/api/trades/open");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to load open trades");
  }
  return res.json();
}

/** POST /api/trades/open — Log a new open trade */
export async function addOpenTrade(trade) {
  const res = await authFetch("/api/trades/open", {
    method: "POST",
    body: JSON.stringify(trade),
  });
  return res.json();
}

/** PATCH /api/trades/open/:mint — Update open trade (partial sell) */
export async function updateOpenTrade(mint, updateData) {
  const res = await authFetch(`/api/trades/open/${mint}`, {
    method: "PATCH",
    body: JSON.stringify(updateData),
  });
  return res.json();
}

/** DELETE /api/trades/open/:mint — Remove open trade after full sell */
export async function deleteOpenTrade(mint) {
  const res = await authFetch(`/api/trades/open/${mint}`, {
    method: "DELETE",
  });
  return res.json();
}

/** GET /api/portfolio — full simulated equity curve & stats */
export async function getPortfolioSummary() {
  const res = await authFetch("/api/portfolio");
  return res.json();
}

/* ──────────────────────────────────────────
   NEW: fetchCurrentPrice()
   – hits /positions once, caches for 60 s
─────────────────────────────────────────── */
let _priceCache = {};
let _cacheTS    = 0;

const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/**
 * 🔄 fetchCurrentPrice(mint)
 * Pulls from /api/trades/positions (cached 60s)
 */
export async function fetchCurrentPrice(mint) {
  const now = Date.now();

  // ✅ Return from cache if fresh
  if (_priceCache[mint] && now - _cacheTS < 60_000) {
    return _priceCache[mint];
  }

  try {
    const { positions } = await getPositions(); // ✅ backend hit, uses server cache
    positions.forEach((p) => {
      _priceCache[p.mint] = p.price ?? 0;
    });
    _cacheTS = now;
  } catch (err) {
    console.warn("⚠️ Failed to fetch positions for price lookup:", err.message);
  }

  // ✅ Fallback to known stable
  if (mint === USDC_MINT) return 1.0;

  return _priceCache[mint] ?? 0;
}

/** GET /api/portfolio/history */
export async function getNetWorthHistory() {
  const res = await authFetch("/api/portfolio/history");
  const data = await res.json();

  return data.map((p) => ({
    ...p,
    value: Number(((p.value ?? p.netWorth) || 0).toFixed(2)),
  }));
}

export async function getNetWorthToday() {
  const res = await authFetch("/api/portfolio/today");
  return res.json();
}

// 🔹 Net-worth summary helper
export async function getNetWorthSummary() {
  const res = await authFetch("/api/portfolio/summary");
  return res.json();
}

/** POST /api/trades/clear-dust — clears stuck trades */
export async function clearDustTrades(walletId = null) {
  const res = await authFetch("/api/trades/clear-dust", {
    method: "POST",
    body   : JSON.stringify({ walletId }),
    headers: { "Content-Type": "application/json" }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to clear dust");
  }
  return res.json();
}

/** DELETE /api/trades/open  — remove one or many mints */
export async function deleteOpenTrades(mints = [], forceDelete = false, walletId) {
  const res = await authFetch("/api/trades/open", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mints, walletId, forceDelete })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}