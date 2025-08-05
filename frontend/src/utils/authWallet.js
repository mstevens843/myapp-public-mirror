const BASE = import.meta.env.VITE_API_BASE_URL;
import { supabase } from "@/lib/supabase";
import Cookies from "js-cookie"
import { authFetch } from "./authFetch";



/**
 * checkVaultBalance({ phantomPublicKey })
 * Fetches the SOL balance of the user's vault wallet.
 * @param {Object} payload - { phantomPublicKey }
 */
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
    try { data = JSON.parse(text); 

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

/**
 * checkVaultBalanceDirect({ vaultPubkey })
 * Directly checks balance of a vault wallet without DB lookup.
 * @param {Object} payload - { vaultPubkey }
 */
export async function checkVaultBalanceDirect(payload) {
  try {
    console.log("📤 checkVaultBalanceDirect → Sending payload:", payload);

    const res = await fetch(`${BASE}/api/auth/vault-balance-direct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log("📥 checkVaultBalanceDirect → Raw response text:", text);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ checkVaultBalanceDirect → Invalid JSON:", text);
      return null;
    }

    if (!res.ok) {
      console.error("❌ checkVaultBalanceDirect → Failed:", res.status, data?.error || text);
      return null;
    }

    console.log("✅ checkVaultBalanceDirect → Balance data:", data);
    return data;
  } catch (err) {
    console.error("❌ checkVaultBalanceDirect → Request error:", err.message);
    return null;
  }
}

/**
 * smartVaultBalance({ phantomPublicKey?, vaultPubkey? })
 * Automatically chooses correct balance check method.
 * @param {Object} payload - must include at least one pubkey
 */
export async function smartVaultBalance({ phantomPublicKey, vaultPubkey }) {
  console.log("🔀 smartVaultBalance → Inputs:", { phantomPublicKey, vaultPubkey });

  if (phantomPublicKey) {
    console.log("🧭 smartVaultBalance → Using checkVaultBalance()");
    return await checkVaultBalance({ phantomPublicKey });
  } else if (vaultPubkey) {
    console.log("🧭 smartVaultBalance → Using checkVaultBalanceDirect()");
    return await checkVaultBalanceDirect({ vaultPubkey });
  } else {
    console.error("❌ smartVaultBalance → Missing both phantomPublicKey and vaultPubkey");
    return null;
  }
}




/**
 * phantomLogin({ phantomPublicKey, signature, message })
 * Authenticates a Phantom wallet by verifying signature.
 * @param {Object} payload - { phantomPublicKey, signature, message }
 */
export async function phantomLogin(payload) {
  try {
    const res = await fetch(`${BASE}/api/auth/phantom`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ Invalid JSON in response:", text);
      return null;
    }

    if (!res.ok) {
      console.error("❌ Phantom login failed:", res.status, data?.error || text);
      return null;
    }

    return data;
  } catch (err) {
    console.error("❌ Phantom login request error:", err.message);
    return null;
  }
}


/**
 * generateVault({ phantomPublicKey })
 * Generates and stores a new encrypted vault keypair for the user.
 * @param {Object} payload - { phantomPublicKey }
 */
export async function generateVault(payload) {
  try {
    const res = await authFetch("/api/auth/generate-vault", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ Invalid JSON in response:", text);
      return null;
    }

    if (!res.ok) {
      console.error("❌ Vault generation failed:", res.status, data?.error || text);
      return null;
    }

    return data;
  } catch (err) {
    console.error("❌ Vault generation error:", err.message);
    return null;
  }
}



/**
 * checkUserExists({ phantomPublicKey })
 * Checks if a user already exists in the database by their Phantom wallet address.
 * @param {Object} payload - { phantomPublicKey }
 * @returns {boolean|null} - true if user exists, false if not, null on error
 */
export async function checkUserExists(payload) {
  try {
    const res = await authFetch("/api/auth/check-user", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ Invalid JSON in response:", text);
      return { exists: false }; // fallback — invalid server response
    }

    // ✅ If user exists, return tokens + 2FA status
    if (res.ok && data.exists) {
      return {
        exists: true,
        accessToken: data.accessToken || null,
        refreshToken: data.refreshToken || null,
        twoFARequired: data.twoFARequired || false,
      };
    }

    // ✅ If user doesn't exist, fallback to signup flow
    return { exists: false };
  } catch (err) {
    console.error("❌ Network error during checkUserExists:", err.message);
    return { exists: false };
  }
}