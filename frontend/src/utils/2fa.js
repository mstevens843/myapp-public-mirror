// Fallback to empty string so requests resolve relative to the current
// origin if no API base URL is configured.
const BASE = import.meta.env.VITE_API_BASE_URL || "";
import { toast } from "sonner";
import { authFetch } from "./authFetch";

/**
 * enable2FA()
 * Starts the 2FA setup, returns { qrCodeDataURL }
 */
export async function enable2FA() {
  try {
    // Use authFetch to include cookies and CSRF automatically
    const res = await authFetch(`/api/auth/enable-2fa`, {
      method: "POST",
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      console.error("❌ Invalid JSON:", text);
      return null;
    }

    if (!res.ok) {
      console.error("❌ Enable 2FA error:", res.status, data?.error || text);
      return null;
    }

    return data;
  } catch (err) {
    console.error("❌ Enable 2FA failed:", err.message);
    return null;
  }
}

/**
 * verify2FA(token)
 * Confirms 2FA setup by submitting the TOTP token.
 */
export async function verify2FA(twoFAToken) {
  try {
    const res = await authFetch(`/api/auth/verify-2fa`, {
      method: "POST",
      body: JSON.stringify({ token: twoFAToken }),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      console.error("❌ Invalid JSON:", text);
      return null;
    }

    if (!res.ok) {
      console.error("❌ Verify 2FA error:", res.status, data?.error || text);
      return null;
    }

    return data;
  } catch (err) {
    console.error("❌ Verify 2FA failed:", err.message);
    return null;
  }
}

/**
 * disable2FA()
 * Turns off 2FA for the current user.
 */
export async function disable2FA() {
  try {
    const res = await authFetch(`/api/auth/disable-2fa`, {
      method: "POST",
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      console.error("❌ Invalid JSON:", text);
      return null;
    }

    if (!res.ok) {
      console.error("❌ Disable 2FA error:", res.status, data?.error || text);
      return null;
    }

    return data;
  } catch (err) {
    console.error("❌ Disable 2FA failed:", err.message);
    return null;
  }
}

/**
 * verify2FALogin(userId, token)
 * Completes 2FA login flow after password step.
 */
export async function verify2FALogin(userId, twoFAToken) {
  try {
    const res = await authFetch(`/api/auth/verify-2fa-login`, {
      method: "POST",
      body: JSON.stringify({ userId, token: twoFAToken }),
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ Invalid JSON:", text);
      return null;
    }
    if (!res.ok) {
      console.error(
        "❌ Verify 2FA login error:",
        res.status,
        data?.error || text
      );
      return null;
    }
    // On success, simply return the data; tokens are delivered via HttpOnly cookies
    return data;
  } catch (err) {
    console.error("❌ Verify 2FA login failed:", err.message);
    return null;
  }
}