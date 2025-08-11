// Create a default Trusted Types policy so Chrome doesn’t break when CSP is enabled.
if (window.trustedTypes && !window.trustedTypes.getPolicy('default')) {
  window.trustedTypes.createPolicy('default', {
    createHTML: (s) => s,
    createScriptURL: (s) => s,
    createScript: (s) => s,
  });
}