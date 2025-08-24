/**
 * Frontend API helpers — unified on shared authFetch (no local BASE).
 */

import authFetch, { setBaseUrl } from "./authFetch";

// If you prefer, move this to app bootstrap (e.g., main.tsx) instead:
setBaseUrl(import.meta.env.VITE_API_BASE_URL || "");

/**
 * 🔐 Fetch logged-in user's profile & session info
 * Includes:
 * - user.id, userId, type, createdAt
 * - activeWallet (id, label, publicKey)
 * - plan, subscriptionStatus, usage, usageResetAt, credits
 * - is2FAEnabled, preferences (tpSlEnabled, slippage, etc)
 */
export async function getUserProfile(initialProfile = null) {
  try {
    // 🆕 If caller already has a profile from login, skip the fetch
    if (initialProfile) {
      return initialProfile;
    }

    let res = await authFetch('/api/auth/me', {
      headers: { 'Cache-Control': 'no-cache' },
    });

    // Some dev proxies still return 304. Force a fresh read once.
    if (res.status === 304) {
      res = await authFetch(`/api/auth/me?ts=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' }
      });
    }

    if (!res) {
      console.warn("No response from /auth/me – user probably not logged in.");
      return null;
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ Invalid JSON from /auth/me:", text);
      return null;
    }

    if (!res.ok) {
      console.error("❌ /auth/me error:", res.status, data?.error || text);
      return null;
    }

    return data;
  } catch (err) {
    console.error("❌ getUserProfile failed:", err.message);
    return null;
  }
}

/**
 * 🆕 fetchWalletBalance(opts)
 * POST /api/wallets/balance
 * Options (by priority):
 *   { pubkey } | { walletId } | { walletLabel } | { label } | string (label)
 * Returns: { balance:Number, price:Number, valueUsd:Number, publicKey:String }
 */
export async function fetchWalletBalances(input) {
  try {
    let body = {};

    if (!input) {
      // Allow backend to resolve the user's active wallet
      body = {};
    } else if (typeof input === "string") {
      const s = input.trim();
      // If it looks like a base58 pubkey, send as pubkey; else treat as label
      const looksLikePubkey = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
      body = looksLikePubkey ? { pubkey: s } : { walletLabel: s };
    } else if (typeof input === "object") {
      const { pubkey, publicKey, walletId, walletLabel, label } = input;
      if (pubkey || publicKey) body.pubkey = (pubkey ?? publicKey).toString();
      else if (walletId != null) body.walletId = Number(walletId);
      else if (walletLabel || label) body.walletLabel = (walletLabel ?? label).toString();
      else body = {}; // fallback to active wallet
    } else {
      throw new Error("Invalid argument for fetchWalletBalances");
    }

    const res = await authFetch(`/api/wallets/balance`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch {
      console.error("❌ /wallets/balance → non-JSON:", text);
      throw new Error("Invalid server response");
    }

    if (!res.ok) {
      throw new Error(data?.error || `Balance fetch failed (${res.status})`);
    }

    return {
      balance: Number(data.balance),
      price: Number(data.price),
      valueUsd: Number(data.valueUsd),
      publicKey: data.publicKey || null,
    };
  } catch (err) {
    console.error("❌ fetchWalletBalance failed:", err.message);
    throw err;
  }
}




/** Safe wrapper that returns null instead of throwing. */
export async function fetchWalletBalanceSafe(opts = {}) {
  try { return await fetchWalletBalances(opts); }
  catch { return null; }
}


/**
 * checkTokenSafety(mint [, options])
 * – options example: { skipSimulation: true, skipLiquidity: false }
 */
export async function checkTokenSafety(mint, options = {}) {
  try {
    const res = await authFetch("/api/safety/check-token-safety", {
      method: "POST",
      body: JSON.stringify({ mint, options }),
    });
    const text = await res.text();
   if (!text && res.status === 304) {
     // Gracefully handle empty 304 if it ever sneaks through again
     return null;
   }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ Invalid JSON in response:", text);
      return null;
    }
    if (!res.ok) {
      console.error("❌ Token safety check error:", res.status, data?.error || text);
      return null;
    }
    return data;
  } catch (err) {
    console.error("❌ Token safety check failed:", err.message);
    return null;
  }
}

export async function getWalletNetworth() {
  const res = await authFetch("/api/wallets/networth");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to fetch wallet net worth");
  }
  return await res.json();
}


// utils/api.js (add)
let _nfInFlight = null;
let _nfCache = null;
let _nfUntil = 0;

export async function getWalletSnapshotShared() {
  const now = Date.now();
  if (_nfCache && now < _nfUntil) return _nfCache;
  if (_nfInFlight) return _nfInFlight;

  _nfInFlight = getWalletNetworth()
    .then((d) => {
      _nfCache = d;
      _nfUntil = Date.now() + 1000; // small client micro-TTL
      return d;
    })
    .finally(() => { _nfInFlight = null; });

  return _nfInFlight;
}

export async function getTokenMarketStats(mint) {
  try {
    const res = await authFetch(`/api/safety/${mint}`);
    if (!res.ok) throw new Error("Failed to fetch stats");
    return await res.json();
  } catch (err) {
    console.warn("Frontend getTokenMarketStats error:", err.message);
    return null;
  }
}

export async function getTokenMarketStatsPaid(mint) {
  try {
    const res = await authFetch(`/api/safety/target-token/${mint}`);
    if (!res.ok) throw new Error("Failed to fetch stats");
    return await res.json();
  } catch (err) {
    console.warn("Frontend getTokenMarketStats error:", err.message);
    return null;
  }
}

/** 🔁 SOL → any token (amount in SOL) */
export async function manualBuy(amountInSOL, mint, opts = {}) {
  const {
    walletLabel,
    walletId,
    slippage = 1.0,
    chatId = null,
    force = true,
    amountInUSDC,
    tp,
    sl,
    tpPercent,
    slPercent,
  } = opts;

  // one key per user click; reused for any internal retries
  const idemKey =
    (typeof window !== "undefined" &&
     window.crypto &&
     typeof window.crypto.randomUUID === "function")
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const body = {
    amountInSOL, mint, walletId, slippage, force, amountInUSDC,
    tp, sl, tpPercent, slPercent
  };
  if (chatId) body.chatId = chatId;

  const res = await authFetch("/api/manual/buy", {
    method: "POST",
    headers: { "Idempotency-Key": idemKey },
    body: JSON.stringify(body),
    timeoutMs: 90000,
  });

  const data = await res.json();

  if (res.status === 401 && data?.needsArm) {
    const err = new Error("needs-arm");
    err.code = "NEEDS_ARM";
    err.walletId = data.walletId;
    throw err;
  }

  if (res.status === 403 && data?.error?.includes("not tradable")) {
    throw new Error("not-tradable");
  }

  if (!res.ok) {
    throw new Error(data?.error || "Manual buy failed");
  }

  return data.result;
}





/** 🔁 Sell by PERCENT of balance (0–1) */
export async function manualSell(percent, mint, opts = {}) {
  const {
    walletLabel,
    walletId,
    slippage = 1.0,
    chatId = null,
    force = true,
    strategy = "manual",
  } = opts;


    // one key per user click; reused for any internal retries
  const idemKey =
    (typeof window !== "undefined" &&
     window.crypto &&
     typeof window.crypto.randomUUID === "function")
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;


  const body = { percent, mint, walletLabel, walletId, slippage, force, strategy };
  if (chatId) body.chatId = chatId;

  const res = await authFetch("/api/manual/sell", {
    method: "POST",
    headers: { "Idempotency-Key": idemKey },
    body: JSON.stringify(body),
    timeoutMs: 90000,
  });

  const data = await res.json();

  if (res.status === 401 && data?.needsArm) {
    const err = new Error("needs-arm");
    err.code = "NEEDS_ARM";
    err.walletId = data.walletId;
    throw err;
  }

  if (!res.ok) throw new Error(data?.error || "Manual sell failed");
  return data.result;
}



/** 🔁 Sell by EXACT amount of tokens (e.g. all USDC) */
export async function manualSellAmount(amountInTokens, mint, opts = {}) {
  const {
    walletLabel,
    walletId,
    slippage = 1.0,
    chatId = null,
    force = true,
    strategy = "manual",
  } = opts;

  const idemKey =
    (typeof window !== "undefined" &&
     window.crypto &&
     typeof window.crypto.randomUUID === "function")
      ? window.crypto.randomUUID()
      : `sell-${Date.now()}-${Math.random().toString(16).slice(2)}`;


  const body = { amount: amountInTokens, mint, walletLabel, walletId, slippage, force, strategy };
  if (chatId) body.chatId = chatId;

  const res = await authFetch("/api/manual/sell", {
    method: "POST",
    headers: { "Idempotency-Key": idemKey },
    body: JSON.stringify(body),
    timeoutMs: 90000,
  });

  const data = await res.json();

  if (res.status === 401 && data?.needsArm) {
    const err = new Error("needs-arm");
    err.code = "NEEDS_ARM";
    err.walletId = data.walletId;
    throw err;
  }

  if (!res.ok) throw new Error(data?.error || "Manual sell failed");
  return data.result;
}







/** 🔍 Fetch tokens for the default server-side wallet (uses default.txt) */
export async function fetchDefaultWalletTokens() {
  try {
    const res = await authFetch("/api/wallets/tokens/default");
    if (!res.ok) {
      const err = await res.text();
      console.error("❌ Fetch failed:", err);
      throw new Error("Failed to fetch wallet tokens");
    }
    return await res.json(); // [{ mint, amount, decimals, name, symbol }]
  } catch (err) {
    console.error("❌ fetchDefaultWalletTokens:", err.message);
    return [];
  }
}

/** 🔎 Fetch wallet labels (rotation bot) */
export async function fetchWalletLabels() {
  try {
    const res = await authFetch("/api/wallets/labels");
    if (!res.ok) throw new Error(await res.text());
    return await res.json(); // [{ label, pubkey }]
  } catch (err) {
    console.error("❌ fetchWalletLabels:", err.message);
    return [];
  }
}

/** 🔍 Fetch tokens by wallet label (rotation use case) */
export async function fetchRotationWalletTokens(label) {
  try {
    if (!label) {
      console.warn("⚠️ fetchRotationWalletTokens: missing label");
      return [];
    }
    const res = await authFetch(`/api/wallets/tokens/by-label?label=${encodeURIComponent(label)}`);
    if (!res.ok) throw new Error(await res.text());
    return await res.json(); // same shape as default route
  } catch (err) {
    console.error("❌ fetchWalletTokens:", err.message);
    return [];
  }
}

/* ----- Limit & DCA ----- */
export const createLimitOrder = (body) => {
  console.log("📤 creating limit order", body);
  return authFetch("/api/orders/limit", {
    method: "POST",
    body: JSON.stringify(body),
  }).then(r => r.json());
};

export const createDcaOrder = async (body) => {
  const r = await authFetch("/api/orders/dca", {
    method: "POST",
    body: JSON.stringify(body),
  });
  let data = null;
  try { data = await r.json(); } catch (_) { data = {}; }
  if (!r.ok) {
    const msg = data?.error || data?.message || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
};



export const cancelOrder = (id) =>
  authFetch(`/api/orders/cancel/${id}`, { method: "DELETE" })
    .then(r => r.json());

export const fetchPendingOrders = async () => {
  const [dcaRes, limitRes] = await Promise.all([
    authFetch("/api/orders/pending-dca").then(r => r.json()),
    authFetch("/api/orders/pending-limit").then(r => r.json()),
  ]);
  const dca   = Array.isArray(dcaRes) ? dcaRes : [];
  const limit = Array.isArray(limitRes) ? limitRes : [];
  return [...dca, ...limit];
};



export const updateTpSl = (mint, body) => {
  const combinedSellPct = (body.tpPercent || 0) + (body.slPercent || 0);
  const idemKey =
    (typeof window !== "undefined" &&
      window.crypto &&
      typeof window.crypto.randomUUID === "function")
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return authFetch(`/api/tpsl/${mint}`, {
    method: "PUT",
    headers: { "Idempotency-Key": idemKey },
    body: JSON.stringify({
      mint,
      walletId: Number(body.walletId),
      strategy: body.strategy || "manual",
      tp: body.tp,
      sl: body.sl,
      tpPercent: body.tpPercent,
      slPercent: body.slPercent,
      sellPct: combinedSellPct,
      force: body.force ?? true,
    }),
  }).then(async (r) => {
    if (!r.ok) {
      const err = await r.text();
      throw new Error(err || "Failed to update TP/SL");
    }
    return r.json();
  });
};

export const updateTpSlById = (id, body) => {
  return authFetch(`/api/tpsl/by-id/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      tp: body.tp,
      sl: body.sl,
      tpPercent: body.tpPercent,
      slPercent: body.slPercent,
      strategy: body.strategy || "manual",
    }),
  }).then(async (r) => {
    if (!r.ok) {
      const err = await r.text();
      throw new Error(err || "Failed to update TP/SL by id");
    }
    return r.json();
  });
};

