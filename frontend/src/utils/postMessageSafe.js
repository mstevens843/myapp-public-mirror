export function onMessage(allowedOrigins, handler) {
  function listener(e) {
    if (!allowedOrigins.includes(new URL(e.origin).origin)) return;
    handler(e.data, e);
  }
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
export function postMessageSafe(win, origin, data) {
  win.postMessage(data, new URL(origin).origin);
}
