import { toast } from "sonner";

// Keep a mutable handler that consumers can register for 401 → needsArm
// responses.  When present it will be invoked with details about the
// failed request and a callback that allows callers to retry after
// arming.  See setOnNeedsArm() for registration.
let onNeedsArmHandler = null;

/**
 * Register a global handler that will be called when the server
 * returns a 401 response with a JSON body containing { needsArm: true }.
 * The handler receives an object with { walletId, path, options, retry }.
 * `retry()` will reissue the original request after the arm flow
 * completes.  Passing anything other than a function removes the
 * handler.
 *
 * @param {Function|null} handler
 */
export function setOnNeedsArm(handler) {
  onNeedsArmHandler = typeof handler === "function" ? handler : null;
}

/**
 * Perform an authenticated fetch with automatic token headers and
 * resiliency against rate limiting (HTTP 429) and network/CORS
 * failures.  Rate limits are retried up to three times with
 * exponential backoff (1 s → 2 s → 4 s).  Network errors are retried
 * once after 1.5 s and surface a controlled error on a second
 * failure.  The existing 401 → needsArm behaviour is preserved.
 *
 * @param {string} path Relative API path (will be prefixed with
 *        VITE_API_BASE_URL when present)
 * @param {RequestInit} [options] Additional fetch options
 * @returns {Promise<Response>} The eventual Response object
 */
export async function authFetch(path, options = {}) {
  // Determine the current access token from either localStorage or
  // sessionStorage.  This matches the existing behaviour.
  const token =
    localStorage.getItem("accessToken") ||
    sessionStorage.getItem("accessToken");

  const merged = {
    credentials: "include",
    headers: {
      // Automatically set Content‑Type on non‑GET requests
      ...(options.method && options.method !== "GET"
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  };

  // Compute the API base.  If VITE_API_BASE_URL is undefined (e.g. during
  // local development when a proxy is used), default to an empty
  // string so requests resolve relative to the current origin.  Without
  // this guard the string "undefined" would be prefixed to endpoints and
  // cause CORS/network errors.
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const url = `${base}${path}`;

  // Track attempts to prevent runaway retries.
  let rateLimitAttempts = 0;
  let networkAttempted = false;

  // Simple helper to pause execution for a given duration.
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function attemptFetch() {
    try {
      const res = await fetch(url, merged);

      // Handle HTTP 429 (Too Many Requests).  Retry up to three times
      // with exponential backoff (1 s → 2 s → 4 s).  After the final
      // attempt the response is returned as is.
      if (res.status === 429 && rateLimitAttempts < 3) {
        toast.info("Rate limited; retrying…");
        const backoffs = [1000, 2000, 4000];
        const waitMs = backoffs[rateLimitAttempts] || 4000;
        rateLimitAttempts++;
        await delay(waitMs);
        return attemptFetch();
      }

      // 401 → needsArm logic preserved from the original implementation.
      if (res.status === 401) {
        let data = null;
        try {
          data = await res.clone().json();
        } catch {
          // ignore non‑JSON responses
        }
        if (data?.needsArm) {
          const retry = () => authFetch(path, options);
          if (onNeedsArmHandler) {
            try {
              onNeedsArmHandler({
                walletId: data.walletId,
                path,
                options,
                retry,
              });
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
    } catch (err) {
      // Handle fetch rejections (network errors, CORS issues).  Retry
      // once after a short delay.  Provide a manual retry button on
      // the toast if the toast implementation supports actions.  On
      // subsequent failures throw a controlled error.
      if (!networkAttempted) {
        networkAttempted = true;
        try {
          toast.error("Network error; retrying…", {
            action: {
              label: "Retry now",
              onClick: () => {
                attemptFetch().catch(() => {});
              },
            },
          });
        } catch {
          toast.error("Network error; retrying…");
        }
        await delay(1500);
        return attemptFetch();
      }
      throw new Error(
        err?.message || "Network error while contacting backend"
      );
    }
  }
  return attemptFetch();
}
