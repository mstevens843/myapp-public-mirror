# Solana Trading Bot Platform

Welcome to a **multi‑strategy trading bot** for the Solana blockchain.  This project combines a fast Node.js/Express backend, a modern React/Vite frontend, optional Telegram integration, and a PostgreSQL database to provide traders and operators with a flexible and secure trading platform.  Eleven built‑in strategies – including scalper, sniper, breakout, dip buyer, trend follower, delayed sniper, rotation bot, rebalancer, chad mode, stealth bot and a paper trader – can be launched individually or together with per‑strategy settings.  New strategies can be added without modifying core logic.

## Features

* **Modular strategy engine** – run multiple bots in parallel with separate wallets and risk profiles.  Each strategy can be started, stopped and configured independently.
* **Real‑time dashboards** – monitor open positions, running strategies, trade history and performance metrics via a responsive frontend.  WebSockets stream logs and status updates instantly.
* **Secure authentication** – sign in with your Solana wallet using message signatures.  Optional two‑factor authentication (2FA) enforces additional security.  Sessions are stored in HTTP‑only cookies with short lifetimes.
* **Encrypted key management** – private keys are never written to disk.  The envelope encryption scheme stores keys encrypted at rest and an **arm‑to‑trade** workflow keeps decryption keys in memory only while trading【670737199171197†L10-L48】.
* **Operator tools** – manage trades via REST API, the web dashboard or the Telegram bot.  Support for take‑profit/stop‑loss, limit orders, dollar‑cost averaging (DCA), portfolio charts and a **paper trader** for safe testing.
* **Observability** – Prometheus metrics and structured logs give insight into latency, error rates and strategy performance.  Use dashboards to track p50/p95/p99 latencies and tune parameters【139586722650660†L42-L46】.
* **Extensible** – add new strategies under `backend/services/strategies/` and document them in `docs/strategies/`.  Configuration and feature flags make it easy to enable or disable parts of the system.

## Quick Start (≈15 minutes)

Follow these steps to get a local environment running and place your first dry trade:

1. **Clone and prepare the repository**

   ```bash
   git clone https://github.com/mstevens843/myapp-public-mirror.git
   cd myapp-public-mirror
   cp docs/examples/.env.example .env    # copy the example env and customise
   ```

   At a minimum set `SOLANA_RPC_URL`, `PRIVATE_KEY`, `ENCRYPTION_SECRET` and (optionally) `START_TELEGRAM`/`TELEGRAM_BOT_TOKEN`.  See [`docs/CONFIG_REFERENCE.md`](docs/CONFIG_REFERENCE.md) for the full list and defaults.

2. **Install dependencies**

   ```bash
   npm install    # install backend dependencies
   cd frontend
   npm install    # install frontend dependencies
   cd ..
   ```

3. **Start services**

   In separate terminals or via a process manager (e.g. pm2):

   ```bash
   # start the backend API (port 3001 by default)
   NODE_ENV=development node backend/index.js

   # start the frontend development server (port 3000)
   cd frontend && npm run dev
   ```

   Open <http://localhost:3000> to access the dashboard.  The backend REST API is available at <http://localhost:3001>.  Health checks and metrics are exposed at `/ping` and `/metrics`.

4. **Run a paper trade**

   Enable the paper trader strategy either from the dashboard or via CLI.  Ensure that `dryRun=true` or `simulated=true` in your strategy config so that transactions are not broadcast.  Use the Telegram bot (`node backend/telegram/index.js`) if you wish to trigger trades from chat.  For a full onboarding walkthrough see [`docs/ONBOARDING.md`](docs/ONBOARDING.md).

5. **Deploy to production**

   Consult [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for guidance on environment variables, process managers, Docker and scaling.  Follow the security practices in [`docs/SECURITY.md`](docs/SECURITY.md) and configure CORS according to [`docs/CORS.md`](docs/CORS.md).

## Repository Map

```
backend/             # Express API, strategy runners, utilities and services
frontend/            # React/Vite dashboard (not included in this mirror)
docs/                # Official documentation (this folder)
docs/examples/       # Example .env, CORS snippet, docker compose and OpenAPI
docs/strategies/     # Per‑strategy deep dives (e.g. turbo.md)
updated_docs/        # Historical drafts used to build these docs (see docs/_inputs_snapshot/)
```

## Core Components

| Component               | Purpose | Related Docs |
|-------------------------|---------|--------------|
| **Strategies**          | Implement trading algorithms such as scalper, sniper and rotation.  Each strategy defines its own heuristics and configuration knobs. | [`docs/BOT_STRATEGIES.md`](docs/BOT_STRATEGIES.md) |
| **Passes & heuristics** | Risk filters that assess holder concentration, LP burn percentage and other metrics before every trade. | [`backend/services/strategies/core/passes.js`](backend/services/strategies/core/passes.js) |
| **Swap utilities**       | Fetch quotes from Jupiter or direct AMMs and execute swaps.  Supports standard, turbo and Jito bundle paths with idempotency and quorum sending【774855396523611†L31-L54】. | [`docs/TRADING.md`](docs/TRADING.md) |
| **Encryption & sessions** | Envelope encryption for private keys and an arm/disarm mechanism that keeps keys in memory only when needed【670737199171197†L35-L49】. | [`docs/WALLET_ENCRYPTION.md`](docs/WALLET_ENCRYPTION.md) |
| **Authentication**      | Web3 message signing and optional 2FA for API and bot flows【38012518862774†L10-L27】. | [`docs/AUTH.md`](docs/AUTH.md) |
| **Telegram interface**  | Allows operators to buy, sell, snipe and manage settings via chat commands with access control【730573471933121†L29-L69】. | [`docs/TELEGRAM.md`](docs/TELEGRAM.md) |
| **Observability**       | Prometheus metrics and structured logs for latency and error rates【139586722650660†L42-L46】. | [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) |
| **Deployment & scaling**| Guidance on process managers, Docker, health checks and autoscaling. | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |

## Next Steps

* **Onboard quickly:** follow the [Developer Onboarding](docs/ONBOARDING.md) guide to go from clone to your first dry run.
* **Configure securely:** read [`docs/CONFIG_REFERENCE.md`](docs/CONFIG_REFERENCE.md) for every environment variable, and [`docs/SECURITY.md`](docs/SECURITY.md) for threat models and controls.
* **Tune performance:** consult [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) to optimise latency, RPC selection and fees.
* **Deep dive strategies:** explore the list of built‑in strategies in [`docs/BOT_STRATEGIES.md`](docs/BOT_STRATEGIES.md).  For Turbo Sniper specifics, see [`docs/strategies/turbo.md`](docs/strategies/turbo.md).
* **Contribute:** see [`CONTRIBUTING.md`](CONTRIBUTING.md) for coding standards, branch naming and PR workflow.  If you spot a gap, add a `[[TODO: …]]` marker so we can address it.

---

_Questions or suggestions?_  Open an issue using the templates in `.github/ISSUE_TEMPLATE/` or propose changes via a pull request.  Thank you for helping to build a safer, more transparent Solana trading ecosystem.