# Configuration Reference

All runtime behaviour of the trading bot is controlled via **environment variables** and per‑strategy configuration objects.  This reference enumerates every environment variable found in the codebase, its type, default value, whether it is required and where it is used.  Variables marked **Required** must be set before the application will start.  Examples illustrate typical values – **never commit real secrets**.

| Name | Type | Default | Required? | Used In | Example |
|---|---|---|---|---|---|
| `SOLANA_RPC_URL` | string (URL) | none; falls back to `clusterApiUrl('mainnet-beta')` | ✔️ if not using default | Core RPC connection for quotes and swaps; missing or invalid values cause errors in the swap module【212493677272407†L12-L27】. | `https://api.mainnet-beta.solana.com` |
| `PRIVATE_SOLANA_RPC_URL` | string (URL) | empty string | ✖️ | Optional low‑latency RPC used for turbo trades; passed through the strategy config and selected in the executor【212493677272407†L17-L20】. | `https://your-private-rpc.example.com` |
| `JITO_RELAY_URL` | string (URL) | none | ✖️ | Jito MEV relay used by the Jito bundle path; overrides the default relay in `executeSwapJitoBundle`【212493677272407†L21-L23】. | `https://fr.example.jito.network` |
| `PRIVATE_KEY` | string (base58) | none | ✔️ | Base58‑encoded 64‑byte secret used to derive the default wallet keypair【212493677272407†L25-L27】.  Missing this variable causes the bot to throw at startup. | `3i1F...` |
| `PRIVATE_KEY2`, `PRIVATE_KEY3` … | string (base58) | none | ✖️ | Additional wallet secrets for parallel strategies; each is decoded like `PRIVATE_KEY` when present【212493677272407†L29-L31】. | `4kL2...` |
| `TELEGRAM_BOT_TOKEN` | string | none | ✔️ when `START_TELEGRAM=true` | Token for the Telegram bot【212493677272407†L32-L34】. | `123456789:ABCDEF...` |
| `START_TELEGRAM` | string (`"true"`/other) | `false` | ✖️ | Controls whether the Telegram bot is started【212493677272407†L35-L37】. | `true` |
| `ENCRYPTION_SECRET` | hex string (32 bytes) | none | ✔️ | Primary key used to encrypt and decrypt sensitive fields (wallet envelopes, user secrets)【212493677272407†L38-L40】. | `deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef` |
| `ENCRYPTION_SECRET_OLD` | hex string (32 bytes) | `null` | ✖️ | Previous encryption key used during rotation; allows decrypting data encrypted with the old key【212493677272407†L42-L44】. | `cafebabecafebabecafebabecafebabe...` |
| `IDEMPOTENCY_TTL_SEC` | number (seconds) | `90` | ✖️ | Lifetime of idempotency entries in the crash‑safe idempotency store【212493677272407†L45-L55】. | `120` |
| `IDEMPOTENCY_SALT` | string | empty string | ✖️ | Salt appended to the deterministic idempotency key; changing it invalidates outstanding idempotency entries【212493677272407†L49-L52】. | `prod2024` |
| `IDEMPOTENCY_TTL_MS` | number (ms) | `900000` | ✖️ | TTL for the in‑memory idempotency store used by HTTP endpoints and cronjobs【212493677272407†L53-L55】. | `600000` |
| `DISABLED_STRATEGIES` | comma‑separated list | empty string | ✖️ | Names of strategies to disable globally【212493677272407†L56-L58】. | `sniper,scalper` |
| `DISABLED_ENDPOINTS` | comma‑separated list | empty string | ✖️ | API path prefixes to disable; requests starting with these paths return HTTP 503【212493677272407†L59-L61】. | `/mode,/manual` |
| `METRICS_API_KEY` | string | `null` | ✖️ | API key required to access the Prometheus `/metrics` endpoint【212493677272407†L63-L65】. | `mysecret` |
| `METRICS_ALLOW_IPS` | comma‑separated list | empty string | ✖️ | CIDR blocks or IP addresses allowed to scrape metrics【212493677272407†L66-L68】; blank means all IPs are allowed. | `127.0.0.1/32,10.0.0.0/8` |
| `DATABASE_URL` | string (URL) | none | ✖️ | PostgreSQL connection string for persisting trades and positions【212493677272407†L69-L71】. | `postgres://user:pass@host:5432/db` |
| `TWO_FA_ENABLED` | string (`"true"`/other) | `false` | ✖️ | Enables two‑factor authentication for API endpoints and bot actions.  When true, a valid TOTP must be supplied in the `X-2FA-Token` header【212493677272407†L73-L75】. | `true` |
| `TWO_FA_SECRET` | base32 string | none | ✖️ | Shared secret for generating TOTP codes【212493677272407†L77-L79】. | `JBSWY3DPEHPK3PXP` |

### Idempotency & Session

The `IDEMPOTENCY_*` variables control the behaviour of the idempotency cache used by turbo swaps.  Adjust these values to tune how long duplicate trades are suppressed.  See [`docs/TRADING.md`](TRADING.md) for details.  The session key cache for armed wallets is configured via internal constants; set `IDEMPOTENCY_SALT` to a unique value per environment to prevent cross‑environment collisions【212493677272407†L49-L52】.

### Feature Flags & Metrics

Use `DISABLED_STRATEGIES` and `DISABLED_ENDPOINTS` to disable unstable features.  Limit access to the `/metrics` endpoint by setting `METRICS_API_KEY` and `METRICS_ALLOW_IPS`.  See [`docs/PERFORMANCE.md`](PERFORMANCE.md) for guidance on monitoring and tuning.

### Additional Strategy Config

Many runtime behaviours are controlled via per‑strategy configuration objects rather than environment variables.  These include notional amounts, slippage, probe/scale settings, compute unit price ranges, risk heuristics and exit rules.  Refer to configuration files under `backend/services/strategies/` or [`docs/strategies/turbo.md`](strategies/turbo.md) for details.

### Regenerating This Table

This table was built by scanning `process.env` references in the source tree.  To regenerate it automatically, run:

```bash
node scripts/extract-env.mjs ./backend | sort | uniq
```

Then update this file accordingly.
