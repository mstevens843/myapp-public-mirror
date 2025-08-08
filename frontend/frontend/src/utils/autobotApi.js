import { authFetch } from "@/utils/authFetch";
// Import the standalone track function.  This helper will be a no-op
// when telemetry is disabled via feature flags.
import { track } from "@/hooks/useTelemetry";

/* ---------------------------------------------------------------------
 * Single-strategy helpers (now bot-instance aware)
 *
 * These functions wrap backend API calls and provide optional telemetry.
 * Each call uses the resilient authFetch wrapper and emits telemetry
 * events for bot lifecycle events.  Errors are propagated so callers
 * can handle them gracefully.
 *
 * Events fired:
 *   bot_launch – on successful start of a strategy
 *   bot_stop   – on successful pause/stop
 *   bot_error  – on any error (network, status error, etc.)
 *
 * Telemetry is disabled by default and controlled by feature flags.
 * ------------------------------------------------------------------ */

/**
 * Start a new trading strategy.  Will throw if the backend returns a
 * non‑200 response or the fetch itself fails.  On success it fires a
 * `bot_launch` telemetry event containing the mode and config.
 *
 * @param {string} mode - The strategy/mode to start.
 * @param {object} config - Configuration object for the strategy.
 * @param {boolean} [autoRestart=false] - Whether to auto restart.
 */
export const startStrategy = async (mode, config, autoRestart = false) => {
  // optional: log to dev console for debugging
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
    // Emit a bot_error telemetry event.
    track("bot_error", { action: "startStrategy", error: err.message });
    throw new Error(err.message || "Network error while contacting backend");
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    // If response isn't JSON (e.g. HTML from proxy error), ignore
  }
  if (!res.ok) {
    const errorMsg =
      data?.error || res.statusText || "Failed to start strategy";
    // emit telemetry on error
    track("bot_error", { action: "startStrategy", error: errorMsg });
    throw new Error(errorMsg);
  }
  // Success – emit bot_launch telemetry.
  track("bot_launch", { mode, config, autoRestart });
  return data;
};

/* ------------------------------------------------------------------ *
 *  Runtime controls
 * ------------------------------------------------------------------ */

/**
 * Pause (stop) a running strategy.  On success this fires a `bot_stop`
 * telemetry event.  Pause and stop are synonymous in this codebase.
 *
 * @param {string} botId - The ID of the bot instance.
 */
export const pauseStrategy = async (botId) => {
  try {
    const res = await authFetch("/api/mode/pause", {
      method: "POST",
      body: JSON.stringify({ botId }),
    });
    const data = await res.json();
    if (!res.ok) {
      track("bot_error", { action: "pauseStrategy", error: data.error });
      throw new Error(data.error || "Failed to pause strategy");
    }
    // success – emit bot_stop
    track("bot_stop", { botId });
    return data;
  } catch (err) {
    // network error
    track("bot_error", { action: "pauseStrategy", error: err.message });
    throw err;
  }
};

/**
 * Alias stopStrategy to pauseStrategy.  When called directly, it still
 * emits the bot_stop event.
 */
export const stopStrategy = pauseStrategy;

/**
 * Resume a paused strategy.  Does not fire telemetry other than on error.
 *
 * @param {string} botId - The ID of the bot instance.
 */
export const resumeStrategy = async (botId) => {
  try {
    const res = await authFetch("/api/mode/resume", {
      method: "POST",
      body: JSON.stringify({ botId }),
    });
    const data = await res.json();
    if (!res.ok) {
      track("bot_error", { action: "resumeStrategy", error: data.error });
      throw new Error(data.error || "Failed to resume strategy");
    }
    return data;
  } catch (err) {
    track("bot_error", { action: "resumeStrategy", error: err.message });
    throw err;
  }
};

/**
 * Delete a strategy instance.  Does not fire telemetry other than on error.
 *
 * @param {string} botId - The ID of the bot instance.
 */
export const deleteStrategy = async (botId) => {
  try {
    const res = await authFetch("/api/mode/delete", {
      method: "POST",
      body: JSON.stringify({ botId }),
    });
    const data = await res.json();
    if (!res.ok) {
      track("bot_error", { action: "deleteStrategy", error: data.error });
      throw new Error(data.error || "Failed to delete strategy");
    }
    return data;
  } catch (err) {
    track("bot_error", { action: "deleteStrategy", error: err.message });
    throw err;
  }
};

