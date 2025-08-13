// src/utils/encryptedWalletSession.js
// Default to empty string when VITE_API_BASE_URL is not defined. Leaving
// this undefined will produce literal "undefined/..." URLs at runtime.
const BASE = import.meta.env.VITE_API_BASE_URL || "";

import { authFetch } from "./authFetch";

/** ─────────────────────────────────────────────────────────────
 * Existing pattern reference (kept here so you can co-locate if desired)
 * checkVaultBalance({ phantomPublicKey })
 * ──────────────────────────────────────────────────────────── */
export async function checkVaultBalance(payload) {
  try {
    // Use authFetch so cookies and CSRF tokens are automatically sent.
    const res = await authFetch(`/api/auth/vault-balance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ checkVaultBalance → Invalid JSON:", text);
      return null;
    }
    if (!res.ok) {
      console.error("❌ checkVaultBalance → Failed:", res.status, data?.error || text);
      return null;
    }
    return data;
  } catch (err) {
    console.error("❌ checkVaultBalance → Request error:", err.message);
    return null;
  }
}

/** ─────────────────────────────────────────────────────────────
 * Encrypted Wallet Session (Arm-to-Trade) client
 * Backend routes are assumed to live under /api/arm-encryption/*.
 * For the new Auto-Return feature we try both the current endpoints and
 * legacy aliases so the frontend works regardless of where they’re mounted.
 * ──────────────────────────────────────────────────────────── */

async function httpJson(path, init = {}) {
  const res = await authFetch(path, init);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* leave as null */
  }
  if (!res.ok) {
    const msg = data?.error || res.statusText || "Request failed";
    throw new Error(msg);
  }
  return data;
}

// Try a list of endpoints until one works (first successful JSON)
async function httpJsonTry(paths, init = {}) {
  let lastErr;
  for (const p of paths) {
    try {
      return await httpJson(p, init);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("No endpoint available");
}

export async function getArmStatus(walletId) {
  return httpJson(`/api/arm-encryption/status/${walletId}`, {
    method: "GET",
  });
}

export async function armEncryptedWallet({
  walletId,
  passphrase,
  twoFactorToken, // 2FA code (middleware typically expects req.body.twoFactorToken)
  ttlMinutes, // optional; backend clamps/defaults
  migrateLegacy = false, // set true to upgrade legacy colon-hex on the fly
  applyToAll = false,
  passphraseHint,
  forceOverwrite = false,
  // ── NEW: Auto-Return at session end
  autoReturnOnEnd = false, // checkbox in Arm modal
  autoReturnDest, // optional override of saved safe wallet pubkey
}) {
  const payload = {
    walletId,
    passphrase,
    ttlMinutes,
    twoFactorToken,
    migrateLegacy,
  };
  // Only include optional params if defined to avoid overwriting defaults
  if (applyToAll) payload.applyToAll = true;
  if (typeof passphraseHint === "string" && passphraseHint.trim() !== "") {
    payload.passphraseHint = passphraseHint;
  }
  if (forceOverwrite) payload.forceOverwrite = true;

  // Send both shapes so it works with either controller signature
  // 1) Nested object
  payload.autoReturn = {
    enabled: !!autoReturnOnEnd,
    destPubkey: autoReturnDest || undefined,
  };
  // 2) Flat flags (fallbacks used by some handlers)
  payload.autoReturnEnabled = !!autoReturnOnEnd;
  if (autoReturnDest) payload.destOverride = autoReturnDest;

  return httpJson(`/api/arm-encryption/arm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function extendEncryptedWallet({ walletId, twoFactorToken, ttlMinutes }) {
  return httpJson(`/api/arm-encryption/extend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletId, ttlMinutes, twoFactorToken }),
  });
}

export async function disarmEncryptedWallet({ walletId, twoFactorToken }) {
  return httpJson(`/api/arm-encryption/disarm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletId, twoFactorToken }),
  });
}

/**
 * Set up pass-phrase protection for a wallet.
 *
 * This helper calls the backend endpoint that upgrades an unprotected or
 * legacy wallet to use envelope encryption with the provided passphrase.
 * It does not unlock the wallet for trading – after setup you must call
 * armEncryptedWallet() separately to create a timed session.
 * 2FA codes are never required when setting up protection.
 */
export async function setupWalletProtection({
  walletId,
  passphrase,
  applyToAll = false,
  passphraseHint,
  forceOverwrite = false,
}) {
  const payload = { walletId, passphrase };
  if (applyToAll) payload.applyToAll = true;
  if (typeof passphraseHint === "string" && passphraseHint.trim() !== "") {
    payload.passphraseHint = passphraseHint;
  }
  if (forceOverwrite) payload.forceOverwrite = true;
  return httpJson(`/api/arm-encryption/setup-protection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Remove pass-phrase protection from a wallet. The caller must supply
 * the walletId and the current passphrase.
 */
export async function removeWalletProtection({ walletId, passphrase }) {
  const payload = { walletId, passphrase };
  return httpJson(`/api/arm-encryption/remove-protection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// Protected Mode toggle at user-level (requireArmToTrade)
export async function setRequireArmToTrade(requireArm) {
  return httpJson(`/api/arm-encryption/require-arm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requireArmToTrade: !!requireArm }),
  });
}

// ──────────────────────────────────────────────────────────────
// NEW: Auto-Return (Return Balance) helpers
// Current server routes: GET /api/arm-encryption/status
//                        POST /api/arm-encryption/setup
// Keep legacy aliases as fallbacks to avoid breaking older backends.
// ──────────────────────────────────────────────────────────────

const RB_GET_PATHS = [
  "/api/arm-encryption/status",
  "/api/arm-encryption/auto-return/settings",     // try this sooner
  "/api/arm-encryption/return-balance/settings",
  "/api/arm-sessions/return-balance/settings",
];

const RB_SET_PATHS = [
  "/api/arm-encryption/setup",
  "/api/arm-encryption/auto-return/settings",     // try this sooner
  "/api/arm-encryption/return-balance/settings",
  "/api/arm-sessions/return-balance/settings",
];

export async function getAutoReturnSettings() {
  const raw = await httpJsonTry(RB_GET_PATHS, { method: "GET" });
  // Normalize to { destPubkey, defaultEnabled } for the UI
  const dest =
    raw?.destPubkey ??
    raw?.autoReturnDestPubkey ?? // server field name
    raw?.destination ??
    raw?.dest ??
    "";
  const enabled =
    (typeof raw?.defaultEnabled === "boolean" ? raw.defaultEnabled : undefined) ??
    (typeof raw?.enabled === "boolean" ? raw.enabled : undefined) ??
    (typeof raw?.autoReturnEnabledDefault === "boolean"
      ? raw.autoReturnEnabledDefault
      : undefined) ??
    false;

  return { destPubkey: dest, defaultEnabled: !!enabled };
}

/**
 * Save/update the safe destination wallet for auto-return. You can also pass
 * a defaultEnabled flag so users can opt-in by default.
 */
export async function saveAutoReturnSettings({ destPubkey, defaultEnabled }) {
  const body = {};
  if (typeof destPubkey === "string") body.destPubkey = destPubkey;
  // Support both shapes: legacy expects defaultEnabled; current `/setup` expects enabled
  if (typeof defaultEnabled === "boolean") {
    body.defaultEnabled = defaultEnabled;
    body.enabled = defaultEnabled;
  }
  return httpJsonTry(RB_SET_PATHS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Optional: format ms to H:MM:SS for the banner
export function formatCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${ss}`;
}
