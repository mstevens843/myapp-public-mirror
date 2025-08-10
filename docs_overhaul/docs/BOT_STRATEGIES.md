# Bot Strategies

This document catalogues the trading strategies included in the project.  Each strategy represents a different trading style or automation and exposes its own set of knobs.  Use this as a high‑level index; see individual strategy files for details.

> **Note:** Turbo Sniper is just one of many strategies.  Avoid conflating general bot behaviour with the turbo path; most docs apply to all strategies unless specified.

## Strategies Overview

| Strategy | Description | Primary Knobs |
|---|---|---|
| **Turbo Sniper** | Ultra‑low‑latency liquidity sniping.  Listens for new pools, runs risk passes and executes trades using probe/scale sizing and quorum RPC sending【239152120029095†L12-L44】. | `probe.enabled`, `probe.scaleFactor`, `computeUnitPriceMicroLamportsMin/Max`, `jitoTipLamports`, `leaderTiming.enabled`, `fallbackQuoteLatencyMs` (see `docs/strategies/turbo.md`). |
| **Safe Turbo** | A more conservative preset for turbo sniping.  Uses smaller probe sizes, stricter price impact thresholds and higher slippage to reduce failed trades.  Suitable for new tokens or high‑volatility periods. | `probe.scaleFactor`, `probe.abortOnImpactPct`, `slippageBps`, `maxVolatilityPct`. |
| **Liquidity Monitor** | Tracks new pool initialisations and prints alerts without executing trades.  Useful for research or manual snipes via the dashboard. | `poolDebounceMs`, `filters.whitelist`, `filters.blacklist`. |
| **DCA Strategy** | Performs dollar‑cost averaging buys at fixed intervals.  Splits orders over time to minimise price impact and smooth entry. | `intervalSec`, `amountPerBuy`, `maxBuys`, `slippageBps`. |
| **Limit Sniper** | Places limit orders on a target token and waits for price dips.  Uses on‑chain or programmatic order books where available. | `targetPrice`, `amount`, `expirationSlots`, `slippageBps`. |
| **Manual Trader** | Provides a dashboard and Telegram commands for human‑driven buys and sells.  Does not auto‑trigger; execution uses the standard swap path (preflight checks enabled)【774855396523611†L35-L41】. | `slippageBps`, `computeUnitPriceMicroLamports`, `tipLamports`. |
| **Portfolio Rebalancer** | Periodically rebalances a basket of tokens to target weights.  Calculates required trades based on current holdings and executes them via the standard or turbo path. | `targetWeights`, `rebalanceInterval`, `slippageBps`. |
| **Long/Short Monitor** | Opens or closes long/short positions on perpetual DEXes (if supported).  Monitors funding rates and liquidations. | `targetPair`, `leverage`, `maxExposure`, `slippageBps`. |
| **Watchdog** | Monitors existing positions for triggers such as take‑profit, stop‑loss, trailing stops or rug alerts.  Can close positions automatically or send Telegram alerts. | `tpPct`, `slPct`, `dcaLevels`, `watchIntervalSec`. |
| **Subscription Keeper** | Ensures user subscriptions and entitlements are valid.  Revokes access when limits are exceeded and enforces rate‑limiting.  Does not trade itself but feeds into other strategies. | `subscriptionPlan`, `maxTradesPerDay`, `renewalGracePeriod`. |
| **Paper Trader** | Runs any of the above strategies in simulation mode.  Quotes and builds transactions but does not broadcast them.  Useful for testing performance and risk heuristics without real funds【913491782795913†L73-L81】. | `dryRun=true`, `maxSimulatedNotional`, `metricsEnabled`. |

### Adding or Removing Strategies

- Strategies can be enabled or disabled via the `DISABLED_STRATEGIES` environment variable (comma‑separated list)【732702013707346†L41-L45】.
- To develop a new strategy, create a file under `backend/services/strategies` and export a `run()` function.  Document the strategy in this file and update this guide.
- Use `paper` mode (`dryRun=true`) to test new strategies without broadcasting【913491782795913†L73-L81】.

### Next Steps

* For a deep dive into the Turbo Sniper pipeline and tuning knobs, see `docs/strategies/turbo.md`.
* Review `docs/TRADING.md` to understand how quotes, slippage and fees work across all strategies.
* Consult `docs/PERFORMANCE.md` for latency optimisation and concurrency considerations.
* Ensure `DISABLED_STRATEGIES` and other feature flags are documented in `docs/CONFIG_REFERENCE.md`.