export function getCspNonce() {
  const m = document.querySelector('meta[name="csp-nonce"]');
  return m?.content || null;
}
export function setNonce(el) {
  const n = getCspNonce(); if (n) el.setAttribute("nonce", n);
}