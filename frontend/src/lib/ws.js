export const listenToLogs = (cb) => {
  const ws = new WebSocket(`${import.meta.env.VITE_WS_BASE_URL}/logs`);
  ws.addEventListener("message", (e) => {
    try { cb(JSON.parse(e.data)); } catch { /* ignore junk */ }
  });
  return () => ws.close();
};