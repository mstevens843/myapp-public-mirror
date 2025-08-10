# Performance Tuning

Latency, throughput and reliability are critical for profitable trading.  This guide outlines how to tune the bot for maximum performance while balancing cost and risk.  Many of these controls are strategy‑agnostic, though Turbo Sniper makes heavier use of them.

## Latency Budget

The critical path from event detection to transaction submission includes several steps.  To achieve sub‑second latency:

1. **Event ingestion:** `poolCreateListener` debounces and filters pool events.  Keep the debounce interval at its default unless you experience duplicate triggers【139586722650660†L14-L17】.
2. **Quote retrieval:** `getSwapQuote` fetches quotes from the Jupiter aggregator.  Reduce network overhead by using endpoints in the same region and enabling aggregator hints.  If quoting is too slow you may fall back to a direct AMM via `ammFallbackGuard`【139586722650660†L18-L22】.
3. **Sizing & probe:** Sending a small probe transaction and scaling the remainder adds milliseconds but protects against oversizing.  Disable the probe (`probe.enabled=false`) to shave time at the risk of price impact【139586722650660†L22-L24】.
4. **Compute unit price:** The `computeUnitPrice` determines the fee per compute unit.  Higher values improve prioritisation but increase cost【139586722650660†L25-L31】.
5. **Jito tip:** When using `executeSwapJitoBundle` you can specify a `jitoTipLamports` to incentivise inclusion on Jito relays【139586722650660†L30-L32】.
6. **Leader scheduling:** Enabling leader timing delays submission until just before the upcoming leader slot, reducing skipped blocks【139586722650660†L33-L35】.
7. **Parallel fill:** Splitting orders across wallets increases fill probability but introduces concurrency overhead.  Keep concurrency low (2–4) for optimal latency【139586722650660†L36-L40】.

Aim for an end‑to‑end latency under **1 second** for high‑priority snipes.  Use Prometheus metrics (e.g. `http_request_duration_seconds` and `strategy_loop_duration_seconds`) to monitor p50/p95/p99 latencies【139586722650660†L42-L45】.

## RPC Pool Recommendations

The `rpcQuorumClient` sends transactions to multiple RPC endpoints and considers them sent when a quorum of acknowledgments is received【139586722650660†L47-L52】.  For best performance:

- Choose endpoints in the same geographic region as your server.  Avoid free shared RPCs with high latency【139586722650660†L54-L56】.
- Use at least **3** endpoints with a quorum of **2** for redundancy【139586722650660†L56-L57】.
- Monitor per‑endpoint latency via your metrics and remove outliers【139586722650660†L57-L58】.
- When using Jito bundles configure `PRIVATE_SOLANA_RPC_URL` and `JITO_RELAY_URL` to ensure low latency connectivity【139586722650660†L58-L60】.

## Fee & Tip Tuning

Solana fees consist of a base compute fee and optional tips.  Use the following parameters to tune costs:

| Parameter | Effect | Code Reference |
|---|---|---|
| `computeUnitPrice` | Micro‑lamports per compute unit.  Higher values prioritise your transaction but increase cost【139586722650660†L69-L71】. | `utils/swap.js` |
| `priorityFeeMultiplier` | Multiplies the base compute unit price based on recent slot statistics【139586722650660†L72-L73】. | `tradeExecutorTurbo.js` |
| `jitoTipLamports` | Lamports tip sent to the Jito relay; only applied in the Jito bundle path【139586722650660†L74-L76】. | `utils/swap.js` |

Start with conservative values (`computeUnitPrice=2000`, `jitoTipLamports=0`) and increase if you experience frequent drops【139586722650660†L78-L81】.  Monitor your fee spend and success rate to find the right balance.

## Concurrency & Scaling

Strategies may operate on multiple tokens concurrently.  Use the `parallelFiller` to split orders across wallets; this yields better fills but increases concurrency.  Tune the `maxConcurrency` parameter (default 2) to avoid saturating your RPC endpoints【139586722650660†L85-L90】.

When running multiple instances of the bot, ensure each uses a distinct `IDEMPOTENCY_SALT` and avoid sharing wallets.  For read‑only operations such as monitoring positions you can scale horizontally without special considerations【139586722650660†L92-L96】.

## Testing Performance Changes

Always test performance tuning in a safe environment.  Use `dryRun=true` to simulate trades without broadcasting【139586722650660†L99-L100】.  Measure latencies with the metrics endpoint and adjust parameters iteratively.  Document any changes in `docs/strategies/turbo.md` to ensure new defaults are recorded【139586722650660†L99-L102】.

## Next Steps

* See `docs/TRADING.md` for details on quotes, slippage and fees.
* Review `docs/CONFIG_REFERENCE.md` for environment variables controlling concurrency, RPCs and fees.
* Use `docs/TESTING.md` to build a test harness for benchmarking strategies.