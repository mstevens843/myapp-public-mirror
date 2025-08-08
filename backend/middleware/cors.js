const cors = require('cors');

// Dev origins are always allowed during local development.  These cover the
// default ports for Vite and other local tooling.  In production these
// origins must be explicitly configured via environment variables.
const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

/**
 * Builds a CORS middleware instance using an allowâ€‘list.  The list is
 * constructed from the `CORS_ALLOWED_ORIGINS` or `FRONTEND_URL` env vars,
 * combined with sensible development defaults.  Requests without an `Origin`
 * header (e.g. cURL or serverâ€‘toâ€‘server calls) are always allowed.  If the
 * allow list is empty then all origins are permitted.  Credentials are
 * enabled so that cookies may be sent by the browser.
 *
 * @returns {import('cors').CorsHandler} Configured CORS middleware
 */
function createCors() {
  // Read a comma separated list of allowed origins from env, trimming blanks
  let allowedOrigins = (
    process.env.CORS_ALLOWED_ORIGINS ||
    process.env.FRONTEND_URL ||
    ''
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // Always include development origins.  Using a Set removes duplicates.
  allowedOrigins = [...new Set([...allowedOrigins, ...DEV_ORIGINS])];

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. CLI tools, serverâ€‘side calls)
      if (!origin) return callback(null, true);
      // If no allow list is configured, permit all origins
      if (allowedOrigins.length === 0) return callback(null, true);
      // Match against the allow list
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Otherwise reject with a generic CORS error.  Do not reveal the list.
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });
}

module.exports = createCors;