const BASE = import.meta.env.VITE_API_BASE_URL;
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

    // ✅ Store tokens
    if (data.accessToken && data.refreshToken) {
      localStorage.setItem("accessToken", data.accessToken);
      localStorage.setItem("refreshToken", data.refreshToken);
      console.log("✅ Tokens saved:", data.accessToken.slice(0, 10) + "...");
    }

    // ✅ Store active wallet
    if (data.activeWallet) {
      // localStorage.setItem("activeWallet", data.activeWallet);
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
    const res = await fetch(`${BASE}/api/auth/resend-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
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
export async function refreshToken(refreshToken) {
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
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
      console.error("❌ Token refresh error:", res.status, data?.error || text);
      return null;
    }

    return data; // Return the new access token
  } catch (err) {
    console.error("❌ Token refresh failed:", err.message);
    return null;
  }
}

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
    const token = localStorage.getItem('accessToken');
    if (!token) {
      console.error('No access token found');
      return null;
    }
    
    const res = await fetch(`${BASE}/api/wallets/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
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
    const token = localStorage.getItem('accessToken');
    if (!token) {
      console.error('No access token found');
      return null;
    }

    const res = await fetch(`${BASE}/api/wallets/import-wallet`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
    const res = await fetch(`${BASE}/api/wallets/wipe`, {
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
    const token = localStorage.getItem('accessToken');
    if (!token) {
      console.error('No access token found');
      return null;
    }

    const res = await fetch(`${BASE}/api/auth/wallets/export/${walletId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
    const token = localStorage.getItem('accessToken');
    if (!token) {
      console.error('No access token found');
      return null;
    }

    const res = await fetch(`${BASE}/api/auth/wallets/delete/${walletId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
    const token = localStorage.getItem('accessToken');
    if (!token) {
      console.error('No access token found');
      return { success: false, error: 'No access token' };
    }

    const res = await fetch(`${BASE}/api/wallets/send-sol`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
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
    const token = localStorage.getItem('accessToken');
    if (!token) {
      console.error('No access token found');
      return null;
    }

    const res = await fetch(`${BASE}/api/auth/tokens/by-wallet?walletId=${walletId}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
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
  const token = localStorage.getItem("accessToken");
  const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/wallets/portfolio?walletId=${walletId}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
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
    const token = localStorage.getItem('accessToken'); // Get token from localStorage
    if (!token) {
      console.error('No access token found');
      return null;
    }

    // const res = await fetch(`${BASE}/api/wallets/load?labels=${labels.join(",")}`, {
    const res = await fetch(`${BASE}/api/wallets/load`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
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
    const token = localStorage.getItem('accessToken');
    if (!token) {
      console.error('No access token found');
      return null;
    }

    const res = await fetch(`${BASE}/api/auth/wallet/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,  
      },
      body: JSON.stringify({ label }),   // 👈 ADD THIS
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
      console.error("❌ Wallet generation error:", res.status, data?.error || text);
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
    const token = localStorage.getItem("accessToken");
    if (!token) {
      console.error("No access token found");
      return null;
    }

    const res = await fetch(`${BASE}/api/auth/wallet/active`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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
    const token = localStorage.getItem('accessToken');
    if (!token) {
      console.error('No access token found');
      return null;
    }

    const res = await fetch(`${BASE}/api/auth/wallet/set-active`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,   // ✅ add token
      },
       body: JSON.stringify({ walletId: String(walletId) }), 
    });

    const text = await res.text();
    console.log("🪵 raw text from server:", text);
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      console.error("❌ Invalid JSON in response:", text);
      return null;
    }

    if (!res.ok) {
      console.error("❌ Set active wallet error:", res.status, data?.error || text);
      return null;
    }

    return data; // Return success message or wallet info
  } catch (err) {
    console.error("❌ Set active wallet failed:", err.message);
    return null;
  }
}


export async function requestPasswordReset(email) {
  try {
    const res = await fetch(`${BASE}/api/auth/request-password-reset`, {  // or adjust path
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      console.error("❌ Request reset error:", res.status, data?.error || text);
      return null;
    }

    return data;
  } catch (err) {
    console.error("Request reset failed:", err);
    return null;
  }
}

export async function verifyResetToken(token) {
    console.log("📡 Calling verify-reset-token at:", `${BASE}/auth/verify-reset-token`);

  try {
    const res = await fetch(`${BASE}/api/auth/verify-reset-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    const res = await fetch(`${BASE}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword, confirmPassword }),
    });
    return await res.json();
  } catch (err) {
    console.error("Reset password failed:", err);
    return null;
  }
}
