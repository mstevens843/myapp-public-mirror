/**
 * Fetch helper that relies on HttpOnly cookies for auth.
 * Adds X-CSRF-Token header from csrf_token cookie on unsafe methods.
 */
const BASE = import.meta?.env?.VITE_API_BASE_URL || "";

function getCookie(name) {
  return document.cookie.split("; ").find(r => r.startsWith(name + "="))?.split("=")[1];
}

export async function authFetch(url, options = {}) {
  const opts = { credentials: "include", ...options };
  const method = (opts.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const csrf = getCookie("csrf_token");
    if (csrf) {
      opts.headers = { ...(opts.headers || {}), "X-CSRF-Token": csrf, "Content-Type": "application/json" };
    }
  }
  const res = await fetch(`${BASE}${url}`, opts);
  return res;
}

/**
 * 🔐 Fetch logged-in user's profile & session info
 * Includes:
 * - user.id, userId, type, createdAt
 * - activeWallet (id, label, publicKey)
 * - plan, subscriptionStatus, usage, usageResetAt, credits
 * - is2FAEnabled, preferences (tpSlEnabled, slippage, etc)
 */
export async function getUserProfile() {
  try {
    const res = await authFetch(`${BASE}/api/auth/me`);

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
  * checkTokenSafety(mint [, options])
  *  – options example: { skipSimulation: true, skipLiquidity: false }
  */
export async function checkTokenSafety(mint, options = {}) {
  try {
    const res = await authFetch(`${BASE}/api/safety/check-token-safety`, {
      method: "POST",
      body: JSON.stringify({ mint, options }),
    });
    const text = await res.text();            // 👈 read the stream ONCE
    let data;
    try {
      data = JSON.parse(text);                // ✅ parse once
    } catch {
      console.error("❌ Invalid JSON in response:", text);
      return null;
    }
    if (!res.ok) {
      console.error("❌ Token safety check error:", res.status, data?.error || text);
      return null;
    }
    return data;                              // ✅ return parsed result
  } catch (err) {
    console.error("❌ Token safety check failed:", err.message);
    return null;
  }
}



export async function getWalletNetworth() {
  // Use the configured API base if present, otherwise default to
  // relative path.  See BASE definition above for details.
  const res = await authFetch(`${BASE}/api/wallets/networth`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to fetch wallet net worth");
  }
  return await res.json();
}


// ✅ Add this:
export async function getTokenMarketStats(mint) {
  try {
    const res = await authFetch(`${BASE}/api/safety/${mint}`);
    if (!res.ok) throw new Error("Failed to fetch stats");

    return await res.json();
  } catch (err) {
    console.warn("Frontend getTokenMarketStats error:", err.message);
    return null;
  }
}


// ✅ Add this:
export async function getTokenMarketStatsPaid(mint) {
  try {
    const res = await authFetch(`${BASE}/api/safety/target-token/${mint}`)
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

  // ❌ No more manual throw if no walletLabel

  const body = {
    amountInSOL, mint, walletId, slippage, force, amountInUSDC,
    tp, sl, tpPercent, slPercent
  };
  if (chatId) body.chatId = chatId;
console.log("📤 manualBuy sending:", body);
  const res = await authFetch(`${BASE}/api/manual/buy`, {
    method: "POST",
    body: JSON.stringify(body),
  });

const data = await res.json();

if (res.status === 401 && data?.needsArm) {
  // let your UI open the Arm modal with this info
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

  const body = { percent, mint, walletLabel, walletId, slippage, force, strategy };
  if (chatId) body.chatId = chatId;

  const res = await authFetch(`${BASE}/api/manual/sell`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const data = await res.json();

  // 👇 Arm-to-Trade: trigger modal
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

  const body = { amount: amountInTokens, mint, walletLabel, walletId, slippage, force, strategy };
  if (chatId) body.chatId = chatId;

  const res = await authFetch(`${BASE}/api/manual/sell`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  const data = await res.json();

  // 👇 Arm-to-Trade: trigger modal
  if (res.status === 401 && data?.needsArm) {
    const err = new Error("needs-arm");
    err.code = "NEEDS_ARM";
    err.walletId = data.walletId;
    throw err;
  }

  if (!res.ok) throw new Error(data?.error || "Manual sell failed");
  return data.result;
}





// /** 🔍 Fetch tokens from any wallet by public key. future use.  */
// export async function fetchWalletTokens(walletPubkey) {
//   try {
//     const url = BASE
//       ? `${BASE}/api/wallets/tokens?wallet=${walletPubkey}`
//       : `/api/wallet/tokens?wallet=${walletPubkey}`;
    
//     const res = await authFetch(url);

//     if (!res.ok) {
//       const err = await res.text();
//       console.error("❌ fetchWalletTokens failed:", err);
//       throw new Error("Failed to fetch wallet tokens");
//     }

//     return await res.json();   // [{ mint, amount, decimals }]
//   } catch (err) {
//     console.error("❌ fetchWalletTokens:", err.message);
//     return [];
//   }
// }

/** 🔍 Fetch tokens for the default server-side wallet. uses default.txt */
export async function fetchDefaultWalletTokens() {
  try {
    const url = BASE
      ? `${BASE}/api/wallets/tokens/default`
      : "/api/wallets/tokens/default";   
    const res = await authFetch(url);

    if (!res.ok) {
      const err = await res.text();
      console.error("❌ Fetch failed:", err);
      throw new Error("Failed to fetch wallet tokens");
    }

    return await res.json();    // [{ mint, amount, decimals, name, symbol }]
  } catch (err) {
    console.error("❌ fetchDefaultWalletTokens:", err.message);
    return [];
  }
}

// fetch wallets for rotation bot. 
export async function fetchWalletLabels() {
  try {
    const url = BASE ? `${BASE}/api/wallets/labels` : "/api/wallets/labels";
    const res = await authFetch(url);
    if (!res.ok) throw new Error(await res.text());
    return await res.json();        // [{ label, pubkey }]
  } catch (err) {
    console.error("❌ fetchWalletLabels:", err.message);
    return [];
  }
}


// Fetch tokens for rotation bot, multiple wallet usecase. 
export async function fetchRotationWalletTokens(label) {
  try {
    const url = BASE
      ? `${BASE}/api/wallets/tokens/by-label?label=${encodeURIComponent(label)}`
      : `/api/wallets/tokens/by-label?label=${encodeURIComponent(label)}`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error(await res.text());
    return await res.json();               // same shape as default route
  } catch (err) {
    console.error("❌ fetchWalletTokens:", err.message);
    return [];
  }
}




/* ----- Limit & DCA ----- */
export const createLimitOrder = (body) => {
  console.log("📤 creating limit order", body);   // optional debug

  return authFetch(`${BASE}/api/orders/limit`, {
    method: "POST",
    body: JSON.stringify(body),
  }).then(r => r.json());
}

export const createDcaOrder = (body) =>
  authFetch(`${BASE}/api/orders/dca`, {
    method: "POST",
    body: JSON.stringify(body),
  }).then(r => r.json());

export const cancelOrder = (id) =>
  authFetch(`${BASE}/api/orders/cancel/${id}`, { method: "DELETE" })
    .then(r => r.json());

export const fetchPendingOrders = async () => {
  const [dcaRes, limitRes] = await Promise.all([
    authFetch(`${BASE}/api/orders/pending-dca`).then(r => r.json()),
    authFetch(`${BASE}/api/orders/pending-limit`).then(r => r.json()),
  ]);
  const dca   = Array.isArray(dcaRes) ? dcaRes : [];
  const limit = Array.isArray(limitRes) ? limitRes : [];
  return [...dca, ...limit];
};

/* ----- TP / SL ----- */
export const updateTpSl = (mint, body) => {
  // calculate combined sellPct
  const combinedSellPct = (body.tpPercent || 0) + (body.slPercent || 0);

  return authFetch(`${BASE}/api/tpsl/${mint}`, {
    method: "PUT",
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






export async function manualSnipe(mint, amountInSOL = 0.25) {
  try {
    const res = await authFetch(`${BASE}/api/manual/snipe`, {
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
  return authFetch(`${BASE}/api/tpsl?walletId=${id}`)
    .then((res) => res.json())
    .catch((err) => {
      console.error("❌ Failed to fetch TP/SL settings:", err.message);
      return [];
    });
};

    

export const deleteTpSlSetting = (id) => {
  if (!id) throw new Error("deleteTpSlSetting needs an id");

  return authFetch(`${BASE}/api/tpsl/by-id/${id}`, {
    method: "DELETE"
  }).then(async (r) => {
    if (!r.ok) throw new Error((await r.text()) || "Failed to delete TP/SL");
    return r.json();
  });
};
    
 ///tp: body.tp != null ? Number(body.tp) : null,

/* … existing exports … */

/* ------------------------------------------------------------------ */
/* 🆕  user-prefs helpers */
export const getPrefs = (chatId = "default") =>
  authFetch(`${BASE}/api/prefs/${chatId}`).then(r => {
    if (!r) {
      console.log("🚫 getPrefs skipped because no token or fetch returned null.");
      return null;
    }
    return r.json();
  });

export const savePrefs = (chatId, obj) =>
  authFetch(`${BASE}/api/prefs/${chatId}`, {
    method : "PUT",
    body   : JSON.stringify(obj),
  }).then(r => {
    if (!r) {
      console.log("🚫 savePrefs skipped because no token or fetch returned null.");
      return null;
    }
    return r.json();
  });


export async function checkExistingPosition(mint, strategy = "manual") {
  if (!mint || !strategy) return false;

  try {
    const res = await authFetch(`${BASE}/api/tpsl/check-position?mint=${mint}&strategy=${strategy}`);
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
    const res = await authFetch(`${BASE}/api/wallets/${walletId}/tokens`);
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
    const res = await authFetch(`${BASE}/api/wallets/validate-mint`, {
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