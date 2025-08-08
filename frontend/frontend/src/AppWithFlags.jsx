import React from "react";
import { FeatureFlagProvider } from "@/contexts/FeatureFlagContext";
import App from "./App";

/**
 * Wrap the primary App component with the FeatureFlagProvider.  This
 * indirection allows the existing main.jsx to import AppWithFlags
 * instead of App, enabling flags without having to modify deeply
 * nested provider hierarchies.  When imported the provider will
 * initialise feature flags from localStorage and the optional
 * /api/flags endpoint.
 */
export default function AppWithFlags() {
  return (
    <FeatureFlagProvider>
      <App />
    </FeatureFlagProvider>
  );
}
