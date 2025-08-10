# Architecture

This document describes the high‑level architecture of the Solana trading bot platform.  It explains how backend modules, databases, RPC clients and the frontend interact, and where data flows through the system.  Understanding the architecture will help new contributors extend the bot safely and operators deploy it reliably.

## Overview

The system consists of three primary layers:

1. **Backend** – A Node.js/Express server exposing a REST API and WebSocket channel.  It loads strategies on demand, manages wallet encryption, fetches quotes, builds and sends transactions, and records trades.
2. **Frontend** – A React/Vite application that communicates with the backend via HTTP and WebSocket.  It displays strategies, positions, trade history and metrics in real time.  (The frontend code is not included in this mirror but is referenced in diagrams.)
3. **Database & Storage** – An optional PostgreSQL database persists trades, positions and user preferences.  Encrypted private keys (envelopes) may be stored here as well.  When using a database ensure at‑rest encryption and regular backups.

The backend is stateless except for in‑memory caches (e.g. idempotency store, session key cache).  Environment variables and strategy configuration objects drive its behaviour.  See [`docs/CONFIG_REFERENCE.md`](CONFIG_REFERENCE.md) for a full list.

## Data Flow

The trading pipeline can be summarised as follows:

```
Event (new pool detected)
   ↓
Passes & heuristics (holder concentration, LP burn, developer heuristics)
   ↓
Quote acquisition (Jupiter / direct AMM)
   ↓
Transaction build (standard / turbo / Jito bundle)
   ↓
Send & confirm (RPC quorum client)
   ↓
Post‑trade actions (record in DB, send alerts, update metrics)
```

1. **Event ingestion** – A pool watcher listens for new AMM pool creations.  `poolCreateListener.js` debounces events and filters them by slot age【245844595763714†L70-L99】.
2. **Passes & heuristics** – Before trading, the bot runs risk checks defined in `passes.js`, such as creator blacklists, holder concentration limits and LP burn thresholds【357496616301582†L23-L86】.
3. **Quote acquisition** – The helper `getSwapQuote` obtains prices from Jupiter.  When quotes are stale or the router fails, the bot can fall back to a direct AMM swap【774855396523611†L31-L54】.
4. **Build & send** – The executor constructs a transaction, signs it using the loaded Keypair, prewarms a blockhash, assigns a compute unit price and sends it through a quorum of RPC endpoints.  In turbo mode it may send a probe and then scale the remainder【774855396523611†L31-L54】.
5. **Post‑trade** – Successful trades are persisted (if a database is configured), alerts are sent via Telegram, take‑profit/stop‑loss orders may be scheduled, and metrics are recorded.

## Backend Modules

| Module                      | Responsibility | Related Docs |
|-----------------------------|---------------|--------------|
| `poolCreateListener.js`     | Listens for pool initialisation events, debounces duplicates and filters by slot age. | [`docs/TRADING.md`](TRADING.md) |
| `passes.js`                 | Implements risk heuristics: whitelists/blacklists, holder concentration, LP burn, price/volume filters【357496616301582†L23-L86】. | [`docs/BOT_STRATEGIES.md`](BOT_STRATEGIES.md) |
| `swap.js`                   | Fetches swap quotes and executes swaps via standard, turbo or Jito paths.  Handles slippage, compute unit pricing and idempotency【774855396523611†L31-L54】. | [`docs/TRADING.md`](TRADING.md) |
| `tradeExecutorTurbo.js`     | Orchestrates the hot path: prewarms blockhashes, derives idempotency keys, obtains quotes, sends probe/scale transactions and records trades【30051125156274†L190-L200】. | [`docs/strategies/turbo.md`](strategies/turbo.md) |
| `parallelFiller.js`         | Splits orders across multiple wallets, enforces concurrency limits and aggregates results【516838933107947†L49-L60】. | [`docs/PERFORMANCE.md`](PERFORMANCE.md) |
| `rpcQuorumClient.js`        | Sends transactions to multiple RPC endpoints and returns when a quorum of acknowledgements is received【338326861738027†L24-L96】. | [`docs/PERFORMANCE.md`](PERFORMANCE.md) |
| `armEncryption/`            | Provides envelope encryption, key wrapping/unwrapping and session key cache【670737199171197†L10-L48】. | [`docs/WALLET_ENCRYPTION.md`](WALLET_ENCRYPTION.md) |
| `telegram/`                 | Implements the Telegram bot, command handlers, session state and access control【730573471933121†L29-L69】. | [`docs/TELEGRAM.md`](TELEGRAM.md) |

## Queues & Concurrency

The bot does not use an external message queue.  Instead, concurrency is controlled via in‑memory schedules:

* **Idempotency cache** – Prevents duplicate buys within a configured TTL using keys derived from token, slot and salt【30051125156274†L190-L200】.
* **Session key cache** – Stores Data Encryption Keys (DEKs) for armed wallets with an expiry, ensuring keys are zeroised after use【670737199171197†L35-L49】.
* **RPC quorum** – Maintains multiple connections to RPC endpoints and sends transactions in parallel until a quorum acknowledges.
* **Parallel filler** – Splits orders across multiple wallets and limits concurrency to avoid saturating RPC endpoints【516838933107947†L49-L60】.

## Database & Storage

While this mirror does not include migrations, the backend can record trades and positions in a PostgreSQL database.  When using a database:

* Set `DATABASE_URL` in `.env` to the PostgreSQL connection string (see [`docs/CONFIG_REFERENCE.md`](CONFIG_REFERENCE.md)).
* Enable encryption at rest and regular backups.
* Store encrypted private key envelopes in a secrets table rather than in environment files.  See [`docs/WALLET_ENCRYPTION.md`](WALLET_ENCRYPTION.md) for the envelope format.

## Frontend & WebSocket

The React/Vite frontend connects to the backend via HTTP for API calls and via WebSocket for log streaming.  Console logs emitted by backend modules are broadcasted to all connected clients, providing real‑time visibility into strategy events, errors and performance metrics.  The frontend presents dashboards for strategy management, positions, trade history, performance charts and settings.

## Next Steps

* For environment variables and configuration options see [`docs/CONFIG_REFERENCE.md`](CONFIG_REFERENCE.md).
* To deploy this architecture in production, read [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).
* To understand how strategies are designed and extended, read [`docs/BOT_STRATEGIES.md`](BOT_STRATEGIES.md).
* For a visual representation of the architecture, refer to the diagram in the README or create your own and place it under `docs/assets/`.
