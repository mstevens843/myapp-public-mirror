// Fallback to empty string when no API base is configured.  Without this
// default a literal "undefined" string would be prefixed to endpoints.
const BASE = import.meta.env.VITE_API_BASE_URL || "";
import { supabase } from "@/lib/supabase";
import Cookies from "js-cookie"
import { authFetch } from "./authFetch";


/**
 * registerUser(userData)
 * Registers a new user.
 * @param {Object} userData - The user data for registration (e.g., email, password).
 */
export async function registerUser(userData) {
  try {
    const res = await authFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(userData),
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
      console.error("❌ Registration error:", res.status, data?.error || text);
      return null;
    }

    // 👇 Save active wallet immediately
    if (data.activeWallet) {
      localStorage.setItem("activeWallet", data.activeWallet);
    }

    return data;
  } catch (err) {
    console.error("❌ Registration failed:", err.message);
    return null;
  }
}

/**
 * loginUser(userData)
 * Logs in an existing user and returns an access token.
 * @param {Object} userData - The user login data (e.g., email, password).
 */
export async function loginUser(userData) {
  try {
    const res = await authFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(userData),
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
      console.error("❌ Login error:", res.status, data?.error || text);
      return null;
    }

    // ✅ Persist only the active wallet; tokens are managed via HttpOnly cookies
    if (data.activeWallet) {
      localStorage.setItem("activeWallet", JSON.stringify(data.activeWallet));
    }

    return data;
  } catch (err) {
    console.error("❌ Login failed:", err.message);
    return null;
  }
}