export async function manualSnipe(mint, amountInSOL = 0.25) {
  try {
    const res = await authFetch("/api/manual/snipe", {
      method: "POST",
      body: JSON.stringify({ mint, amountInSOL }),
    });
    return await res.json();
  } catch (err) {
    console.error("❌ Manual snipe failed:", err.message);
    return null;
  }
}

/** ⚙️ Load default TP/SL settings */
export const fetchTpSlSettings = (walletId) => {
  const id = Number(walletId);
  return authFetch(`/api/tpsl?walletId=${id}`)
    .then((res) => res.json())
    .catch((err) => {
      console.error("❌ Failed to fetch TP/SL settings:", err.message);
      return [];
    });
};

export const deleteTpSlSetting = (id) => {
  if (!id) throw new Error("deleteTpSlSetting needs an id");
  return authFetch(`/api/tpsl/by-id/${id}`, {
    method: "DELETE"
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.text()) || "Failed to delete TP/SL");
    return r.json();
  });
};

/* ------------------------------------------------------------------ */
/* 🆕  user-prefs helpers */
export const getPrefs = (chatId = "default") =>
  authFetch(`/api/prefs/${chatId}`).then(r => {
    if (!r) {
      console.log("🚫 getPrefs skipped because no auth session or fetch returned null.");
      return null;
    }
    return r.json();
  });