/* ---------------------------------------------------------------------
 * Status & diagnostics
 * ------------------------------------------------------------------ */

export const fetchBotStatus = async () => {
  try {
    const res = await authFetch("/api/mode/status");
    if (!res.ok) {
      track("bot_error", { action: "fetchBotStatus", error: "Failed to fetch status" });
      throw new Error("Failed to fetch status");
    }
    return res.json();
  } catch (err) {
    track("bot_error", { action: "fetchBotStatus", error: err.message });
    throw err;
  }
};

export const fetchDetailedStatus = async () => {
  try {
    const res = await authFetch("/api/mode/status/detailed");
    if (!res.ok) {
      track("bot_error", {
        action: "fetchDetailedStatus",
        error: "Failed to fetch detailed status",
      });
      throw new Error("Failed to fetch detailed status");
    }
    return res.json();
  } catch (err) {
    track("bot_error", { action: "fetchDetailedStatus", error: err.message });
    throw err;
  }
};

/* ---------------------------------------------------------------------
 * Saved-config helpers
 * ------------------------------------------------------------------ */

export const saveConfig = async (mode, config, name = "") => {
  try {
    await authFetch("/api/mode/save-config", {
      method: "POST",
      body: JSON.stringify({ mode, config, name }),
    });
  } catch (err) {
    track("bot_error", { action: "saveConfig", error: err.message });
    throw err;
  }
};

export const listSavedConfigs = async () => {
  try {
    const res = await authFetch("/api/mode/list-configs");
    const data = await res.json();
    if (!res.ok) {
      track("bot_error", {
        action: "listSavedConfigs",
        error: data.error,
      });
      throw new Error(data.error || "Failed to list saved configs");
    }
    return data.configs; // [{id, strategy, name, savedAt, config}]
  } catch (err) {
    track("bot_error", { action: "listSavedConfigs", error: err.message });
    throw err;
  }
};

export const deleteSavedConfig = async (id) => {
  try {
    const res = await authFetch(`/api/mode/delete-config/${id}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      track("bot_error", {
        action: "deleteSavedConfig",
        error: data.error,
      });
      throw new Error(data.error || "Failed to delete config");
    }
  } catch (err) {
    track("bot_error", { action: "deleteSavedConfig", error: err.message });
    throw err;
  }
};

export const editSavedConfig = async (id, config, name = "") => {
  try {
    const res = await authFetch(`/api/mode/edit-config/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, config }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      track("bot_error", {
        action: "editSavedConfig",
        error: error,
      });
      throw new Error(error || "Failed to update config");
    }
  } catch (err) {
    track("bot_error", { action: "editSavedConfig", error: err.message });
    throw err;
  }
};

/* ---------------------------------------------------------------------
 * Multi-strategy launcher
 * ------------------------------------------------------------------ */

/**
 * Launch multiple strategies at once.  On success emits bot_launch for
 * each selected strategy in the provided array.  On error emits bot_error.
 *
 * @param {Array<{mode:string, config:object, autoRestart:boolean}>} strategies
 *        A list of strategies to launch.
 */
export const launchMultiStrategyBot = async (strategies) => {
  try {
    const res = await authFetch("/api/mode/start-multi", {
      method: "POST",
      body: JSON.stringify({ strategies }),
    });
    if (!res.ok) {
      const err = await res.json();
      track("bot_error", {
        action: "launchMultiStrategyBot",
        error: err.error,
      });
      throw new Error(err.error || "Failed to launch multi-strategy bot");
    }
    const json = await res.json();
    // emit bot_launch for each strategy individually
    strategies.forEach((s) => {
      track("bot_launch", {
        mode: s.mode,
        config: s.config,
        autoRestart: s.autoRestart ?? false,
      });
    });
    return json;
  } catch (err) {
    track("bot_error", { action: "launchMultiStrategyBot", error: err.message });
    throw err;
  }
};

/**
 * Build the payload for launching multiple strategies.  Takes a list of
 * selected strategy keys and a lookup of configs by strategy.  Returns an
 * array of objects conforming to the backend format.
 *
 * @param {string[]} selected
 * @param {Record<string, any>} configsByStrategy
 * @returns {Array<{mode:string, config:object, autoRestart:boolean}>}
 */
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