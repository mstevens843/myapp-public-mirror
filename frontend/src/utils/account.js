import { toast } from "sonner";
import { authFetch } from "./authFetch";

// Use a blank string when VITE_API_BASE_URL is not set.  This ensures
// fetch calls resolve to relative endpoints instead of "undefined/...".
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

export async function getProfile() {
  try {
    const res = await authFetch(`/api/account/profile`, {
      method: "GET",
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
    const res = await authFetch(`/api/account/profile`, {
      method: "PATCH",
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
    const res = await authFetch(`/api/account/change-password`, {
      method: "POST",
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
    const res = await authFetch(`/api/account/delete`, {
      method: "DELETE",
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
  try {
    const res = await authFetch(`/api/auth/convert-supabase`, {
      method: "POST",
      body: JSON.stringify({ supabaseToken }),
    });
    const raw = await res.text();
    if (!res.ok) {
      console.error(
        "❌ exchangeSupabaseSession HTTP error:",
        res.status,
        raw
      );
      toast.error("Failed to finalize login. Try again.");
      return null;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error("❌ Invalid JSON in convert-supabase response:", raw);
      toast.error("Invalid server response during login.");
      return null;
    }
    if (data?.activeWallet) {
      localStorage.setItem("activeWallet", data.activeWallet);
    }
    // Do not persist accessToken or refreshToken here; cookies handle auth
    return data;
  } catch (err) {
    console.error("💥 exchangeSupabaseSession EXCEPTION:", err);
    toast.error("Server error during login.");
    return null;
  }
}