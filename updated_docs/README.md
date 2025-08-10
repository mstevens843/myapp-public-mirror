# MyApp Solana Trading Platform

## Overview

This repository contains a high‑performance Solana trading bot and its supporting
web interfaces.  The bot ingests newly‑created liquidity pools and market
signals, applies a series of risk and price heuristics, fetches quotes from
Jupiter or directly from AMMs, builds and signs transactions with minimal
latency, and submits them through a quorum of RPC endpoints.  Post‑trade
effects such as trade recording, profit/loss monitoring and Telegram alerts are
handled asynchronously.

The backend is written in Node.js and is organised under the `backend/`
directory.  It includes trading strategies (e.g. **Turbo Sniper**), utilities,
Telegram bot handlers and encryption helpers.  The frontend is a minimal
React/Vite template located under `frontend/`.  Wallet private keys may be
loaded from environment variables or stored encrypted at rest using an envelope
scheme (see `docs/WALLET_ENCRYPTION.md`).

### Key Features

- **Turbo Sniper:** ultra‑low‑latency trade executor that warms quotes,
  prewarms blockhashes, uses idempotency keys and optional Jito bundle
  submission for maximum inclusion probability【30051125156274†L190-L200】.  It
  supports probe/scale buys, liquidity‑aware sizing, priority fee tuning and
  private relay sending.
- **Risk heuristics:** before any purchase the bot runs developer and price
  heuristics to avoid rugs.  These include holder concentration checks,
  liquidity burn minimums and optional insider detection【357496616301582†L23-L86】.
- **Parallel fill:** split orders across multiple wallets to improve first‑fill
  probability while respecting per‑wallet limits【516838933107947†L49-L60】.
- **RPC quorum:** send raw transactions through multiple RPC endpoints and
  consider the send successful once a quorum of acknowledgments is reached【338326861738027†L24-L96】.
- **Telegram bot:** provides a user‑friendly interface for manual trading,
  watching positions, take‑profit/stop‑loss management and other operations
  (see `docs/TELEGRAM.md`).
- **Configurable:** virtually every knob (slippage, priority fees, Jito tips,
  heuristic thresholds, disabled strategies) can be adjusted via environment
  variables or runtime configuration.

### Repository Layout

```
backend/           backend API, trading logic and Telegram bot
  ├── services/    trading strategies, executors and utility services
  │    ├── strategies/core/      core logic for turbo and manual strategies
  │    ├── utils/                 helpers such as pool watcher, rpc pool
  │    └── utils/wallet/          wallet rotation and balance helpers
  ├── utils/       swap execution, RPC management and encryption helpers
  ├── telegram/    Telegram bot, command handlers and user sessions
  └── armEncryption/ envelope encryption and arm‑to‑trade session manager

frontend/          minimal React/Vite front‑end (optional)

docs/              generated documentation for operators and developers
```

### Architecture (high level)

The following ASCII diagram summarises the core data flow from event ingestion
to post‑trade processing.  Boxes represent modules/files and arrows indicate
data flow:

```
┌───────────────────┐
│ Pool/event source │  <───── pump.fun API / pool watcher
└─────────┬─────────┘
          │
          ▼
 ┌──────────────────────────┐
 │ poolCreateListener.js    │  (debounces pool events and drops stale slots【245844595763714†L70-L99】)
 └─────────┬────────────────┘
          │ mint
          ▼
 ┌──────────────────────────┐
 │ passes.js                │  (risk heuristics: price/volume/mcap/dev checks【357496616301582†L23-L86】)
 └─────────┬────────────────┘
          │ ok/fail
          ▼
 ┌──────────────────────────┐
 │ swap.js                  │  (fetch quote via Jupiter, slippage & dex hints【107868020100458†L49-L83】)
 └─────────┬────────────────┘
          │ quote
          ▼
 ┌──────────────────────────┐
 │ tradeExecutorTurbo.js    │  (size, probe & scale, idempotency, build tx【30051125156274†L190-L200】)
 └─────────┬────────────────┘
          │ serialized tx
          ▼
 ┌──────────────────────────┐
 │ parallelFiller.js        │  (split across wallets & race for fill【516838933107947†L49-L60】)
 └─────────┬────────────────┘
          │ tx(s)
          ▼
 ┌──────────────────────────┐
 │ rpcQuorumClient.js       │  (send through N RPCs until M acks【338326861738027†L24-L96】)
 └─────────┬────────────────┘
          │ signature
          ▼
 ┌──────────────────────────┐
 │ Post‑trade effects       │  (trade record, TP/SL insertion, Telegram alert)
 └──────────────────────────┘
```

### Quick Start (development)

1. **Install dependencies:** Ensure you have a recent Node.js (LTS) and npm
   installed.  From the repository root, install dependencies:

   ```sh
   cd backend
   npm install
   ```

2. **Prepare your environment:** Copy the `.env.example` (to be generated via
   documentation) into `.env` and populate required variables such as
   `SOLANA_RPC_URL`, `PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, etc.  See
   `docs/CONFIG_REFERENCE.md` for a complete list.

3. **Run the bot:** For a dry‑run (no on‑chain transactions), start the
   Turbo Sniper strategy with simulation enabled.  A simple script might look
   like:

   ```sh
   node backend/services/strategies/turboSniper.js --dryRun
   ```

   The actual command may vary depending on your preferred strategy and CLI
   wrapper.  Refer to each strategy module for details.

4. **Run the Telegram bot:** To enable the Telegram interface set
   `START_TELEGRAM=true` in your environment and run:

   ```sh
   node backend/telegram/index.js
   ```

5. **Visit the documentation:** Additional guides are under `docs/`.

#### First Run Tips

- Start with a small `notional` amount and `dryRun` enabled to familiarise
  yourself with the flow.
- Monitor logs for messages like `rpc-quorum-not-reached` or `dev/creator risk`
  to adjust your RPC pool or heuristics.
- Use the Telegram bot `/menu` to explore commands and monitor positions.

### Contributing

Contributions should follow a docs‑first approach.  Before implementing new
features or changing defaults, update or add documentation under `docs/` with
references to the relevant code (file and line numbers).  Run a dry‑run
checklist to ensure quick start commands still work.