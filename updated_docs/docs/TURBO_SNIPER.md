# Turbo Sniper

The **Turbo Sniper** strategy is the flagship ultra‑low‑latency mode of the
trading bot.  It takes a warm Jupiter quote, sizes the input amount based on
pool liquidity, optionally sends a probe transaction to estimate price impact,
scales the remainder, and submits the transactions through a quorum of RPC
endpoints.  It also supports private relay sending, idempotency keys, retry
policies and Jito fee tuning.

## Pipeline

1. **Event ingestion:** A new liquidity pool or external alert triggers the
   sniper.  The mint and context are passed to `passes.js` for risk checks
   (developer heuristics and price/volume filters)【357496616301582†L23-L86】.  If any
   check fails the strategy stops.

2. **Quote retrieval:** The bot calls `getSwapQuote` from `swap.js`, passing
   `inputMint`, `outputMint`, `amount` and slippage parameters【107868020100458†L49-L83】.
   Optional hints allow forcing or excluding specific DEXes and enabling split
   routes.

3. **Sizing:** Before submitting, the executor may adjust the input amount
   using liquidity‑aware sizing.  The `applyLiquiditySizing` helper
   (internal to `tradeExecutorTurbo.js`) calls an external price impact
   estimator and may refresh the quote if the amount changes【30051125156274†L319-L343】.

4. **Idempotency:** A deterministic idempotency key is derived from the
   user ID, wallet ID, mint and slot bucket.  The key is stored in an
   in‑memory cache with a TTL defined by `IDEMPOTENCY_TTL_SEC` (defaults to
   90 seconds) and a salt `IDEMPOTENCY_SALT`【30051125156274†L190-L200】.  If a key
   already exists, the stored transaction hash is returned instead of
   rebuilding the transaction.  This prevents duplicate submissions when
   multiple signals arrive for the same pool.

5. **Probe & scale (optional):** If configured with a `probe` object,
   the executor splits the trade into a small “probe” portion and a larger
   “scale” portion.  The probe is sent first; if the observed price impact
   exceeds `probe.abortOnImpactPct`, the scale transaction is skipped and
   the probe transaction is recorded as a failure【30051125156274†L1000-L1037】.  A
   configurable delay (default 250 ms) separates the probe from the scale.

6. **Compute unit price & Jito tip:** The priority fee helper combines
   `autoPriorityFee` settings with explicit min/max values to derive a
   compute unit price (in microLamports) and an optional Jito tip【30051125156274†L281-L300】.
   This allows the sniper to adjust fees dynamically based on retry attempts or
   user configuration.

7. **Leader scheduling (optional):** If `leaderTiming.enabled` is true,
   the executor obtains the current validator’s leader schedule and delays
   submission until the targeted slot minus a configurable preflight window.
   This attempts to place the transaction at the top of the block for
   maximum inclusion probability.  The underlying `LeaderScheduler` is
   created lazily per RPC/validator combination【30051125156274†L204-L215】.

8. **Parallel fill:** If multiple wallets and split percentages are provided,
   the executor calls `parallelFiller` with the sized quote, dividing the
   amount across wallets and sending transactions concurrently【516838933107947†L49-L60】.
   The filler returns a list of per‑wallet results and a summary.

9. **RPC quorum send:** Serialized transactions are passed to
   `rpcQuorumClient.sendRawTransaction`, which sends them to the configured
   endpoints and resolves when the required number of acknowledgments is
   reached【338326861738027†L24-L96】.  This mitigates RPC outages and increases
   inclusion probability.

10. **Post‑trade:** On success, the idempotency key is stored along with the
    returned transaction hash and the trade is recorded in the database.
    Enrichment steps (e.g. price in USD) and insertion of take‑profit/stop‑loss
    metadata occur asynchronously【30051125156274†L1112-L1159】.  Alerts are sent
    to Telegram if configured.

## Latency Budget & Knobs

Turbo Sniper aims for sub‑second total latency.  The following knobs directly
affect latency and can be tuned per strategy:

