# Diff Summary

This summary lists the new or updated files introduced in the documentation overhaul along with key changes.

## Top‑Level Files

- **README.md** – Complete rewrite providing an app‑wide overview, feature list, quick start instructions, repository map and module descriptions.
- **CONTRIBUTING.md** – Added guidelines for code of conduct, branching, commit messages, PR process and style conventions.
- **CHANGELOG.md** – Seeded with initial release notes and placeholder for future changes.
- **LICENSE** – Added placeholder license (“All rights reserved”).
- **.github** templates – Added pull request and issue templates with structured checklists.
- **Lint & Spell Configs** – Added `.markdownlint.json`, `.spellcheckignore`, `.mlc.config.json` and `.cspell.json` for linting and spell‑checking.

## Core Docs (docs/)

- **ARCHITECTURE.md** – High‑level architecture diagram description and module map.
- **CONFIG_REFERENCE.md** – Exhaustive table of environment variables with types, defaults, usage and examples.
- **DEPLOYMENT.md** – Instructions for running the backend and frontend, process management, autoscaling, health checks and containerisation.
- **SECURITY.md** – Threat model, key storage, encryption, 2FA, RBAC, rate limits and incident playbook.
- **CORS.md** – CORS policy explanation with environment controls and Express snippet.
- **API.md** – REST and WebSocket overview with placeholder endpoints and error envelope shape.
- **AUTH.md** – Web2/Web3 authentication flows, session management, 2FA and recovery.
- **WALLET_ENCRYPTION.md** – Envelope encryption scheme for private keys and arm‑to‑trade process.
- **TELEGRAM.md** – Setup instructions, command reference, interactive flows and alerts.
- **TRADING.md** – How quotes are obtained, swap paths (standard, turbo, Jito), slippage, sizing, fees, idempotency and quorum.
- **BOT_STRATEGIES.md** – List of eleven strategies with one‑line descriptions and primary knobs; links to the turbo detail page.
- **strategies/turbo.md** – Detailed turbo pipeline, knobs, error classes, fallback logic and best practices.
- **PERFORMANCE.md** – Latency budget, RPC pool recommendations, fee/tip tuning, concurrency and scaling.
- **TESTING.md** – Unit, integration and load testing guidance, dry‑run checklist and CI considerations.
- **TROUBLESHOOTING.md** – Common issues (blockhash expiry, stale quotes, quorum failures, idempotency, wallet arm, 2FA), causes and resolutions.
- **ONBOARDING.md** – 15‑minute developer fast‑lane from clone to first dry run, with environment setup and FAQ.
- **SUBSCRIPTIONS.md** – Conceptual guide to plans, entitlements, rate limiting and billing integration with placeholders.

## Examples (docs/examples/)

- **.env.example** – Comprehensive, commented environment template covering RPCs, keys, encryption, idempotency, feature flags, CORS, metrics, subscriptions and more.
- **cors.express.js** – Hardened Express snippet implementing allowlist‑based CORS with Helmet, preflight caching and method rejection.
- **docker-compose.yml** – Minimal stack for backend, frontend and PostgreSQL with environment file support.
- **openapi.yaml** – OpenAPI 3.0 scaffold with auth, strategies, trades and wallets paths and error envelope schema.

## Meta

- **PR_DRAFT.md** – Draft pull request description summarising the overhaul and including review checklists and CI results.
- **MANIFEST.json** – Machine‑readable manifest listing all generated files with SHA‑256 hashes and lint results.

## Removed Content

The old `updated_docs/` structure and turbo‑centric docs have been superseded by this unified docs set.  Turbo‑specific content has been isolated to `docs/strategies/turbo.md`.