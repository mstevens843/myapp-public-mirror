// services/feEvents.js
// Minimal bus to push JSON events toward the WS layer.
let _send = null;

function register(sender) {
  _send = sender; // sender: (objOrString) => void
}

function emit(event) {
  if (!_send) return;
  try {
    // Always send JSON with a channel tag so clients can distinguish from plain logs.
    const payload = JSON.stringify({ channel: "events", ...event });
    _send(payload);
  } catch (e) {
    // best-effort; never throw
    console.warn("[feEvents] emit failed:", e.message);
  }
}

module.exports = { register, emit };
