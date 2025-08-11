// Ensure CSRF token is present before first state-changing request
// Drop at: frontend/src/hooks/useCsrfBootstrap.js
import { useEffect, useRef } from "react";
import { apiFetch, setCsrfToken } from "@/utils/apiClient";

export default function useCsrfBootstrap() {
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta?.content) return;

    // Attempt to fetch CSRF from backend; expected to set cookie and/or return token
    (async () => {
      try {
        const res = await apiFetch("/api/auth/csrf", { method: "GET", retry: 1 });
        if (res?.csrfToken) setCsrfToken(res.csrfToken);
      } catch {
        // non-fatal; backend may set readable cookie instead
      }
    })();
  }, []);
}
