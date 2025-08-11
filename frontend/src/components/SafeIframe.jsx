// A sandboxed iframe that only allows explicitly whitelisted hosts
// Drop at: frontend/src/components/SafeIframe.jsx
import React from "react";

function hostnameFrom(url) {
  try { return new URL(url, window.location.origin).hostname; } catch { return ""; }
}

/**
 * props:
 *  - src: string (required)
 *  - title: string (required for a11y)
 *  - allowHosts: string[] (hostnames allowed to embed)
 *  - allow: string (HTML 'allow' attribute, narrow by default)
 *  - sandbox: string (HTML 'sandbox' attribute)
 */
export default function SafeIframe({
  src,
  title,
  allowHosts = [],
  allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
  sandbox = "allow-scripts allow-same-origin",
  ...rest
}) {
  const host = hostnameFrom(src);
  const ok = allowHosts.includes(host);
  if (!ok) {
    return (
      <div role="alert" className="text-sm text-red-600">
        Embedding from this host is not allowed.
      </div>
    );
  }
  return (
    <iframe
      src={src}
      title={title}
      sandbox={sandbox}
      allow={allow}
      loading="lazy"
      {...rest}
    />
  );
}
