import { toast } from "sonner";

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

export async function getProfile() {
  try {
    const token = localStorage.getItem("accessToken");
    if (!token) throw new Error("No access token found");

    const res = await fetch(`${BASE_URL}/api/account/profile`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) throw new Error("Failed to fetch profile");
    return await res.json();
  } catch (err) {
    console.error("getProfile error:", err);
    toast.error("Failed to load profile.");
    return null;
  }
}

export async function updateProfile(profile) {
  try {
    const token = localStorage.getItem("accessToken");
    if (!token) throw new Error("No access token found");

    const res = await fetch(`${BASE_URL}/api/account/profile`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(profile),
    });

    if (!res.ok) throw new Error("Failed to update profile");
    return true;
  } catch (err) {
    console.error("updateProfile error:", err);
    toast.error("Failed to update profile.");
    return false;
  }
}

export async function changePassword({ currentPassword, newPassword }) {
  try {
    const token = localStorage.getItem("accessToken");
    if (!token) throw new Error("No access token found");

    const res = await fetch(`${BASE_URL}/api/account/change-password`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (!res.ok) throw new Error("Failed to change password");
    return true;
  } catch (err) {
    console.error("changePassword error:", err);
    toast.error("Failed to change password.");
    return false;
  }
}

export async function deleteAccount() {
  try {
    const token = localStorage.getItem("accessToken");
    if (!token) throw new Error("No access token found");

    const res = await fetch(`${BASE_URL}/api/account/delete`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) throw new Error("Failed to delete account");
    return true;
  } catch (err) {
    console.error("deleteAccount error:", err);
    toast.error("Failed to delete account.");
    return false;
  }
}




/**
 * exchangeSupabaseSession(supabaseToken)
 * Sends the Supabase session token to your backend to get your app's own JWT.
 * @param {string} supabaseToken - The access token from Supabase session
 */
export async function exchangeSupabaseSession(supabaseToken) {
  console.log("🔁 exchangeSupabaseSession() CALLED");
  console.log("👉 Supabase token (short):", supabaseToken?.slice(0, 20) + "..." || "(null)");

  try {
    const res = await fetch(`${BASE_URL}/api/auth/convert-supabase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supabaseToken })
    });

    const raw = await res.text();
    console.log("📥 Raw response from /convert-supabase:", raw);

    if (!res.ok) {
      console.error("❌ exchangeSupabaseSession HTTP error:", res.status, raw);
      toast.error("Failed to finalize login. Try again.");
      return null;
    }

    const data = JSON.parse(raw);

    if (data?.accessToken) {
      console.log("✅ Received platform accessToken:", data.accessToken.slice(0, 16) + "...");
      if (data?.activeWallet) {
        console.log("💰 Active wallet:", data.activeWallet);
        localStorage.setItem("activeWallet", data.activeWallet);
      }

      localStorage.setItem("accessToken", data.accessToken);
      return data;
    } else {
      console.error("❌ No accessToken in backend response:", data);
      toast.error("Login session exchange failed.");
      return null;
    }
  } catch (err) {
    console.error("💥 exchangeSupabaseSession EXCEPTION:", err);
    toast.error("Server error during login.");
    return null;
  }
}