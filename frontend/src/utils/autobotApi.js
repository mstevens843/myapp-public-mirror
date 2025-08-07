import { authFetch } from "@/utils/authFetch";

/* ---------------------------------------------------------------------
 * Single-strategy helpers (now bot-instance aware)
 * ------------------------------------------------------------------ */

export const startStrategy = async (mode, config, autoRestart = false) => {
  console.log("🌐 POST TO BACKEND:", { mode, config, autoRestart });
  let res;
  try {
    res = await authFetch("/api/mode/start", {
      method: "POST",
      body: JSON.stringify({ mode, config, autoRestart }),
    });
  } catch (err) {
    // Network or CORS-level errors will surface here.  Rethrow with a
    // user-friendly message so the UI can handle it gracefully.
    throw new Error(err.message || "Network error while contacting backend");
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // If response isn't JSON (e.g. HTML from proxy error), ignore
  }
  if (!res.ok) {
    const errorMsg = data?.error || res.statusText || "Failed to start strategy";
    throw new Error(errorMsg);
  }
  return data;
};

/* ------------------------------------------------------------------ *
 *  Runtime controls
 * ------------------------------------------------------------------ */
export const pauseStrategy = async (botId) => {
  const res = await authFetch("/api/mode/pause", {
    method: "POST",
    body: JSON.stringify({ botId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to pause strategy");
  return data;
};

export const stopStrategy = pauseStrategy;

export const resumeStrategy = async (botId) => {
  const res = await authFetch("/api/mode/resume", {
    method: "POST",
    body: JSON.stringify({ botId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to resume strategy");
  return data;
};

export const deleteStrategy = async (botId) => {
  const res = await authFetch("/api/mode/delete", {
    method: "POST",
    body: JSON.stringify({ botId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to delete strategy");
  return data;
};

/* ---------------------------------------------------------------------
 * Status & diagnostics
 * ------------------------------------------------------------------ */

export const fetchBotStatus = async () => {
  const res = await authFetch("/api/mode/status");
  if (!res.ok) throw new Error("Failed to fetch status");
  return res.json();
};

export const fetchDetailedStatus = async () => {
  const res = await authFetch("/api/mode/status/detailed");
  if (!res.ok) throw new Error("Failed to fetch detailed status");
  return res.json();
};

/* ---------------------------------------------------------------------
 * Saved-config helpers
 * ------------------------------------------------------------------ */

export const saveConfig = async (mode, config, name = "") => {
  await authFetch("/api/mode/save-config", {
    method: "POST",
    body: JSON.stringify({ mode, config, name }),
  });
};

export const listSavedConfigs = async () => {
  const res = await authFetch("/api/mode/list-configs");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to list saved configs");
  return data.configs;   // [{id, strategy, name, savedAt, config}]
};

export const deleteSavedConfig = async (id) => {
  const res = await authFetch(`/api/mode/delete-config/${id}`, {
    method: "DELETE",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to delete config");
};


export const editSavedConfig = async (id, config, name = "") => {
  const res = await authFetch(`/api/mode/edit-config/${id}`, {
    method: "PUT",
    body  : JSON.stringify({ name, config }),
  });
  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(error || "Failed to update config");
  }
};

/* ---------------------------------------------------------------------
 * Multi-strategy launcher
 * ------------------------------------------------------------------ */

export const launchMultiStrategyBot = async (strategies) => {
  const res = await authFetch("/api/mode/start-multi", {
    method: "POST",
    body: JSON.stringify({ strategies }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Failed to launch multi-strategy bot");
  }
  return res.json();
};

export const buildMultiStrategyConfig = (selected, configsByStrategy) => {
  const out = [];
  for (const strat of selected) {
    if (configsByStrategy[strat]) {
      out.push({
        mode: strat,
        config: { ...configsByStrategy[strat], enabled: true },
        autoRestart: configsByStrategy[strat].autoRestart ?? false,
      });
    }
  }
  return out;
};