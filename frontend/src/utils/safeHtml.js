// Safe HTML rendering with DOMPurify
// Drop at: frontend/src/utils/safeHtml.js
import DOMPurify from "dompurify";

const config = {
  USE_PROFILES: { html: true },
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data:image\/)(?!javascript))/i,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "link", "meta"],
  FORBID_ATTR: ["srcdoc", "onerror", "onclick", "onload", "style"],
};

export function toSafeHtml(html) {
  return { __html: DOMPurify.sanitize(String(html ?? ""), config) };
}
