// src/utils/encryptedWalletSession.js
const BASE = import.meta.env.VITE_API_BASE_URL;
import { supabase } from "@/lib/supabase";
import Cookies from "js-cookie";
import { authFetch } from "./authFetch";

/** ─────────────────────────────────────────────────────────────
 * Existing pattern reference (kept here so you can co-locate if desired)
 * checkVaultBalance({ phantomPublicKey })
 * ──────────────────────────────────────────────────────────── */
export async function checkVaultBalance(payload) {
  try {
    console.log("📤 checkVaultBalance → Sending payload:", payload);

    const res = await fetch(`${BASE}/api/auth/vault-balance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log("📥 checkVaultBalance → Raw response text:", text);

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

    console.log("✅ checkVaultBalance → Balance data:", data);
    return data;
  } catch (err) {
    console.error("❌ checkVaultBalance → Request error:", err.message);
    return null;
  }
}

/** ─────────────────────────────────────────────────────────────
 * Encrypted Wallet Session (Arm-to-Trade) client
 * Backend route file name: encryptedWalletSession.js
 * Assumed routes:
 *   POST /api/encrypted-wallet-session/arm
 *   POST /api/encrypted-wallet-session/extend
 *   POST /api/encrypted-wallet-session/disarm
 *   GET  /api/encrypted-wallet-session/status/:walletId
 *   POST /api/user/security/require-arm   (toggle Protected Mode)
 * You can tweak paths here if your backend mounts differently.
 * ──────────────────────────────────────────────────────────── */

async function httpJson(path, init = {}) {
  const res = await authFetch(path, init);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* leave as null */ }
  if (!res.ok) {
    const msg = data?.error || res.statusText || "Request failed";
    throw new Error(msg);
  }
  return data;
}

export async function getArmStatus(walletId) {
  return httpJson(`/api/arm-encryption/status/${walletId}`, {
    method: "GET",
  });
}

export async function armEncryptedWallet({
  walletId,
  passphrase,
  twoFactorToken,                // 2FA code (middleware typically expects req.body.twoFactorToken)
  ttlMinutes,           // optional; backend clamps/defaults
  migrateLegacy = false, // set true to upgrade legacy colon-hex on the fly
  applyToAll = false,
  passphraseHint,
  forceOverwrite = false,
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
  if (typeof passphraseHint === 'string' && passphraseHint.trim() !== '') {
    payload.passphraseHint = passphraseHint;
  }
  if (forceOverwrite) payload.forceOverwrite = true;
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
    body: JSON.stringify({ walletId, ttlMinutes, twoFactorToken, }),
  });
}

export async function disarmEncryptedWallet({ walletId, twoFactorToken }) {
  return httpJson(`/api/arm-encryption/disarm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletId, twoFactorToken, }),
  });
}

/**
 * Set up pass‑phrase protection for a wallet.
 *
 * This helper calls the backend endpoint that upgrades an unprotected or
 * legacy wallet to use envelope encryption with the provided passphrase.
 * It does not unlock the wallet for trading – after setup you must call
 * armEncryptedWallet() separately to create a timed session.
 * 2FA codes are never required when setting up protection.
 *
 * @param {Object} params
 * @param {string} params.walletId – ID of the wallet to protect (required)
 * @param {string} params.passphrase – new pass‑phrase to encrypt with (required)
 * @param {boolean} [params.applyToAll] – apply this pass‑phrase to all wallets
 * @param {string} [params.passphraseHint] – optional hint shown to the user
 * @param {boolean} [params.forceOverwrite] – overwrite existing pass‑phrases on wallets when applyToAll
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

// Protected Mode toggle at user-level (requireArmToTrade)
export async function setRequireArmToTrade(requireArm) {
  return httpJson(`/api/arm-encryption/require-arm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requireArmToTrade: !!requireArm }),
  });
}

// Optional: format ms to H:MM:SS for the banner
export function formatCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${ss}`;
}