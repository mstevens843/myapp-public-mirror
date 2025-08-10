# Turbo Sniper Strategy

Turbo Sniper is the flagship ultra‑low‑latency strategy for sniping new liquidity pools.  It listens for events, runs a suite of risk passes and executes trades using an aggressive pipeline with optional probe/scale sizing, private RPC sending and MEV relay bundling.  This document captures the key steps, knobs and failure modes of the turbo path.

## Pipeline Overview

1. **Event ingestion:** A pool creation or external alert triggers the sniper.  The mint and context are passed to `passes.js` for risk checks such as developer heuristics, holder concentration and price/volume filters【239152120029095†L12-L17】.  If any pass fails the strategy aborts.
2. **Quote retrieval:** The bot calls `getSwapQuote` with `inputMint`, `outputMint`, `amount` and slippage parameters.  Optional hints allow forcing or excluding specific DEXes【239152120029095†L18-L23】.
3. **Sizing:** Before submission the executor may adjust the amount using a liquidity‑aware sizing helper.  It floors the input amount and may refresh the quote if the amount changes【239152120029095†L25-L29】.
4. **Idempotency:** A deterministic idempotency key is derived from the user, wallet, mint and slot bucket, salted with `IDEMPOTENCY_SALT` and cached for `IDEMPOTENCY_TTL_SEC`【239152120029095†L31-L37】.  Duplicate signals return the stored transaction hash rather than re‑creating the transaction.
5. **Probe & scale (optional):** When a `probe` configuration is provided, the executor splits the trade into a small probe and a larger scale.  If the observed price impact of the probe exceeds `probe.abortOnImpactPct`, the scale is aborted【239152120029095†L40-L46】.  A configurable delay (`probe.delayMs`) separates the two sends.
6. **Compute unit price & Jito tip:** The helper derives a compute unit price (micro‑lamports) from `autoPriorityFee` and explicit min/max values and optionally adds a Jito tip【239152120029095†L48-L53】.
7. **Leader scheduling (optional):** When `leaderTiming.enabled=true`, the executor obtains the validator’s leader schedule and sends the transaction just before the targeted slot minus a preflight window【239152120029095†L56-L61】.
8. **Parallel fill:** If multiple wallets and split percentages are specified, the executor calls `parallelFiller` to distribute the amount across wallets and send concurrently【239152120029095†L63-L68】.
9. **RPC quorum send:** The serialized transaction is sent via `rpcQuorumClient`, which broadcasts to multiple endpoints and resolves when a quorum of acknowledgments is received【239152120029095†L70-L74】.
10. **Post‑trade:** On success the idempotency key and transaction hash are stored.  The trade is recorded and asynchronous hooks insert TP/SL orders and send Telegram alerts【239152120029095†L77-L83】.

## Latency Budget & Knobs

Turbo Sniper targets **sub‑second** end‑to‑end latency.  The following knobs affect performance and reliability:

| Knob | Description | Code Reference |
|---|---|---|
| `skipPreflight` | Skip Solana preflight checks when sending via RPC; defaults to `true`【774855396523611†L43-L46】. | `utils/swap.js` |
| `computeUnitPriceMicroLamportsMin` / `Max` | Minimum/maximum compute unit price used to derive fees【239152120029095†L48-L53】. | `tradeExecutorTurbo.js` |
| `jitoTipLamports` | Tip in lamports paid to the Jito relay when bundling【239152120029095†L48-L53】. | `utils/swap.js` |
| `probe.scaleFactor` | Factor by which to size the probe relative to the total amount (default 4)【239152120029095†L40-L46】. | `tradeExecutorTurbo.js` |
| `probe.delayMs` | Delay in milliseconds between sending the probe and scale (default 250 ms)【239152120029095†L40-L46】. | `tradeExecutorTurbo.js` |
| `probe.abortOnImpactPct` | Threshold for aborting the scale if the probe’s observed price impact exceeds this percentage【239152120029095†L40-L46】. | `tradeExecutorTurbo.js` |
| `leaderTiming.preflightMs` | Milliseconds before the targeted slot to send the transaction when leader timing is enabled (default 220 ms)【239152120029095†L56-L61】. | `tradeExecutorTurbo.js` |
| `leaderTiming.windowSlots` | Number of slots in the sending window (default 2)【239152120029095†L56-L61】. | `tradeExecutorTurbo.js` |
| `idempotency.ttlSec` | TTL for idempotency entries (default 90 sec)【239152120029095†L31-L37】. | `tradeExecutorTurbo.js` |
| `idempotency.salt` | Salt appended when deriving idempotency keys【239152120029095†L31-L37】. | `tradeExecutorTurbo.js` |
| `fallbackQuoteLatencyMs` | Threshold for triggering a direct AMM fallback when a quote is stale【239152120029095†L153-L154】. | `utils/ammFallbackGuard.js` |

Tune these knobs based on your latency and risk tolerance.  For example, increasing the compute unit price improves inclusion probability but raises fees.  Enabling leader scheduling can reduce skipped slots at the cost of a short delay.

## Error Classes & Retry Policy

Turbo Sniper classifies errors and increments metrics accordingly:

- **`rpc-quorum-not-reached`** – Fewer RPC acknowledgments were received than required【239152120029095†L128-L130】.  Add more endpoints or lower the quorum.
- **`probe-aborted`** – The probe observed excessive price impact; the scale was aborted【239152120029095†L131-L133】.
- **`BLOCKHASH_EXPIRED` / `SlotExpired`** – A stale blockhash caused the transaction to be rejected.  Increase `blockhashTtlMs` in the quorum client.
- **`InvalidAccount` / `TokenNotFound`** – The token has insufficient liquidity or does not exist.  Adjust risk passes accordingly.
- **`AUTOMATION_NOT_ARMED`** – The wallet is not armed.  Run the arm command and ensure the encryption secret is correct【239152120029095†L141-L143】.

For each error class the executor records metrics and may retry with adjusted fees or delays.  Always inspect logs and metrics to understand failure patterns.

## Guards & Fallbacks

Turbo Sniper includes a **direct AMM fallback guard**.  If a Jupiter quote is older than `fallbackQuoteLatencyMs`, liquidity pools are fresh and volatility is within `maxVolatilityPct`, the executor bypasses the router and performs a direct swap【239152120029095†L150-L154】.  This reduces latency and protects against stale aggregator information.

## Notes & Best Practices

* Start with the **Safe Turbo** preset (see `docs/BOT_STRATEGIES.md`) to reduce risk.  Tune parameters incrementally.
* Set a conservative `probe.scaleFactor` (e.g. 4) and `probe.abortOnImpactPct` (1–2 %) when sniping highly volatile tokens【239152120029095†L159-L161】.
* Ensure idempotency TTLs are long enough when running multiple instances or receiving duplicate signals【239152120029095†L161-L163】.
* To use private relay sending, enable `privateRelay.enabled` in your configuration and provide a `relayUrl`.  The executor will call a `RelayClient` and return a bundle ID instead of a standard signature【239152120029095†L163-L166】.

## Next Steps

* Read `docs/TRADING.md` for details on quotes, slippage and fees.
* Check `docs/CONFIG_REFERENCE.md` for environment variables controlling idempotency, RPC quorum and fallback thresholds.
* Review `docs/PERFORMANCE.md` to tune compute unit prices, Jito tips and concurrency for optimal latency.