// Fallback to empty string so requests resolve relative to the current
// origin if no API base URL is configured.
const BASE = import.meta.env.VITE_API_BASE_URL || "";
import { toast } from "sonner";

/**
 * enable2FA()
 * Starts the 2FA setup, returns { qrCodeDataURL }
 */
export async function enable2FA() {
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      console.error('No access token found');
      return null;
    }

    const res = await fetch(`${BASE}/api/auth/enable-2fa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
    const token = localStorage.getItem('accessToken');
    if (!token) {
      console.error('No access token found');
      return null;
    }

    const res = await fetch(`${BASE}/api/auth/verify-2fa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
    const token = localStorage.getItem('accessToken');
    if (!token) {
      console.error('No access token found');
      return null;
    }

    const res = await fetch(`${BASE}/api/auth/disable-2fa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
    const res = await fetch(`${BASE}/api/auth/verify-2fa-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, token: twoFAToken }),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      console.error("❌ Invalid JSON:", text);
      return null;
    }

    if (!res.ok) {
      console.error("❌ Verify 2FA login error:", res.status, data?.error || text);
      return null;
    }

    // ✅ ACTUAL CRITICAL STEP
    if (data.accessToken) {
      localStorage.setItem("accessToken", data.accessToken);
    } else {
      console.error("❌ No access token returned from verify2FALogin");
    }

    return data;
  } catch (err) {
    console.error("❌ Verify 2FA login failed:", err.message);
    return null;
  }
}