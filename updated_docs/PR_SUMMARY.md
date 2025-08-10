# Pull Request Summary

This pull request introduces a comprehensive documentation suite for the
Solana trading bot.  The goal was to build code‑backed documentation with
cross‑referenced line numbers, clarify configuration options and provide
deployment and troubleshooting guidance.  No runtime code changes were made; all
additions reside in Markdown files and helper scripts.

## Inventory and Mapping

During the audit the following key modules and responsibilities were
identified:

| Module | Responsibility | Notes |
|---|---|---|
| `strategies/core/poolCreateListener.js` | Debounce and filter new pool events before starting a snipe | Filters stale slots and avoids duplicate triggers【245844595763714†L70-L99】 |
| `strategies/core/passes.js` | Risk heuristics (holder concentration, LP burn, developer black/whitelists) | Returns `{ ok:false, reason }` when a token fails gating【357496616301582†L23-L86】 |
| `utils/swap.js` | Fetch quotes from Jupiter and perform swaps (standard, turbo, Jito) | Validates `SOLANA_RPC_URL` and `PRIVATE_KEY`, exposes `executeSwap`, `executeSwapTurbo`, `executeSwapJitoBundle`【107868020100458†L19-L25】【107868020100458†L172-L234】 |
| `strategies/core/tradeExecutorTurbo.js` | Orchestrate turbo trades: blockhash prewarm, idempotency, probe & scale, priority fee, leader timing | Configurable via environment variables like `IDEMPOTENCY_TTL_SEC`, `IDEMPOTENCY_SALT`【30051125156274†L190-L199】 |
| `strategies/core/rpcQuorumClient.js` | Send transactions to multiple RPC endpoints and succeed when a quorum acknowledges | Improves reliability across providers【338326861738027†L24-L96】 |
| `strategies/core/parallelFiller.js` | Split orders across multiple wallets with concurrency control | Normalises percentages and collects per‑wallet results【516838933107947†L49-L60】 |
| `utils/ammFallbackGuard.js` | Decide when to fall back to direct AMM based on quote age and volatility | Protects against stale or manipulated router quotes【628800443557218†L0-L37】 |
| `config/featureFlags.js` | Parse `DISABLED_STRATEGIES` and `DISABLED_ENDPOINTS` to globally disable features | Supports fine‑grained feature toggles【8826520530653†L21-L31】 |
| `telegram/index.js` | Telegram bot handlers for start/stop/buy/sell/snipe and session management | Requires `TELEGRAM_BOT_TOKEN` and optional 2FA【673739940498900†L82-L119】【306951265335037†L10-L54】 |
| `armEncryption/` modules | Envelope encryption for private keys and session cache | Implements Argon2id key derivation and AES‑GCM wrapping【593023059091716†L18-L83】【538111966748365†L21-L29】 |
| `middleware/metrics.js` | Define and export Prometheus counters, histograms and gauges | Exposes `/metrics` endpoint and helpers【665845919011301†L38-L63】 |

## Environment Variables (grep snapshot)

The following environment variables were found by scanning the codebase.  Many
control critical behaviours; see `docs/CONFIG_REFERENCE.md` for detailed
descriptions and defaults.  Generated via the helper script
`scripts/extract-env.mjs`:

```
DISABLED_ENDPOINTS
DISABLED_STRATEGIES
ENCRYPTION_SECRET
ENCRYPTION_SECRET_OLD
IDEMPOTENCY_SALT
IDEMPOTENCY_TTL_MS
IDEMPOTENCY_TTL_SEC
JITO_RELAY_URL
METRICS_ALLOW_IPS
METRICS_API_KEY
PRIVATE_KEY
PRIVATE_KEY2
PRIVATE_SOLANA_RPC_URL
SOLANA_RPC_URL
START_TELEGRAM
TELEGRAM_BOT_TOKEN
TWO_FA_ENABLED
TWO_FA_SECRET
DATABASE_URL
COMPUTE_UNIT_PRICE
JITO_TIP_LAMPORTS
MAX_CONCURRENCY
START_STRATEGIES
```

## Added Files and Changes

* **Root README.md** – expanded overview, architecture ASCII diagram and quick
  start instructions.
* **docs/BOT.md** – described bot capabilities, module map and operating
  modes (Turbo, General, Dry‑run).
* **docs/TURBO_SNIPER.md** – detailed the end‑to‑end turbo pipeline,
  latency knobs, error classes and fallback logic.
* **docs/TRADING.md** – explained swap paths, slippage, fees, idempotency and
  quorum send.
* **docs/TELEGRAM.md** – provided setup instructions, command reference,
  interactive flows and rate limits.
* **docs/SECURITY.md** – defined threat model, controls, incident playbook and
  wallet encryption considerations.
* **docs/AUTH.md** – documented sign‑in via wallet and nonce, session cookies,
  CORS/CSRF and roles.
* **docs/WALLET_ENCRYPTION.md** – explained envelope encryption, key derivation
  and session cache behaviours.
* **docs/CONFIG_REFERENCE.md** – comprehensive table of environment variables
  with types, defaults, requirements and code references; updated to include
  metrics and 2FA variables.
* **docs/METRICS.md** – enumerated all Prometheus metrics with labels and
  descriptions; described the `/metrics` endpoint and environment guards.
* **docs/TROUBLESHOOTING.md** – compiled common errors (blockhash expired,
  stale quotes, quorum failures, idempotency, wallet unarmed, 2FA) and fixes
  mapped to code lines.
* **docs/DEPLOYMENT.md** – provided environment matrix, process management,
  Docker hints, health checks and upgrade strategy.
* **docs/PERFORMANCE.md** – offered latency budgets, RPC pool recommendations,
  fee tuning and scaling guidance.
* **docs/TESTING.md** – outlined unit, integration and load testing; included
  a sample Jest test; provided a dry‑run checklist and CI recommendations.
* **docs/.toc.md** – top‑level documentation index linking all docs.
* **.env.example** – safe example environment file with placeholders and
  comments explaining each variable.
* **scripts/extract-env.mjs** – node script to extract environment variables
  from the codebase.

## Proposed TODOs & Fixes

* **Encryption & secrets** – The code gracefully handles missing
  `ENCRYPTION_SECRET_OLD` but does not rotate secrets on startup.  Consider
  implementing secret rotation in a background task.  Documented as TODO in
  `docs/SECURITY.md`.
* **Testing** – The repository lacks an official test suite.  A future PR
  could introduce Jest with mocks for external services, along with CI
  workflows to run them automatically.
* **Dockerisation** – Provide an official Docker image and container
  orchestration manifests to simplify deployment.

This documentation is intended to be copy‑pasteable and strictly grounded in
code.  Any missing information has been marked as TODOs where appropriate.