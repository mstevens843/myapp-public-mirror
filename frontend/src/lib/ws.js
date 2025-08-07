export const listenToLogs = (cb) => {
  // Determine the WebSocket base: prefer an explicit WS base, then fall back
  // to the API base, and finally to the current origin.  Replace HTTP
  // schemes with WS as appropriate.  Missing env vars should not cause
  // runtime errors.
  let base = import.meta.env.VITE_WS_BASE_URL;
  if (!base) {
    const apiBase = import.meta.env.VITE_API_BASE_URL;
    if (apiBase) {
      try {
        const url = new URL(apiBase, window.location.origin);
        base = url.origin;
      } catch {
        base = apiBase;
      }
    } else {
      base = window.location.origin;
    }
  }
  // ensure proper ws scheme and strip trailing slash
  base = base.replace(/^http/, 'ws').replace(/\/$/, '');
  const ws = new WebSocket(`${base}/logs`);
  ws.addEventListener('message', (e) => {
    try { cb(JSON.parse(e.data)); } catch { /* ignore junk */ }
  });
  return () => ws.close();
};