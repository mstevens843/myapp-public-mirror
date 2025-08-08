// contexts/FeatureFlagContext.jsx
// Simple feature flag provider and helper.  Flags are merged from
// localStorage and an optional backend endpoint (/api/flags).  Values
// are written to `window.__FLAGS__` so code that doesn’t consume the
// React context can still read them.  A tiny dev panel is exposed
// during development to allow toggling flags on the fly.  When not
// wrapped in the provider the exported hook falls back to
// `window.__FLAGS__` for its values.

import React, { createContext, useContext, useEffect, useState } from "react";
import { authFetch } from "@/utils/authFetch";

// Default feature flags.  Extend this object whenever you add new flags.
const DEFAULT_FLAGS = {
  telemetry: false,
  newUi: {
    turboAdvanced: false,
  },
  logs: {
    throttle: true,
  },
};

// Utility for deep merge of nested objects.  Later objects override
// earlier ones.  Arrays are not merged.
function mergeDeep(target, source) {
  const output = { ...target };
  if (typeof target === "object" && typeof source === "object") {
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
      ) {
        output[key] = mergeDeep(target[key] || {}, source[key]);
      } else {
        output[key] = source[key];
      }
    }
  }
  return output;
}

const FeatureFlagContext = createContext(null);

// Load flags from localStorage.  Returns an object or empty object on
// failure.  The caller is responsible for merging defaults.
function loadLocalFlags() {
  try {
    const stored = localStorage.getItem("featureFlags");
    if (!stored) return {};
    return JSON.parse(stored);
  } catch {
    return {};
  }
}

// Persist flags to localStorage.  This is called whenever flags
// change.  Swallow any errors silently.
function saveLocalFlags(flags) {
  try {
    localStorage.setItem("featureFlags", JSON.stringify(flags));
  } catch {
    // ignore storage errors
  }
}

/**
 * Fetch flags from the backend.  Returns an empty object if the
 * request fails or the endpoint does not exist.  Uses authFetch so
 * that authentication headers are automatically applied and any
 * network errors are handled consistently.
 */
async function fetchRemoteFlags() {
  try {
    const res = await authFetch("/api/flags");
    if (res && res.ok) {
      const data = await res.json();
      return data || {};
    }
  } catch {
    // If the endpoint is missing or returns a network error just
    // silently return.
  }
  return {};
}

// Create a developer panel only in non‑production environments.  This
// function inserts a small fixed panel into the DOM with toggles for
// each top‑level flag.  Changing a toggle updates both the context
// state (if available) and `window.__FLAGS__`, and persists the new
// value in localStorage.
function createDevPanel(flags, setFlags) {
  if (typeof window === "undefined") return;
  const mode = import.meta?.env?.MODE || process.env.NODE_ENV;
  if (mode === "production") return;
  // Only insert once
  if (document.getElementById("feature-flag-dev-panel")) return;
  const panel = document.createElement("div");
  panel.id = "feature-flag-dev-panel";
  panel.style.position = "fixed";
  panel.style.bottom = "10px";
  panel.style.right = "10px";
  panel.style.background = "rgba(0,0,0,0.8)";
  panel.style.color = "#fff";
  panel.style.padding = "8px";
  panel.style.borderRadius = "4px";
  panel.style.zIndex = "9999";
  panel.style.fontSize = "12px";
  panel.style.maxWidth = "200px";
  panel.style.lineHeight = "1.4";
  panel.style.fontFamily = "sans-serif";
  panel.innerHTML = "<strong>Feature Flags</strong><br />";

  function addToggle(keyPath, label, initial) {
    const id = `flag-${keyPath.replace(/\./g, "-")}`;
    const container = document.createElement("div");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = id;
    checkbox.checked = initial;
    const span = document.createElement("label");
    span.htmlFor = id;
    span.style.marginLeft = "4px";
    span.textContent = label;
    container.appendChild(checkbox);
    container.appendChild(span);
    checkbox.addEventListener("change", () => {
      // Update nested flag value
      setFlags((prev) => {
        const parts = keyPath.split(".");
        const newFlags = { ...prev };
        let node = newFlags;
        for (let i = 0; i < parts.length - 1; i++) {
          node[parts[i]] = { ...node[parts[i]] };
          node = node[parts[i]];
        }
        node[parts[parts.length - 1]] = checkbox.checked;
        // Persist and update global flags
        saveLocalFlags(newFlags);
        window.__FLAGS__ = newFlags;
        return newFlags;
      });
    });
    panel.appendChild(container);
  }

  // Flatten flag paths for toggling.  Only include boolean leaves.
  function walk(obj, prefix = "") {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof val === "object" && val !== null) {
        walk(val, path);
      } else if (typeof val === "boolean") {
        addToggle(path, path, val);
      }
    }
  }
  walk(flags);
  document.body.appendChild(panel);
}

