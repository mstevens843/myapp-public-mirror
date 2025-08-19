// Debugging utilities for Breakout inputs
// Maintains a ring buffer of the last 1000 input events and exposes a
// helper to download the trace. Logs are gated behind
// localStorage.BREAKOUT_DEBUG === "1" so they remain silent by default.

// In-memory ring buffer attached to window so it persists across module
// reloads. Each entry includes a timestamp for easier correlation.
function ensureBuffer() {
  if (typeof window === 'undefined') return [];
  if (!window.__BREAKOUT_INPUT_TRACE) {
    window.__BREAKOUT_INPUT_TRACE = [];
  }
  return window.__BREAKOUT_INPUT_TRACE;
}

function pushEntry(entry) {
  const buffer = ensureBuffer();
  const item = { ts: Date.now(), ...entry };
  buffer.push(item);
  // Keep the buffer bounded to 1000 entries
  if (buffer.length > 1000) {
    buffer.shift();
  }
}

export function logChange({ comp, field, raw, prev, next }) {
  try {
    if (typeof window === 'undefined') return;
    if (localStorage.BREAKOUT_DEBUG !== '1') return;
    pushEntry({ type: 'change', comp, field, raw, prev, next });
    // eslint-disable-next-line no-console
    console.log(`[${comp}] change`, { field, raw, prev, next });
  } catch (_) {
    // noop
  }
}

export function logBlur({ comp, field, before, after }) {
  try {
    if (typeof window === 'undefined') return;
    if (localStorage.BREAKOUT_DEBUG !== '1') return;
    pushEntry({ type: 'blur', comp, field, before, after });
    // eslint-disable-next-line no-console
    console.log(`[${comp}] blur`, { field, before, after });
  } catch (_) {
    // noop
  }
}

export function logEffect({ comp, reason, touched }) {
  try {
    if (typeof window === 'undefined') return;
    if (localStorage.BREAKOUT_DEBUG !== '1') return;
    pushEntry({ type: 'effect', comp, reason, touched });
    // eslint-disable-next-line no-console
    console.log(`[${comp}] effect`, { reason, touched });
  } catch (_) {
    // noop
  }
}

// Expose a helper on window that downloads the current trace as a JSON file.
if (typeof window !== 'undefined') {
  window.dumpBreakoutTrace = function dumpBreakoutTrace() {
    try {
      const data = JSON.stringify(ensureBuffer(), null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'breakout-trace.json';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch (_) {
      // noop
    }
  };
}