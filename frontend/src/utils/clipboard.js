export async function copyMasked(str, { maskMiddle = true } = {}) {
  const s = String(str ?? "");
  const masked = maskMiddle && s.length > 10 ? s.slice(0,6) + "…" + s.slice(-4) : s;
  await navigator.clipboard.writeText(masked);
  return masked;
}