| Knob | Description | Code reference |
|---|---|---|
| `skipPreflight` | Skips transaction preflight checks when sending via RPC; defaults to `true` in turbo mode【107868020100458†L172-L234】. | `utils/swap.js` |
| `computeUnitPriceMicroLamportsMin` / `Max` | Minimum/maximum priority fee to pay per compute unit; combined with `autoPriorityFee` to derive the actual price【30051125156274†L281-L300】. | `tradeExecutorTurbo.js` |
| `jitoTipLamports` | Tip in lamports paid to the Jito relay when using the bundle path【107868020100458†L242-L289】. | `utils/swap.js` |
| `probe.scaleFactor` | Multiplier to size the probe relative to the total amount (default 4)【30051125156274†L1000-L1037】. | `tradeExecutorTurbo.js` |
| `probe.delayMs` | Delay in milliseconds before sending the scale transaction (default 250 ms)【30051125156274†L1040-L1045】. | `tradeExecutorTurbo.js` |
| `probe.abortOnImpactPct` | Abort threshold for price impact; if the probe’s observed impact exceeds this percentage, the scale is skipped【30051125156274†L1023-L1037】. | `tradeExecutorTurbo.js` |
| `leaderTiming.preflightMs` | When leader timing is enabled, number of milliseconds before the targeted slot to send the transaction; default 220 ms【30051125156274†L369-L373】. | `tradeExecutorTurbo.js` |
| `leaderTiming.windowSlots` | Number of slots in the sending window; default 2 slots【30051125156274†L369-L373】. | `tradeExecutorTurbo.js` |
| `idempotency.ttlSec` | TTL in seconds for idempotency entries (default 90)【30051125156274†L190-L200】. | `tradeExecutorTurbo.js` |
| `idempotency.salt` | Salt string appended when deriving the idempotency key【30051125156274†L190-L200】. | `tradeExecutorTurbo.js` |
| `fallbackQuoteLatencyMs` | Threshold (in ms) to trigger a direct AMM fallback; only used when `ammFallbackGuard` decides to bypass the router【628800443557218†L0-L37】. | `utils/ammFallbackGuard.js` |

## Error Classes & Retry Policy

Turbo Sniper classifies errors and increments metrics accordingly.  Some common
error classes include:

- **`rpc-quorum-not-reached`** – The number of RPC acknowledgments was below
  the required quorum【338326861738027†L24-L96】.  Consider adding more RPC
  endpoints or reducing the quorum.
- **`probe-aborted`** – The probe transaction indicated excessive price impact
  and the scale was aborted【30051125156274†L1023-L1037】.
- **`BLOCKHASH_EXPIRED` / `SlotExpired`** – The recent blockhash expired
  before submission.  The executor prewarms blockhashes, but network
  congestion may still cause expiry; increasing `blockhashTtlMs` in the
  `RpcQuorumClient` configuration can mitigate this.
- **`InvalidAccount` / `TokenNotFound`** – The mint does not exist or has
  insufficient liquidity.  The risk heuristics may be tuned to prevent these
  cases.
- **`AUTOMATION_NOT_ARMED`** – Attempted to trade with a wallet that is
  protected and not armed via the Arm‑to‑Trade mechanism【30051125156274†L231-L248】.

For each error class the executor records a metric and, depending on the
strategy configuration, may retry with adjusted compute unit price or delay.

## Guards & Fallbacks

The executor includes a **direct AMM fallback guard**.  If a quote is older
than `fallbackQuoteLatencyMs` and the liquidity pools are considered fresh,
and the observed volatility is below `maxVolatilityPct`, the executor will
skip the Jupiter router and call `shouldDirectAmmFallback` to decide whether
to perform a direct AMM swap【628800443557218†L0-L37】.  This protects against
stale aggregator quotes and high volatility.

## Notes

* For safety in volatile markets, enable both a small `probe.scaleFactor`
  (e.g. 4) and a conservative `probe.abortOnImpactPct` (e.g. 1–2%).
* Idempotency is particularly important when running the bot across multiple
  instances or when you expect duplicate signals from different sources.
* To integrate private relay sending, set `privateRelay.enabled=true` and
  provide `relayUrl` in your configuration.  The executor will call a
  `RelayClient` to send the transaction off‑chain and may return a bundle ID
  instead of a signature.