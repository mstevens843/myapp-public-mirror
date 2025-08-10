# Cross‑Origin Resource Sharing (CORS)

This guide explains how to configure Cross‑Origin Resource Sharing (CORS) for the trading bot’s REST API.  CORS is required when your frontend is hosted on a different domain than the backend.  Improper configuration can expose your API to abuse; follow this recipe to strike a balance between security and flexibility.

## Overview

By default the Express server denies cross‑origin requests.  When `CORS_ENABLED=true` it applies a whitelist based on the `CORS_ALLOWED_ORIGINS` environment variable.  Preflight requests are handled automatically.  Credentials (cookies, authorization headers) are disabled by default to prevent session hijacking.

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `CORS_ENABLED` | Set to `true` to enable the CORS middleware; any other value disables it. | `false` |
| `CORS_ALLOWED_ORIGINS` | Comma‑separated list of allowed origins (e.g. `https://app.example.com,https://admin.example.com`).  Use fully qualified URLs.  Wildcards (`*`) are not permitted in production. | none |
| `CORS_ALLOW_HEADERS` | Comma‑separated list of allowed request headers (e.g. `Authorization,Content-Type`). | `Authorization,Content-Type` |
| `CORS_ALLOW_METHODS` | Comma‑separated list of allowed methods (`GET,POST,PUT,PATCH,DELETE`). | `GET,POST,PUT,PATCH,DELETE` |
| `CORS_CREDENTIALS` | Set to `true` to allow cookies and credentials.  Disabled by default. | `false` |
| `CORS_MAX_AGE` | The `Access-Control-Max-Age` header in seconds, controlling how long the preflight response may be cached.  Recommended to be ≤ 600. | `600` |

## Express Middleware

To enable CORS in your Express server, install [`cors`](https://npmjs.com/package/cors) and [`helmet`](https://npmjs.com/package/helmet`).  Use the sample snippet below or the file at `docs/examples/cors.express.js`.

```js
const cors = require('cors');
const helmet = require('helmet');

// Load environment variables
const enabled = process.env.CORS_ENABLED === 'true';
const allowOrigins = process.env.CORS_ALLOWED_ORIGINS ? process.env.CORS_ALLOWED_ORIGINS.split(',') : [];

const corsOptions = {
  origin: (origin, callback) => {
    if (!enabled) return callback(null, false);
    // Allow requests without origin (e.g. curl) or whitelisted origins
    if (!origin || allowOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'), false);
  },
  methods: process.env.CORS_ALLOW_METHODS || 'GET,POST,PUT,PATCH,DELETE',
  allowedHeaders: process.env.CORS_ALLOW_HEADERS || 'Authorization,Content-Type',
  credentials: process.env.CORS_CREDENTIALS === 'true',
  maxAge: Number(process.env.CORS_MAX_AGE || 600),
};

app.use(helmet());
app.use(cors(corsOptions));
```

### Best Practices

* **Whitelisting** – Always list specific origins in `CORS_ALLOWED_ORIGINS`.  Avoid using `*` in production as it allows any site to call your API.
* **Preflight caching** – Set `CORS_MAX_AGE` to a reasonable value (≤ 600 seconds) to reduce browser overhead without leaving stale permissions in place.
* **Credentials** – Leave `CORS_CREDENTIALS=false` unless your frontend relies on session cookies.  When enabling credentials, ensure that cookies are marked `HttpOnly`, `Secure` and `SameSite=Lax` (see [`docs/AUTH.md`](AUTH.md)).
* **Invalid requests** – Deny non‑preflight invalid methods early to reduce processing overhead.  Validate incoming `Origin` headers and drop requests missing an origin if you expect only browser clients.

## Next Steps

* Set `CORS_ENABLED=true` and configure allowed origins in your `.env` file.  See [`docs/examples/.env.example`](examples/.env.example) for an example.
* For a hardened snippet ready to drop into your project, see `docs/examples/cors.express.js`.
* To understand authentication and CSRF protections, read [`docs/AUTH.md`](AUTH.md).
