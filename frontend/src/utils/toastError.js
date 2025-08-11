// User-friendly, sanitized error toasts
// Drop at: frontend/src/utils/toastError.js
import { toast } from "sonner";

export function toastError(err, opts = {}) {
  const status = err?.status || 0;
  const code = err?.code || "";
  let msg = "Something went wrong.";

  if (status === 401) msg = "Your session expired. Please sign in again.";
  else if (status === 403) msg = "You don’t have access to perform this action.";
  else if (status === 404) msg = "Not found.";
  else if (status === 429) msg = "You’re sending requests too quickly. Please slow down.";
  else if (status >= 500) msg = "Server error. Please try again shortly.";
  else if (code === "ERR_NETWORK" || code === "AbortError") msg = "Network issue. Check your connection.";

  if (err?.message && !/request_failed/i.test(err.message)) {
    // Show API-provided error messages if they look safe (short, no HTML)
    const unsafe = /<\/?[a-z][\s\S]*>/i.test(err.message);
    if (!unsafe && err.message.length < 200) msg = err.message;
  }

  toast.error(msg, { duration: 4500, ...opts });
}
