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
  return httpJson(`/api/encrypted-wallet-session/status/${walletId}`, {
    method: "GET",
  });
}

export async function armEncryptedWallet({
  walletId,
  passphrase,
  code,                 // 2FA code (middleware typically expects req.body.code)
  ttlMinutes,           // optional; backend clamps/defaults
  migrateLegacy = false // set true to upgrade legacy colon-hex on the fly
}) {
  return httpJson(`/api/encrypted-wallet-session/arm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletId, passphrase, ttlMinutes, code, migrateLegacy }),
  });
}

export async function extendEncryptedWallet({ walletId, code, ttlMinutes }) {
  return httpJson(`/api/encrypted-wallet-session/extend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletId, ttlMinutes, code }),
  });
}

export async function disarmEncryptedWallet({ walletId, code }) {
  return httpJson(`/api/encrypted-wallet-session/disarm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletId, code }),
  });
}

// Protected Mode toggle at user-level (requireArmToTrade)
export async function setRequireArmToTrade(requireArm) {
  return httpJson(`/api/user/security/require-arm`, {
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
