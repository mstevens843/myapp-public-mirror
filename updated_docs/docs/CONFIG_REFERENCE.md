## Configuration Reference

All runtime configuration for the bot is controlled via environment variables
and strategy config objects.  This reference enumerates every environment
variable found in the codebase, its type, default value and where it is used.
Variables marked **required** must be set before the application will start.
Examples below illustrate typical values; do **not** commit real secrets.

| Name | Type | Default | Required? | Source (file & lines) | Example |
|---|---|---|---|---|---|
| `SOLANA_RPC_URL` | string (URL) | none; falls back to `clusterApiUrl('mainnet‑beta')` | ✔️ if not using default | Used by the core connection, swap helpers and RPC manager.  If missing or not starting with `http` the swap module throws an error【107868020100458†L19-L25】. | `https://api.mainnet-beta.solana.com` |
| `PRIVATE_SOLANA_RPC_URL` | string (URL) | empty | ✖️ | Optional private RPC endpoint used for turbo trades when configured.  Passed through strategy config in `turboSniper`【3263186037645†L382-L384】 and selected in the executor【30051125156274†L490-L493】. | `https://your-private-rpc.example.com` |
| `JITO_RELAY_URL` | string (URL) | none | ✖️ | URL of a Jito relay when using the Jito bundle path.  Only referenced in `executeSwapJitoBundle` where it overrides the default relay【107868020100458†L284-L285】. | `https://fr.example.jito.network` |
| `PRIVATE_KEY` | string (base58) | none | ✔️ | Base58‑encoded 64‑byte secret used to derive the default wallet keypair.  Loaded and decoded in the swap utility【107868020100458†L35-L41】.  Missing this variable causes the bot to throw at startup. | `3i1F...` |
| `PRIVATE_KEY2`, `PRIVATE_KEY3` … | string (base58) | none | ✖️ | Additional wallet secrets for parallel strategies.  Each is decoded in the same manner as `PRIVATE_KEY` when present. | `4kL2...` |
| `TELEGRAM_BOT_TOKEN` | string | none | ✔️ when `START_TELEGRAM=true` | Token for the Telegram bot.  Passed to the `node-telegram-bot-api` constructor【673739940498900†L46-L47】. | `123456789:ABCDEF...` |
| `START_TELEGRAM` | string (`"true"`/other) | `false` | ✖️ | Controls whether the Telegram bot is started.  If not equal to `"true"` the bot startup is skipped【673739940498900†L0-L4】. | `true` |
| `ENCRYPTION_SECRET` | hex string (32 bytes) | none | ✔️ | Primary key used to encrypt and decrypt sensitive fields.  The `encryption` module requires a 64‑character hex string and throws if missing【101048639847225†L6-L14】. | `deadbeef...` |
| `ENCRYPTION_SECRET_OLD` | hex string (32 bytes) | `null` | ✖️ | Previous encryption key used for key rotation.  Included to allow decrypting records encrypted with the old key【101048639847225†L6-L21】. | `cafebabe...` |
| `IDEMPOTENCY_TTL_SEC` | number (seconds) | `90` | ✖️ | Lifetime of idempotency entries in the crash‑safe idempotency store.  Used when constructing the core idempotency store【30051125156274†L190-L199】【30051125156274†L1439-L1443】. | `120` |
| `IDEMPOTENCY_SALT` | string | `""` (empty) | ✖️ | Salt appended to the deterministic idempotency key.  Changing the salt invalidates outstanding idempotency entries【30051125156274†L190-L199】【30051125156274†L1439-L1443】. | `prod2024` |
| `IDEMPOTENCY_TTL_MS` | number (milliseconds) | `900000` (15 min) | ✖️ | TTL for the simple in‑memory idempotency store used by HTTP endpoints and cronjobs【692999803040974†L0-L2】. | `600000` |
| `DISABLED_STRATEGIES` | comma‑separated list | `""` | ✖️ | Names of strategies that should not be allowed to launch.  Parsed into an array in `featureFlags.js`【8826520530653†L21-L31】. | `sniper,scalper` |
| `DISABLED_ENDPOINTS` | comma‑separated list | `""` | ✖️ | API path prefixes to disable.  Requests starting with these paths return HTTP 503【8826520530653†L21-L49】. | `/mode,/manual` |

| `METRICS_API_KEY` | string | `null` | ✖️ | API key required to access the Prometheus `/metrics` endpoint.  If unset the endpoint is unauthenticated【665845919011301†L248-L254】. | `mysecret` |
| `METRICS_ALLOW_IPS` | comma‑separated list | `""` | ✖️ | CIDR blocks or IP addresses allowed to scrape metrics.  Blank means all IPs are allowed【665845919011301†L257-L264】. | `127.0.0.1/32,10.0.0.0/8` |
| `DATABASE_URL` | string (URL) | none | ✖️ | PostgreSQL connection string for persisting trades and positions.  The public mirror does not include migrations; define this if running with a database. | `postgres://user:pass@host:5432/db` |
| `TWO_FA_ENABLED` | string (`"true"`/other) | `false` | ✖️ | Enables two‑factor authentication for API endpoints and bot actions.  When true, a valid TOTP must be supplied in the `X-2FA-Token` header【306951265335037†L10-L54】. | `true` |
| `TWO_FA_SECRET` | base32 string | none | ✖️ | Shared secret for generating TOTP codes for your operator account.  Used by the 2FA middleware to verify provided tokens. | `JBSWY3DPEHPK3PXP` |

### Additional configuration knobs

Many runtime behaviours are controlled via the strategy configuration object
(passed to `TurboSniper` or other strategies) rather than via environment
variables.  These include sizing parameters (`notionalAmount`, `slippage`),
priority fee settings (`autoPriorityFee`, `cuPriceMicroLamportsMin/Max`),
parallel wallet splits, risk heuristics and exit rules.  See the
strategy config files or `docs/TURBO_SNIPER.md` for details.

### Generating this table

This file was generated manually by scanning for `process.env` references.  An
optional script `scripts/extract-env.mjs` can be used to regenerate the
table automatically by walking the source tree and extracting environment
variable names.  See the script for usage.