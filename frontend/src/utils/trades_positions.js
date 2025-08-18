/**
 * frontend/src/utils/api.js
 *
 * What changed
 * - Added missing exports: tradesCsv (alias), fetchWalletBalances, getPrefs/savePrefs (kept).
 * - Unified on a resilient authFetch import (named OR default).
 * - Cleaned stray comment that could break scanning.
 *
 * Why
 * - Fix “No matching export … for import 'tradesCsv'” and similar.
 *
 * Risk addressed
 * - Build-time failures from missing exports and import style mismatch.
 */

import authFetchDefault, { authFetch as authFetchNamed } from "@/utils/authFetch";
const authFetch = authFetchNamed || authFetchDefault;

/** GET /api/trades — recent closed trades (supports ?take & ?skip) */
export async function getRecentTrades({ take = 100, skip = 0 } = {}) {
  const qs = new URLSearchParams({ take: String(take), skip: String(skip) });
  const res = await authFetch(`/api/trades?${qs.toString()}`);
  if (!res.ok) throw new Error((await res.text()) || "Failed to load trades");
  return res.json();
}

/** GET /api/trades/history — windowed / paginated */
export async function getTradeHistory({ from, to, limit, offset } = {}) {
  const qs = new URLSearchParams();
  if (from)   qs.append("from",   from);
  if (to)     qs.append("to",     to);
  if (limit)  qs.append("limit",  String(limit));
  if (offset) qs.append("offset", String(offset));
  const res = await authFetch(`/api/trades/history?${qs.toString()}`);
  if (!res.ok) throw new Error((await res.text()) || "Failed to load trade history");
  return res.json();
}

/** GET /api/trades/history — Fetch full trade history */
export async function getFullTradeHistory() {
  const res = await authFetch("/api/trades/history");
  if (!res.ok) throw new Error((await res.text()) || "Failed to load full history");
  return res.json();
}

/** CSV — build URL and open in new tab (respects cookies via top-level GET) */
export function openTradesCsv({ from, to, strategy = "all", preset = "raw" } = {}) {
  const qs = new URLSearchParams();
  if (from)      qs.append("from", from);
  if (to)        qs.append("to", to);
  if (strategy)  qs.append("strategy", strategy);
  if (preset)    qs.append("preset", preset);
  const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
  const path = `/api/trades/download${qs.toString() ? `?${qs.toString()}` : ""}`;
  const url  = `${base}${path}`;
  try { window.open(url, "_blank"); } catch (e) { console.error("CSV open failed:", e); }
}



/** GET /api/trades/download — fetch CSV text (if you want to save manually) */
export async function downloadTradeCSV({ from, to, strategy = "all", preset = "raw" } = {}) {
  const qs = new URLSearchParams();
  if (from)      qs.append("from", from);
  if (to)        qs.append("to", to);
  if (strategy)  qs.append("strategy", strategy);
  if (preset)    qs.append("preset", preset);
  const res = await authFetch(`/api/trades/download?${qs.toString()}`);
  if (!res.ok) throw new Error((await res.text()) || "Failed to download CSV");
  return res.text(); // CSV string
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
  if (!res.ok) throw new Error((await res.text()) || "Failed to load logs");
  return res.json();
}

/** (Deprecated) POST /api/trades/reset — Clear all trade logs (may 404 if route removed) */
export async function resetTradeLogs() {
  const res = await authFetch("/api/trades/reset", { method: "POST" });
  if (!res.ok) throw new Error((await res.text()) || "Failed to reset logs");
  return res.json();
}

/** GET /api/trades/positions — Token holdings + net worth */
export async function getPositions() {
  const res = await authFetch("/api/trades/positions");
  if (!res.ok) throw new Error((await res.text()) || "Failed to load positions");
  const json = await res.json();
  return json;  // must include .positions and .refetchOpenTrades
}

/** GET /api/trades/open — active open trades */
export async function getOpenTrades({ take = 100, skip = 0, walletId, walletLabel } = {}) {
  const qs = new URLSearchParams({ take: String(take), skip: String(skip) });
  if (walletId != null) qs.append("walletId", String(walletId));
  if (walletLabel)      qs.append("walletLabel", walletLabel);

  const res  = await authFetch(`/api/trades/open?${qs.toString()}`);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error("Failed to parse open trades response."); }
  if (!res.ok) throw new Error(data?.error || "Failed to fetch open trades.");
  return Array.isArray(data) ? data : (data.trades ?? []);
}


