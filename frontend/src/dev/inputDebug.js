/*
 * Instrumentation helpers for breakout strategy configs.
 *
 * These functions maintain a simple ring buffer of recent input and effect
 * events.  When BREAKOUT_DEBUG is set to "1" in localStorage, entries are
 * pushed into the buffer.  The buffer is exposed on window.__BREAKOUT_INPUT_TRACE
 * and can be dumped via window.dumpBreakoutTrace() for offline analysis.
 *
 * Supported event types:
 *   - change: user typed or toggled an input
 *   - blur: user blurred a field (numeric coercion may occur)
 *   - effect: component or effect wrote to config
 *   - focus: element gained focus
 *   - select: text selection range changed
 *   - render: component re‑rendered
 */

const DEFAULT_TRACE_SIZE = 500;

// We lazily initialise the ring buffer only when imported in the browser.
let _ring;
function getRing() {
  if (!_ring) {
    _ring = [];
    // Expose the buffer on window for debugging
    if (typeof window !== "undefined") {
      window.__BREAKOUT_INPUT_TRACE = _ring;
      window.dumpBreakoutTrace = function () {
        try {
          return JSON.stringify(_ring, null, 2);
        } catch (e) {
          return "[]";
        }
      };
    }
  }
  return _ring;
}

function getMax() {
  if (typeof window !== "undefined") {
    const sz = parseInt(window.localStorage?.BREAKOUT_TRACE_SIZE);
    if (Number.isFinite(sz) && sz > 0) return sz;
  }
  return DEFAULT_TRACE_SIZE;
}

function shouldLog() {
  if (typeof window === "undefined") return false;
  return window.localStorage?.BREAKOUT_DEBUG === "1";
}

function pushEntry(entry) {
  const ring = getRing();
  const max = getMax();
  if (ring.length >= max) {
    ring.shift();
  }
  ring.push({ time: Date.now(), ...entry });
}

// Change logging: captures raw string and computed next value
export function logChange({ comp, field, raw, prev, next }) {
  if (!shouldLog()) return;
  pushEntry({ type: "change", comp, field, raw, prev, next });
}

// Blur logging: captures before/after conversion
export function logBlur({ comp, field, before, after }) {
  if (!shouldLog()) return;
  pushEntry({ type: "blur", comp, field, before, after });
}

// Effect logging: used by parents/effects that write to config
export function logEffect({ comp, reason, touched }) {
  if (!shouldLog()) return;
  const touchedList = Array.isArray(touched)
    ? touched
    : touched && typeof touched === "object"
    ? Object.keys(touched)
    : [];
  pushEntry({ type: "effect", comp, reason, touched: touchedList });
}

// Focus logging: when an input or interactive element receives focus
export function logFocus({ comp, field }) {
  if (!shouldLog()) return;
  pushEntry({ type: "focus", comp, field });
}

// Selection logging: captures caret or text selection changes
export function logSelection({ comp, field, start, end }) {
  if (!shouldLog()) return;
  pushEntry({ type: "select", comp, field, start, end });
}

// Render logging: logs each render of a component with optional reason
export function logRender({ comp, fieldSet, reason }) {
  if (!shouldLog()) return;
  pushEntry({ type: "render", comp, fields: fieldSet, reason });
}