export const savePrefs = (chatId, obj) =>
  authFetch(`/api/prefs/${chatId}`, {
    method : "PUT",
    body   : JSON.stringify(obj),
  }).then(r => {
    if (!r) {
      console.log("🚫 savePrefs skipped because no auth session or fetch returned null.");
      return null;
    }
    return r.json();
  });

export async function checkExistingPosition(mint, strategy = "manual") {
  if (!mint || !strategy) return false;
  try {
    const res = await authFetch(`/api/tpsl/check-position?mint=${mint}&strategy=${strategy}`);
    if (!res) return false;
    if (!res.ok) {
      const text = await res.text();
      console.error("❌ checkExistingPosition failed:", text);
      return false;
    }
    const data = await res.json();
    return !!data.exists;
  } catch (err) {
    console.error("❌ checkExistingPosition error:", err.message);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 🆕  fetch tokens by walletId (for RebalancerConfig or others) */
export async function fetchWalletTokens(walletId) {
  if (!walletId) {
    console.error("❌ fetchWalletTokens: Missing walletId");
    return [];
  }
  try {
    const res = await authFetch(`/api/wallets/${walletId}/tokens`);
    console.log("📡 [fetchWalletTokens] Raw response object:", res);

    if (!res) {
      console.warn("🚫 fetchWalletTokens: No response — likely auth failure or server is offline.");
      return [];
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      console.error("🧨 JSON PARSE ERROR — Response was not valid JSON");
      console.error("❌ Raw response text:", text);
      return [];
    }

    if (!res.ok) {
      console.error("❌ Server returned error:", res.status);
      console.error("📭 Response body:", data);
      return [];
    }

    if (!Array.isArray(data)) {
      console.warn("⚠️ Unexpected data format — expected array but got:", typeof data, data);
      return [];
    }

    console.log(`📦 Received ${data.length} wallet tokens:`);
    for (const token of data) {
      console.log("🔍 Token:", JSON.stringify(token, null, 2));
    }

    return data;
  } catch (err) {
    console.error("❌ fetchWalletTokens failed:", err.message);
    console.error("🧱 Full error object:", err);
    return [];
  }
}

export async function validateMint(mint) {
  const isValidFormat = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || "");
  if (!isValidFormat) {
    return { ok: false, reason: "format" };
  }
  try {
    const res = await authFetch(`/api/wallets/validate-mint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, reason: body.reason || "invalid" };
    }
    const data = await res.json();
    return {
      ok: true,
      symbol: data.symbol || "",
      name: data.name || "",
    };
  } catch (err) {
    console.error("validateMint error:", err.message);
    return { ok: false, reason: "network" };
  }
}