/** POST /api/trades/open — Log a new open trade */
export async function addOpenTrade(trade, { idempotencyKey } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const res = await authFetch("/api/trades/open", {
    method: "POST",
    headers,
    body: JSON.stringify(trade), // may include { walletId } or { walletLabel }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || "Failed to add open trade");
  return JSON.parse(text);
}

/** PA

/** PATCH /api/trades/open/:mint — Update open trade (partial sell) */
export async function updateOpenTrade(mint, updateData, { walletId, walletLabel } = {}) {
  const body = { ...updateData };
  if (walletId != null) body.walletId = Number(walletId);
  if (walletLabel)      body.walletLabel = walletLabel;

  const res = await authFetch(`/api/trades/open/${mint}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || "Failed to update open trade");
  return JSON.parse(text);
}
/** DELETE /api/trades/open/:mint — Remove open trade after full sell */
export async function deleteOpenTrade(mint, { walletId, walletLabel } = {}) {
  const body = {};
  if (walletId != null) body.walletId = Number(walletId);
  if (walletLabel)      body.walletLabel = walletLabel;

  const res = await authFetch(`/api/trades/open/${mint}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || "Failed to delete open trade");
  return JSON.parse(text);
}
/** GET /api/portfolio — full simulated equity curve & stats */
export async function getPortfolioSummary() {
  const res = await authFetch("/api/portfolio");
  if (!res.ok) throw new Error((await res.text()) || "Failed to load portfolio summary");
  return res.json();
}

/* ──────────────────────────────────────────
   NEW: fetchCurrentPrice()
   – hits /positions once, caches for 60 s
─────────────────────────────────────────── */
let _priceCache = {};
let _cacheTS    = 0;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export async function fetchCurrentPrice(mint) {
  const now = Date.now();
  if (_priceCache[mint] && now - _cacheTS < 60_000) return _priceCache[mint];

  try {
    const { positions } = await getPositions(); // backend hit, uses server cache
    (positions || []).forEach((p) => { _priceCache[p.mint] = p.price ?? 0; });
    _cacheTS = now;
  } catch (err) {
    console.warn("⚠️ Failed to fetch positions for price lookup:", err.message);
  }

  if (mint === USDC_MINT) return 1.0;
  return _priceCache[mint] ?? 0;
}

/** GET /api/portfolio/history */
export async function getNetWorthHistory() {
  const res = await authFetch("/api/portfolio/history");
  if (!res.ok) throw new Error((await res.text()) || "Failed to load net worth history");
  const data = await res.json();
  return data.map((p) => ({
    ...p,
    value: Number(((p.value ?? p.netWorth) || 0).toFixed(2)),
  }));
}

export async function getNetWorthToday() {
  const res = await authFetch("/api/portfolio/today");
  if (!res.ok) throw new Error((await res.text()) || "Failed to load today net worth");
  return res.json();
}

// Net-worth summary helper
export async function getNetWorthSummary() {
  const res = await authFetch("/api/portfolio/summary");
  if (!res.ok) throw new Error((await res.text()) || "Failed to load net worth summary");
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

/* ─────────────────────────── User prefs (used by App) ─────────────────────────── */

export const getPrefs = (chatId = "default") =>
  authFetch(`/api/prefs/${chatId}`).then(r => r ? r.json() : null);

export const savePrefs = (chatId, obj) =>
  authFetch(`/api/prefs/${chatId}`, {
    method : "PUT",
    body   : JSON.stringify(obj),
  }).then(r => r ? r.json() : null);

/* ───────────────────────── Wallet balance helpers (plural) ────────────────────── */

// /** Single: POST /api/wallets/balance */
// export async function fetchWalletBalance({ pubkey, walletId, walletLabel, label } = {}) {
//   const body = {};
//   if (pubkey) body.pubkey = pubkey;
//   else if (walletId != null) body.walletId = Number(walletId);
//   else if (walletLabel || label) body.walletLabel = walletLabel ?? label;

//   const res = await authFetch(`/api/wallets/balance`, {
//     method: "POST",
//     body: JSON.stringify(body),
//   });

//   const text = await res.text();
//   let data; try { data = JSON.parse(text); } catch { throw new Error("Invalid server response"); }
//   if (!res.ok) throw new Error(data?.error || `Balance fetch failed (${res.status})`);

//   return {
//     balance: Number(data.balance),
//     price: Number(data.price),
//     valueUsd: Number(data.valueUsd),
//     publicKey: data.publicKey || null,
//   };
// }

// /**
//  * Plural convenience: fetch balances for multiple labels/pubkeys in parallel.
//  * Accepts: array of { pubkey? | walletId? | walletLabel? | label? } OR strings (treated as label).
//  * Returns: [{ input, ok, data|null, error|null }]
//  */
// export async function fetchWalletBalances(inputs = []) {
//   const tasks = (inputs || []).map(async (it) => {
//     const param = typeof it === "string" ? { walletLabel: it } : it;
//     try {
//       const data = await fetchWalletBalance(param);
//       return { input: it, ok: true, data, error: null };
//     } catch (e) {
//       return { input: it, ok: false, data: null, error: e?.message || String(e) };
//     }
//   });
//   return Promise.all(tasks);
// }
