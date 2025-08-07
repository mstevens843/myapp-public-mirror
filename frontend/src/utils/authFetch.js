// // src/utils/authFetch.js
import { toast } from "sonner";
let onNeedsArmHandler = null;

export function setOnNeedsArm(handler) {
  onNeedsArmHandler = typeof handler === "function" ? handler : null;
}

export async function authFetch(path, options = {}) {
  const token = localStorage.getItem("accessToken") || sessionStorage.getItem("accessToken");
  const merged = {
    credentials: "include",
    headers: {
      ...(options.method && options.method !== "GET" ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  };
  // Compute the API base.  If VITE_API_BASE_URL is undefined (e.g. during
  // local development when a proxy is used), default to an empty string so
  // requests resolve relative to the current origin.  Without this guard the
  // string "undefined" would be prefixed to endpoints and cause CORS/network
  // errors.
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const url  = `${base}${path}`;
  const res  = await fetch(url, merged);
  if (res.status === 401) {
    let data = null;
    try {
      data = await res.clone().json();
    } catch {}
    if (data?.needsArm) {
      const retry = () => authFetch(path, options);
      if (onNeedsArmHandler) {
        try {
          onNeedsArmHandler({ walletId: data.walletId, path, options, retry });
        } catch (e) {
          console.error("[authFetch] onNeedsArm handler error:", e);
        }
      } else {
        toast.error(
          "Protected Mode is enabled. Please arm your automation in the Account settings before trading."
        );
      }
    }
  }
  return res;
}




// let onNeedsArmHandler = null;

// /**
//  * Register a global handler that will be called when the server returns
//  * 401 + { needsArm: true }. The handler receives:
//  *   { walletId, path, options, retry }
//  * where `retry()` replays the original request after arming succeeds.
//  */
// export function setOnNeedsArm(handler) {
//   onNeedsArmHandler = typeof handler === "function" ? handler : null;
// }

// export async function authFetch(path, options = {}) {
//   const token =
//     localStorage.getItem("accessToken") ||
//     sessionStorage.getItem("accessToken");

//   const merged = {
//     credentials: "include", // cookie support
//     headers: {
//       ...(options.method && options.method !== "GET"
//         ? { "Content-Type": "application/json" }
//         : {}),
//       ...(token ? { Authorization: `Bearer ${token}` } : {}),
//       ...(options.headers || {}),
//     },
//     ...options,
//   };

//   const url = `${import.meta.env.VITE_API_BASE_URL}${path}`;
//   const res = await fetch(url, merged);

//   // ── Global Arm-to-Trade interceptor ────────────────────────────────────────
//   if (res.status === 401 && onNeedsArmHandler) {
//     // Try to read a clone to avoid consuming the original stream for callers
//     let data = null;
//     try {
//       data = await res.clone().json();
//     } catch {
//       // ignore non-JSON responses
//     }
//     if (data?.needsArm) {
//       const retry = () => authFetch(path, options);
//       try {
//         onNeedsArmHandler({ walletId: data.walletId, path, options, retry });
//       } catch (e) {
//         // Don't break the original call if handler throws
//         console.error("[authFetch] onNeedsArm handler error:", e);
//       }
//     }
//   }

//   return res;
// }

