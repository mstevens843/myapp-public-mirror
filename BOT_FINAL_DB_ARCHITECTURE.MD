#  Solana Trading Bot Platform — Architecture Overview

## ⚡ System Overview

This platform is a **high-performance multi-strategy Solana trading bot**, engineered with a hybrid hot-state + persistent architecture to balance speed, resilience, and traceability.

###  Key Features
- ✅ Multi-strategy: sniper, scalper, breakout, dip buyer, rebalancer, rotation bot, chad mode, stealth bot, paper trader, and more.
- ✅ Runs unlimited parallel instances with independent configs.
- ✅ Modular safety checks (honeypots, liquidity, top holders).
- ✅ Open / closed trades tracked in PostgreSQL.
- ✅ JSON lockfiles for crash protection.
- ✅ WebSockets + Telegram alerts for live logs.
- ✅ Config validators enforce bulletproof constraints before launch.

---

##  **Architecture Layers**

| Layer       | Purpose                                            | Technology |
|-------------|----------------------------------------------------|------------|
| 🔥 **Hot State**   | Millisecond tick operations (cooldowns, last ticks, uptimes, restarts) | In-memory (`strategyStatusMap`, `lastTickTimestamps`) |
| 📝 **Ephemeral**   | Crash resilience, watchdog restarts         | Local JSON files (`/runtime/*.json`) |
| 🗄 **Persistent**  | Audit & dashboard state                     | PostgreSQL via Prisma (`StrategyRunStatus`, `Trade`, `ClosedTrade`) |

---

##  **Data Flow**

###  1. User starts a bot
- Frontend builds a sanitized strategy config (validated via `strategyValidator.js`).
- Sends to backend `/api/mode/start`.

###  2. Backend launches strategy
- Saves a `StrategyRunStatus` row in DB with `botId`, `mode`, `pid`, `config`, `status=running`.
- Writes runtime JSON to `/runtime/*.json`.
- Spawns a new child process for `sniper.js`, `dipBuyer.js`, etc.

### ⏱ 3. Bot runs
- Strategy executes ticks in pure memory (cooldowns, restart counts, tradesExecuted).
- Keeps `uptime` and `lastTickTimestamps` locally for instant watchdog checks.
- Periodically logs open trades to DB on buy, moves to `ClosedTrade` on sell.

###  4. Monitoring & crash protection
- Watchdog tracks `lastTickTimestamps` vs expected interval.
- On SIGINT/SIGTERM, bots gracefully clean up JSON and DB.

###  5. Frontend dashboard
- Lists running bots from `StrategyRunStatus`.
- Uses `/status/detailed` endpoint to pull combined in-memory + DB enriched view.

---

## 🥇 **Performance Philosophy**
|  Hot Layer      | Zero DB writes, sub-millisecond state updates |
|-------------------|----------------------------------------------|
|  JSON Layer     | Crash recovery for running bots              |
|  DB Layer       | Long-term audit, dashboard views             |

> **No tick-level DB writes = HFT-grade speed.**  
> All heavy state (cooldowns, fast counters, tick flow) stays in memory.

---

## 💾 **Database Models (Prisma)**

### `StrategyRunStatus`
| Field      | Description                        |
|------------|------------------------------------|
| `botId`    | Unique identifier for each bot run |
| `userId`   | Owner of the strategy              |
| `mode`     | Strategy type (`sniper`, `dipbuyer`, ...) |
| `pid`      | Node child process PID            |
| `config`   | Full JSON config object           |
| `status`   | `running`, `paused`, `stopped`    |
| `pausedAt` | Timestamp for paused state        |
| `stoppedAt`| Timestamp for completed state     |

### `Trade` + `ClosedTrade`
| Field      | Description                        |
|------------|------------------------------------|
| `mint`     | Token mint address                |
| `entryPrice` / `exitPrice` | Trade entry/exit prices |
| `inAmount` / `outAmount`   | Token amounts      |
| `strategy` | Strategy that placed the trade    |
| `walletId` | Linked wallet                     |
| `timestamp`| When opened / closed              |

---

## 🔒 **Validation**
All strategy configs pass through `strategyValidator.js` to enforce:
- ✅ Min/max ranges (slippage, thresholds, cooldowns).
- ✅ Valid Solana mints.
- ✅ Proper object types (tokenFeeds vs monitored lists).
- ✅ Strategy-specific rules (e.g. `chadMode` requires `outputMint`).

---

## ⚡ **Why hybrid JSON + DB?**
| Feature             | Stored In | Why?                    |
|----------------------|-----------|-------------------------|
| Cooldowns / last tick | Memory    | Zero-latency execution  |
| Lockfiles / watchdog  | JSON      | Recover after crash     |
| Bot lifecycle state   | DB        | Audit, dashboard, multi-user support |
| Trades (open/closed)  | DB        | Portfolio + tax tracking|

> 🏆 **Best of both worlds:**  
> - Memory for speed.  
> - JSON for crash resilience.  
> - DB for long-term traceability.

---

##  Next Steps
- Add Redis if cluster scaling needed (tick + cooldown sync across nodes).
- Expand `StrategyRunStatus` with `restartCount`, `tradesExecuted` if you want cross-server dashboard analytics.

---

##  **Built for speed, safety, and scale.**
This architecture is optimized for millisecond-level execution speed, safety from crashes, and long-term auditability — exactly like professional quant / HFT systems.

---

 **Engineered by [Mathew Stevens]**