export const FeatureFlagProvider = ({ children }) => {
  const [flags, setFlags] = useState(() => {
    const local = loadLocalFlags();
    const merged = mergeDeep(DEFAULT_FLAGS, local);
    // Expose initial flags on window so other code can read them.
    if (typeof window !== "undefined") {
      window.__FLAGS__ = merged;
    }
    return merged;
  });

  useEffect(() => {
    let cancelled = false;
    async function loadRemote() {
      const remote = await fetchRemoteFlags();
      if (cancelled) return;
      if (Object.keys(remote).length > 0) {
        setFlags((prev) => {
          const merged = mergeDeep(prev, remote);
          saveLocalFlags(merged);
          if (typeof window !== "undefined") {
            window.__FLAGS__ = merged;
          }
          return merged;
        });
      }
    }
    loadRemote();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist and expose flags whenever they change.  Avoid unnecessary
  // writes by using an effect rather than performing I/O in state
  // setters.
  useEffect(() => {
    saveLocalFlags(flags);
    if (typeof window !== "undefined") {
      window.__FLAGS__ = flags;
    }
  }, [flags]);

  // Insert dev panel once on mount.
  useEffect(() => {
    createDevPanel(flags, setFlags);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <FeatureFlagContext.Provider value={{ flags, setFlags }}>
      {children}
    </FeatureFlagContext.Provider>
  );
};

/**
 * Hook to access feature flags.  When used outside of a provider it
 * falls back to reading from `window.__FLAGS__`, ensuring that flags
 * are still available even if the provider was not used.
 */
export function useFeatureFlags() {
  const ctx = useContext(FeatureFlagContext);
  if (ctx) return ctx;
  // Fallback to global object when no provider is present.
  const flags =
    (typeof window !== "undefined" && window.__FLAGS__) || DEFAULT_FLAGS;
  return { flags, setFlags: () => {} };
}

export default FeatureFlagContext;

// -----------------------------------------------------------------------------
// Global initialisation for feature flags when no provider is mounted.  This
// block runs immediately when the module is imported.  It merges defaults
// with any persisted flags from localStorage, assigns the result to
// window.__FLAGS__ and optionally fetches remote flags from /api/flags.  A
// lightweight developer panel is also inserted in non‑production builds so
// flags can be toggled manually.  When a flag is changed via the panel the
// global flags and localStorage are updated.
if (typeof window !== "undefined") {
  const local = loadLocalFlags();
  const initial = mergeDeep(DEFAULT_FLAGS, local);
  window.__FLAGS__ = initial;
  // Define a setter that updates global flags and persists them.
  const updateGlobalFlags = (updateFn) => {
    const newFlags = updateFn(window.__FLAGS__);
    saveLocalFlags(newFlags);
    window.__FLAGS__ = newFlags;
  };
  // Create dev panel once immediately.  Pass our update function so
  // toggles modify global flags even outside of a provider.
  createDevPanel(window.__FLAGS__, updateGlobalFlags);
  // Attempt to fetch remote flags asynchronously.  Merge and persist
  // them if present.
  (async () => {
    const remote = await fetchRemoteFlags();
    if (remote && Object.keys(remote).length > 0) {
      const merged = mergeDeep(window.__FLAGS__, remote);
      window.__FLAGS__ = merged;
      saveLocalFlags(merged);
    }
  })();
}
