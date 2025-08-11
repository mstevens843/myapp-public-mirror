// A safe external link wrapper enforcing rel and target
// Drop at: frontend/src/components/ExternalLink.jsx
import React from "react";

function isExternal(href) {
  try {
    const u = new URL(href, window.location.origin);
    return u.origin !== window.location.origin;
  } catch {
    return false;
  }
}

export default function ExternalLink({ href, children, ...rest }) {
  const external = isExternal(href);
  if (!external) {
    return <a href={href} {...rest}>{children}</a>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...rest}
    >
      {children}
    </a>
  );
}
