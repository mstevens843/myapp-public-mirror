# Bot Overview

This document describes the trading bot’s capabilities, its core modules and
operating modes.  Each description links back to the source code for audit
ability.  When adding new features or adjusting defaults, update this file with
references to the relevant code lines.

## Capabilities

- **Real‑time liquidity detection** – The bot listens for new AMM pool
  initialisations via the `poolCreateListener` wrapper around the pool watcher.
  Events are debounced on signature and token pair to avoid duplicate
  triggers, and stale events are dropped based on a freshness window【245844595763714†L70-L99】.
- **Heuristic risk gating** – Before buying any token the bot runs a series of
  heuristics defined in `passes.js`.  These include developer/creator
  heuristics (blacklist/whitelist, holder concentration, LP burn percentage and
  optional insider detection), as well as price/volume/mcap filters【357496616301582†L23-L86】.
  Any failure returns an `{ ok:false, reason }` result and increments a
  corresponding metric.
- **Quote acquisition & swap execution** – Quotes are fetched from the Jupiter
  aggregator via `getSwapQuote` with configurable slippage and DEX hints【107868020100458†L49-L83】.
  Standard swaps are executed with `executeSwap`, which signs a Versioned or
  legacy transaction, sends it via the RPC connection and waits for
  confirmation【107868020100458†L106-L166】.  Turbo swaps (`executeSwapTurbo`)
  bypass preflight checks and optionally send via a private RPC for lower
  latency【107868020100458†L172-L234】.  A separate Jito bundle path supports
  submitting bundles to the Jito MEV relay【107868020100458†L242-L289】.
- **Trade executor** – `tradeExecutorTurbo.js` orchestrates the hot path:
  warming blockhashes, computing idempotency keys, obtaining sized quotes,
  optionally sending a probe transaction, scaling the remainder, and recording
  the trade.  Idempotency TTL and salt are configurable via environment
  variables (default 90 sec)【30051125156274†L190-L200】.
- **Parallel filler** – Orders can be split across multiple wallets to improve
  fill probability.  `parallelFiller.js` normalises split percentages and
  schedules transactions with a concurrency cap.  It supports both a class
  instance and a functional API, swallowing per‑wallet errors and returning a
  summary【516838933107947†L49-L60】.
- **RPC quorum sending** – Transactions are sent to multiple RPC endpoints and
  considered sent when a quorum of acknowledgments is received.  The
  `RpcQuorumClient` caches recent blockhashes and exposes `sendRawTransaction`【338326861738027†L24-L96】.
- **Telegram interface** – A Telegram bot provides human‑friendly commands to
  buy, sell, snipe, monitor positions and manage settings.  Commands are
  protected by an `isAuthorized` check and sessions track multi‑step flows
  (see `docs/TELEGRAM.md`).
- **Post‑trade side effects** – After submission the executor records the trade
  in the database, inserts take‑profit/stop‑loss orders where configured,
  sends Telegram alerts and performs auto‑rug checks.  These operations
  happen off the hot path and do not block the transaction send.

## Module Map

| Module                               | Responsibility | References |
|--------------------------------------|---------------|------------|
| `strategies/core/poolCreateListener.js` | Wraps the pool watcher, debounces events and filters by slot age【245844595763714†L70-L99】. | `backend/services/strategies/core/poolCreateListener.js` |
| `strategies/core/passes.js`          | Price/volume/mcap filters and developer heuristics (blacklist/whitelist, holder concentration, LP burn, insider)【357496616301582†L23-L86】【357496616301582†L140-L210】. | `backend/services/strategies/core/passes.js` |
| `utils/swap.js`                      | Fetches quotes from Jupiter and executes swaps; supports turbo and Jito bundle modes【107868020100458†L49-L83】【107868020100458†L172-L234】. | `backend/utils/swap.js` |
| `strategies/core/tradeExecutorTurbo.js` | Orchestrates the turbo path: prewarms blockhashes, builds transactions, handles idempotency and retries, invokes parallel fill and post‑trade hooks【30051125156274†L190-L200】. | `backend/services/strategies/core/tradeExecutorTurbo.js` |
| `strategies/core/rpcQuorumClient.js` | Sends transactions through N endpoints and resolves when M acks succeed【338326861738027†L24-L96】. | `backend/services/strategies/core/rpcQuorumClient.js` |
| `strategies/core/parallelFiller.js`  | Splits orders across multiple wallets; normalises percentages and limits concurrency【516838933107947†L49-L60】. | `backend/services/strategies/core/parallelFiller.js` |
| `utils/ammFallbackGuard.js`          | Decides when to bypass the router and execute directly against an AMM based on quote age and volatility【628800443557218†L0-L37】. | `backend/utils/ammFallbackGuard.js` |
| `config/featureFlags.js`             | Reads `DISABLED_STRATEGIES` and `DISABLED_ENDPOINTS` from environment to globally disable features【8826520530653†L21-L32】. | `backend/config/featureFlags.js` |
| `telegram/index.js` & handlers       | Implements the Telegram bot: commands, session management, access control and integration with trading services【673739940498900†L82-L119】【673739940498900†L160-L259】. | `backend/telegram/index.js` |
| `armEncryption/` modules             | Implements envelope encryption for private keys and arm/disarm sessions【593023059091716†L7-L83】【512100359176476†L20-L47】. | `backend/armEncryption/*.js` |

### Operating Modes

* **Turbo mode:** The default for hot‑path trading.  Uses `tradeExecutorTurbo`
  with blockhash prewarm, parallel fill and optional leader scheduling.  Uses
  `executeSwapTurbo` or `executeSwapJitoBundle` to minimise latency.  When
  `dryRun=true` (passed via CLI or config) the executor short‑circuits after
  building and simulating a transaction, returning the quote without sending.

* **General/manual mode:** Uses the standard `executeSwap` function without
  parallel fill or idempotency.  Suitable for slower strategies or manual
  trades invoked from the Telegram bot or REST API.

* **Dry‑run:** All strategies accept a `simulated` or `dryRun` flag.  When set,
  the executor builds the transaction, estimates fees and returns the
  transaction signature as `null` without broadcasting.  This allows safe
  testing of new strategies and configurations.

### Extending the Bot

1. Create a new strategy under `backend/services/strategies` and export a
   callable class or function that integrates with existing utilities.
2. Use `passes.js` to apply risk filters or implement your own heuristics.
3. Use `getSwapQuote` and `executeSwap`/`executeSwapTurbo` to perform swaps.
4. If your strategy supports multi‑wallet splitting, call `parallelFiller` with
   a list of wallet IDs and split percentages.
5. Document your strategy in a new markdown file under `docs/` and update
   `docs/.toc.md` accordingly.