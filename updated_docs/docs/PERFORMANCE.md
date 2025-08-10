# Performance Tuning

This guide covers performance considerations when operating the trading bot.
Latency, throughput and reliability are critical, especially for sniping newly
launched pools.  Tune the following knobs to balance success rate against
cost and risk.

## Latency Budget

The turbo executor is designed to minimise the time between pool detection and
transaction submission.  The critical path includes:

1. **Event ingestion** – `poolCreateListener` debounces and filters pool
   events.  Tuning the debounce interval too high may delay snipes; leave at
   the default unless you experience duplicate triggers【245844595763714†L70-L99】.
2. **Quote retrieval** – `getSwapQuote` fetches quotes from Jupiter.  Reduce
   network overhead by using a nearby region and enabling Jito aggregator
   hints.  If quoting is too slow you may fall back to direct AMM via
   `ammFallbackGuard`【628800443557218†L0-L37】.
3. **Sizing & probe** – The executor optionally sends a small probe buy and
   scales the remaining order.  Disable the probe (`probe.enabled=false`) to
   shave milliseconds at the risk of oversizing【30051125156274†L1000-L1037】.
4. **Compute unit price** – The `computeUnitPrice` sets the cost per unit of
   compute in micro‑lamports.  Higher values improve prioritisation on busy
   validators but increase fees.  The default is determined by the
   `priorityFeeHelper` which samples recent leader slots【30051125156274†L281-L300】.
5. **Jito tip** – When using `executeSwapJitoBundle` you can specify a
   `jitoTipLamports` to incentivise inclusion on Jito relays【107868020100458†L242-L289】.
6. **Leader scheduling** – Turbo mode can schedule sends to the upcoming
   leader to maximise inclusion probability.  This adds a small delay
   (sub‑second) but reduces skipped slots【30051125156274†L369-L373】.
7. **Parallel fill** – Splitting orders across wallets increases execution
   likelihood; however concurrency overhead grows with the number of wallets.
   Keep the concurrency limit low (2–4) for optimal latency【516838933107947†L49-L60】.

Aim for an end‑to‑end latency under **1 second** for high‑priority snipes.  Use
the metrics in `docs/METRICS.md` (`http_request_duration_seconds`,
`strategy_loop_duration_seconds`) to monitor p50/p95/p99 latencies.

## RPC Pool Recommendations

The `rpcQuorumClient` sends transactions to multiple RPC endpoints and
considers them sent when a quorum acknowledges【338326861738027†L24-L96】.  For best
performance:

* Choose endpoints in the same geographic region as your server.  Avoid free
  shared RPCs with high latency.
* Use at least **3** endpoints with a quorum of **2** for redundancy.
* Monitor per‑endpoint latency via Prometheus and remove outliers.
* When using Jito bundles, configure `PRIVATE_SOLANA_RPC_URL` and
  `JITO_RELAY_URL` to ensure low‑latency connectivity【107868020100458†L284-L285】.

## Fee & Tip Tuning

Solana transaction fees consist of a base fee and optional prioritisation
parameters:

| Parameter           | Effect | Code Reference |
|---------------------|--------|---------------|
| `computeUnitPrice`  | Sets micro‑lamports per compute unit.  Higher values
  increase the fee but prioritise your transaction【107868020100458†L172-L234】. |
| `priorityFeeMultiplier` | Multiplies the base `computeUnitPrice` based on recent slot statistics【30051125156274†L281-L300】. |
| `jitoTipLamports`   | Amount of lamports sent as an MEV tip to the Jito
  relay.  Only applied in `executeSwapJitoBundle`【107868020100458†L242-L289】. |

Start with conservative values (e.g. `computeUnitPrice=2000`, `jitoTipLamports=0`) and
increase if you experience frequent drops.  Monitor your transaction fee
spend and success rates.

## Concurrency & Scaling

Strategies can operate concurrently on multiple targets.  Use the
`parallelFiller` to split orders across wallets; this yields better fills but
increases concurrency.  Tune the `maxConcurrency` parameter in
`parallelFiller` (default 2) to avoid saturating your RPC endpoints【516838933107947†L49-L60】.

When running multiple instances of the bot, ensure they use distinct
`IDEMPOTENCY_SALT` values and avoid competing for the same wallet.  For read
only actions (e.g. monitoring positions) you can scale horizontally without
special considerations.

## Testing Performance Changes

Always test performance tuning in a safe environment.  Use `dryRun=true` to
simulate trades without broadcasting.  Measure latencies using the metrics
endpoint and adjust parameters iteratively.  Document any changes in
`docs/TURBO_SNIPER.md` to ensure new defaults are recorded.