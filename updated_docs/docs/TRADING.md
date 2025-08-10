# Trading: Quotes, Swaps and Fees

This document explains how the bot obtains swap quotes, executes swaps
(standard and turbo paths), handles slippage and sizing, and controls fees.

## Quote Sources

The bot uses the [Jupiter Aggregator](https://jup.ag/) as its primary source of
swap quotes.  `getSwapQuote` accepts `inputMint`, `outputMint`, `amount` and
slippage parameters and returns a quote response from the Jupiter lite API【107868020100458†L49-L83】.  Optional parameters allow specifying allowed or
excluded DEXes and hinting the router to fetch fresh routes when the market is
volatile.  If the quote fetch fails, an error is logged and `null` is
returned【107868020100458†L94-L103】.

## Slippage and Sizing

- **Slippage:** When calling `getSwapQuote`, you can pass `slippage` as a
  floating‑point percentage (e.g. `1.0` for 1%) or `slippageBps` as basis
  points.  If neither is provided, the helper derives a default of 1%【107868020100458†L60-L64】.
- **Sizing:** The `tradeExecutorTurbo` optionally applies liquidity‑aware
  sizing via `applyLiquiditySizing`.  It floors the input amount to avoid
  dust and may refresh the quote if the amount changes significantly【30051125156274†L319-L343】.
  Probe/scale mode further splits the amount into a small initial probe and a
  larger scale portion【30051125156274†L1000-L1037】.

## Swap Paths

There are three swap execution paths:

1. **Standard swap:** `executeSwap` builds a VersionedTransaction from the
   quote, signs it with the provided wallet and sends it via the current RPC
   connection【107868020100458†L106-L166】.  It wraps and unwraps SOL, uses shared
   accounts to shield MEV and enables dynamic compute unit limits and
   slippage【107868020100458†L133-L146】.  Confirmation is awaited via
   `connection.confirmTransaction`.

2. **Turbo swap:** `executeSwapTurbo` is identical to the standard path but
   skips preflight checks and optionally uses a private RPC connection for
   lower latency【107868020100458†L172-L234】.  Set `skipPreflight=false` if you
   need signature status before submission.

3. **Jito bundle:** `executeSwapJitoBundle` packages the transaction into a
   Jito bundle, adds a tip in lamports and sends it via the Jito relay
   specified by `jitoRelayUrl` or the `JITO_RELAY_URL` environment variable【107868020100458†L242-L289】.
   The response may be a bundle ID rather than a Solana signature.

## Fees and Prioritisation

Solana transaction fees are composed of compute units multiplied by a price
(microLamports per unit) and an optional tip.  The bot exposes several knobs:

| Parameter | Description | Where it is used |
|---|---|---|
| `computeUnitPriceMicroLamports` | Price per compute unit in microLamports.  When calling `executeSwap` or `executeSwapTurbo`, pass this to override the legacy `priorityFee` field【107868020100458†L106-L166】. | `swap.js` |
| `tipLamports` | An optional tip (in lamports) added to the fee.  When sending via the Jito path this is separate from the Jito bundle tip【107868020100458†L242-L289】. | `swap.js` |
| `jitoTipLamports` | Tip paid to the Jito relay when using the bundle path (default 1 000 lamports)【107868020100458†L242-L289】. | `swap.js` |
| `autoPriorityFee`/`cuPriceMicroLamportsMin`/`Max` | Strategy‑level settings that derive a compute unit price based on retry attempts【30051125156274†L281-L300】. | `tradeExecutorTurbo.js` |
| `priorityFeeLamports` | Legacy field alias for compute unit price【30051125156274†L281-L300】. | `tradeExecutorTurbo.js` |

The executor will choose between the explicit compute unit price and priority
fee fields; compute units are always floored to integers and negative values
are coerced to zero【30051125156274†L281-L300】.

### Slippage vs Fee Interaction

Higher priority fees and tips do not guarantee better swap prices; they only
increase inclusion probability.  Slippage tolerance controls how far the
execution price may drift from the quote.  When network conditions are
volatile, consider increasing both the slippage tolerance and the compute unit
price to reduce failure rates.

## Idempotency and Quorum

Every swap in turbo mode is associated with an idempotency key.  The key is
derived from the user ID, wallet ID, mint and slot bucket, salted with
`IDEMPOTENCY_SALT` and stored for `IDEMPOTENCY_TTL_SEC` seconds【30051125156274†L190-L200】.  If a
duplicate request arrives within the TTL, the stored transaction hash is
returned without resending.  This prevents double buys in volatile markets.

Transactions are sent through a quorum of RPC endpoints; if fewer than the
required acknowledgments are received a `rpc-quorum-not-reached` error is
thrown【338326861738027†L24-L96】.  Configure the list of endpoints and quorum
threshold in your strategy or via environment variables.  Failing over to the
next endpoint occurs automatically when errors exceed a threshold (see
`utils/rpcManager.js`).

## Blockhash Prewarm

Before sending a transaction, the executor calls `blockhashPrewarm` to
retrieve a recent blockhash and caches it until `blockhashTtlMs` expires.
This reduces the chance of `BlockhashExpired` errors and is especially
important when using turbo mode with Jito bundles or when sending through
multiple RPCs.  The TTL defaults to 2.5 seconds in `RpcQuorumClient`
constructor【338326861738027†L24-L33】.

## Aggregator vs Direct AMM

The bot prefers the Jupiter aggregator for routing, but under certain
conditions it will route directly to the AMM.  The `shouldDirectAmmFallback`
helper checks the age of the quote, whether the liquidity pools are fresh and
the observed volatility【628800443557218†L0-L37】.  If the quote is older than
`fallbackQuoteLatencyMs` (configured per strategy) and volatility is within
`maxVolatilityPct`, the executor will bypass the router and call a direct
swap path.  This reduces latency and protects against stale aggregator
information.