export async function resendConfirmationEmail(email) {
  try {
    // Use authFetch so CSRF header and cookies are included
    const res = await authFetch(`/api/auth/resend-confirm`, {
      method: "POST",
      body: JSON.stringify({ email }),
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
      console.error("❌ Resend confirmation error:", res.status, data?.error || text);
      return null;
    }

    return data;
  } catch (err) {
    console.error("❌ Resend confirmation failed:", err.message);
    return null;
  }
}


/**
 * logoutUser(userData)
 * Logs out an existing user.
 *  */


export async function logoutUser() {
  try {
    // Sign out of Supabase (removes server session + Supabase cookies)
    await supabase.auth.signOut();

    // Clear localStorage items used for your app session
    // Tokens are sent via HttpOnly cookies; nothing to remove from storage
    sessionStorage.clear();
    // Optional: clear cookies if you store things there (like chatId etc)
    Cookies.remove("chatId");
    Cookies.remove("someOtherCookie");

    console.log("✅ Successfully logged out.");
  } catch (err) {
    console.error("❌ Error during logout:", err);
  }
}



/**
 * refreshToken(refreshToken)
 * Refreshes the access token using a refresh token.
 * @param {string} refreshToken - The refresh token to use for getting a new access token.
 */
/**
 * refreshToken()  (DEPRECATED – cookie-only)
 * --------------------------------------------------------------------------------
 * FE no longer passes/handles refresh tokens. The server reads the HttpOnly
 * refresh cookie and returns a fresh session. authFetch already auto-refreshes
 * on 401, so you rarely need to call this manually.
 *
 * Keep as a thin shim for legacy code paths; ignores any argument.
 * Returns: { ok: boolean, data?: any, status: number }
 */
export async function refreshToken(/* unused */) {
  try {
    const res = await authFetch("/api/auth/refresh", { method: "POST" });
    let data = null;
    try {
      // server may return JSON or empty body
      const txt = await res.text();
      data = txt ? JSON.parse(txt) : null;
    } catch {
      data = null;
    }
    return { ok: res.ok, data, status: res.status };
  } catch (err) {
    console.error("❌ Token refresh failed:", err?.message || err);
    return { ok: false, data: null, status: 0 };
  }
}

/**
 * Optional: clearer alias. Prefer this in new code.
 */

/**
 * logoutUser()
 * Logs out the user by removing session or JWT.
 */
// export function logoutUser() {
//   // Handle logout logic here, such as clearing localStorage or sessionStorage
//   localStorage.removeItem('accessToken');
//   localStorage.removeItem('refreshToken');
//   console.log("Logged out successfully");
// }


// export async function generateWallet() {
//   try {
//     const res = await fetch(`${BASE}/api/auth/wallet/generate`, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//       },
//     });

//     const text = await res.text();
//     let data;

//     try {
//       data = JSON.parse(text); // Attempt to parse the response as JSON
//     } catch {
//       console.error("❌ Invalid JSON in response:", text);
//       return null;
//     }

//     if (!res.ok) {
//       console.error("❌ Wallet generation error:", res.status, data?.error || text);
//       return null;
//     }

//     return data; // Return wallet details (e.g., publicKey, label)
//   } catch (err) {
//     console.error("❌ Wallet generation failed:", err.message);
//     return null;
//   }
// }



export async function saveWallet(label, privateKey) {
  try {
    // Send save wallet request via authFetch using cookie-based auth
    const res = await authFetch(`/api/wallets/save`, {
      method: "POST",
      body: JSON.stringify({ label, privateKey }),
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
      console.error("❌ Wallet save error:", res.status, data?.error || text);
      return null;
    }

    return data; // Return wallet details after saving
  } catch (err) {
    console.error("❌ Save wallet failed:", err.message);
    return null;
  }
}



/**
 * importWallet()
 * Import a wallet from the private key and label.
 */
export async function importWallet(label, privateKey) {
  try {
    // Use authFetch to import a wallet with cookie-based auth
    const res = await authFetch(`/api/wallets/import-wallet`, {
      method: "POST",
      body: JSON.stringify({ label, privateKey }),
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
      console.error("❌ Wallet import error:", res.status, data?.error || text);
      return null;
    }

    return data; // Return wallet details after importing
  } catch (err) {
    console.error("❌ Import wallet failed:", err.message);
    return null;
  }
}


/**
 * wipeAllWallets()
 * Delete all wallets for the current authenticated user.
 */
export async function wipeAllWallets() {
  try {
    const res = await authFetch(`/api/wallets/wipe`, {
      method: "DELETE",
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
      console.error("❌ Wipe wallets error:", res.status, data?.error || text);
      return null;
    }

    return data; // Return confirmation message
  } catch (err) {
    console.error("❌ Wipe wallets failed:", err.message);
    return null;
  }
}



/**
 * exportWallet
 * Export the private key for a specific wallet.
 * @param {string} 
walletId - The ID of the wallet to export.
 */
export async function exportWallet(walletId) {
  try {
    const res = await authFetch(`/api/auth/wallets/export/${walletId}`, {
      method: "GET",
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
      console.error("❌ Export wallet error:", res.status, data?.error || text);
      return null;
    }

    return data; // Return the private key
  } catch (err) {
    console.error("❌ Export wallet failed:", err.message);
    return null;
  }
}



/**
 * deleteWallet
 * Delete a wallet from the database.
 * @param {string} walletId - The ID of the wallet to delete.
 */
export async function deleteWallet(walletId) {
  try {
    const res = await authFetch(`/api/auth/wallets/delete/${walletId}`, {
      method: "DELETE",
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
      console.error("❌ Delete wallet error:", res.status, data?.error || text);
      return null;
    }

    return data; // Return confirmation message
  } catch (err) {
    console.error("❌ Delete wallet failed:", err.message);
    return null;
  }
}





// src/utils/sendSol.js


// src/utils/sendSol.js
export async function sendSol(senderWalletId, recipientAddress, amount) {
  try {
    const res = await authFetch(`/api/wallets/send-sol`, {
      method: 'POST',
      body: JSON.stringify({
        senderWalletId,
        recipientAddress,
        amount,
      }),
    });

    const text = await res.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ Invalid JSON in response:", text);
      return { success: false, error: 'Invalid JSON response' };
    }

    if (!res.ok) {
      console.error("❌ Send SOL error:", res.status, data?.error || text);
      return { success: false, error: data?.error || 'Failed to send SOL' };
    }

    return data; // e.g., { success: true, signature: … }
  } catch (err) {
    console.error("❌ Send SOL failed:", err.message);
    return { success: false, error: err.message };
  }
}




export async function fetchTokensByWallet(walletId) {
  try {
    const res = await authFetch(`/api/auth/tokens/by-wallet?walletId=${walletId}`, {
      method: "GET",
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
      console.error("❌ Fetch tokens error:", res.status, data?.error || text);
      return null;
    }

    return data; // token list
  } catch (err) {
    console.error("❌ Fetch tokens failed:", err.message);
    return null;
  }
}




export async function fetchPortfolio(walletId) {
  const res = await authFetch(`/api/wallets/portfolio?walletId=${walletId}`, {
    method: "GET",
  });
  if (!res.ok) throw new Error(`Failed to fetch portfolio: ${res.status}`);
  return res.json();
}


/**
 * loadWallet()
 * Load a wallet from the backend by querying with specific labels.
 */
export async function loadWallet(labels = []) {
  try {
    // Load wallets via authFetch; cookie-based authentication
    const res = await authFetch(`/api/wallets/load`, {
      method: "GET",
    });

    const text = await res.text();
    let data;

    try {
      data = JSON.parse(text); // Parse the response as JSON
    } catch (err) {
      console.error("❌ Invalid JSON in response:", text);
      return null; // Return null in case of invalid JSON
    }

    if (!res.ok) {
      console.error("❌ Load wallet error:", res.status, data?.error || text);
      return null; // Return null on error
    }

    // ⬇️ Derive a backward-compat flag so existing UI checks keep working
  return data.map((w) => ({
    ...w,
    hasPassphrase: !!w.isProtected || !!w.passphraseHash,
  }));
  } catch (err) {
    console.error("❌ Load wallet failed:", err.message);
    return null; // Return null if fetch fails
  }
}



/**
 * importWallet()
 * Generate a new wallet and securely store private key
 */

export async function generateWallet(label) {
  try {
    // Use authFetch so cookies and CSRF tokens are attached automatically
    const res = await authFetch(`/api/auth/wallet/generate`, {
      method: "POST",
      body: JSON.stringify({ label }),
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
      console.error(
        "❌ Wallet generation error:",
        res.status,
        data?.error || text
      );
      return null;
    }
    return data;
  } catch (err) {
    console.error("❌ Wallet generation failed:", err.message);
    return null;
  }
}


/**
 * fetchActiveWallet()
 * Fetch the currently active wallet for the user.
 */
export async function fetchActiveWallet() {
  try {
    const res = await authFetch(`/api/auth/wallet/active`, {
      method: "GET",
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
      console.error(
        "❌ Fetch active wallet error:",
        res.status,
        data?.error || text
      );
      return null;
    }
    return data.activeWalletId || null;
  } catch (err) {
    console.error("❌ Fetch active wallet failed:", err.message);
    return null;
  }
}



/**
 * setActiveWallet
 * Set a wallet as the active wallet for the user.
 * @param {string} walletId - The ID of the wallet to set as active.
 */

export async function setActiveWalletApi(walletId) {
  try {
    const res = await authFetch(`/api/auth/wallet/set-active`, {
      method: "POST",
      body: JSON.stringify({ walletId: String(walletId) }),
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
      console.error(
        "❌ Set active wallet error:",
        res.status,
        data?.error || text
      );
      return null;
    }
    return data;
  } catch (err) {
    console.error("❌ Set active wallet failed:", err.message);
    return null;
  }
}


export async function requestPasswordReset(email) {
  try {
    const res = await authFetch(`/api/auth/request-password-reset`, {
      method: "POST",
      body: JSON.stringify({ email }),
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
        "❌ Request reset error:",
        res.status,
        data?.error || text
      );
      return null;
    }
    return data;
  } catch (err) {
    console.error("Request reset failed:", err);
    return null;
  }
}

export async function verifyResetToken(token) {
  try {
    const res = await authFetch(`/api/auth/verify-reset-token`, {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    return await res.json();
  } catch (err) {
    console.error("Verify reset failed:", err);
    return null;
  }
}

export async function resetPassword(token, newPassword, confirmPassword) {
  try {
    const res = await authFetch(`/api/auth/reset-password`, {
      method: "POST",
      body: JSON.stringify({ token, newPassword, confirmPassword }),
    });
    return await res.json();
  } catch (err) {
    console.error("Reset password failed:", err);
    return null;
  }
}