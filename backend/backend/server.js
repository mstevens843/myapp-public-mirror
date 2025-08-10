// Server entry point for the bot controller.  This file mirrors
// `index.js` but exists under the conventional `server.js` name.  It
// includes the same dual‑mode behaviour (CLI vs API + WS) and exposes
// a secure `/metrics` endpoint via the metrics module.  See
// `backend/index.js` for detailed comments.

module.exports = require('./index.js');