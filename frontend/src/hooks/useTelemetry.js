// hooks/useTelemetry.js
// Lightweight telemetry hook and helper for event tracking.  This
// implementation deliberately avoids introducing a backend dependency.
// When telemetry is disabled or unsupported the exported `track` function
// becomes a no‑op.  Otherwise it will POST to a configured endpoint
// (window.__FLAGS__.telemetryEndpoint) if present or queue events in
// memory for the remainder of the session.  Queued events are not
// persisted across navigations.

let _queue = [];

/**
 * Send or queue a telemetry event.  When the `telemetry` feature flag
 * is false this function simply returns without doing anything.  If a
 * `telemetryEndpoint` is defined on `window.__FLAGS__` the event will
 * be sent immediately via a POST request; otherwise it will be held
 * in memory until the page unloads.
 *
 * @param {string} event - Event name, e.g. "bot_launch", "bot_stop".
 * @param {object} [payload] - Additional structured data to send with the event.
 */
export function track(event, payload = {}) {
  if (typeof window === "undefined") return;
  const flags = window.__FLAGS__ || {};
  if (!flags.telemetry) {
    // Telemetry is disabled; do nothing.
    return;
  }
  const record = {
    event,
    payload: payload || {},
    timestamp: Date.now(),
  };
  // If a telemetryEndpoint is configured, attempt to POST.  Ignore
  // network errors silently—this is best‑effort only.  Use a fire and
  // forget pattern to avoid blocking callers.
  if (flags.telemetryEndpoint) {
    try {
      // Fire and forget; deliberately not awaiting the promise.
      fetch(flags.telemetryEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Ignore fetch errors completely.
    }
  } else {
    _queue.push(record);
  }
}

/**
 * React hook that returns the `track` function.  This hook allows
 * consumers to import a single default export and call it as a
 * function.  It does not create any additional state.
 */
export default function useTelemetry() {
  return track;
}
