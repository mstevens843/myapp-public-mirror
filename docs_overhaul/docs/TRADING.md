# Trading: Quotes, Swaps and Fees

This guide explains how the bot obtains swap quotes, executes trades and manages slippage, sizing and fees.  It applies to all strategies and is not tied to a single mode.

## Quote Sources

The bot uses the [Jupiter aggregator](https://jup.ag/) as its primary source of swap quotes.  A helper `getSwapQuote` is called with the input/output mint, amount and slippage settings.  Optional hints allow the strategy to include or exclude specific DEXes or request fresh routes when the market is volatile【774855396523611†L7-L15】.  If quote retrieval fails the helper logs an error and returns `null`【774855396523611†L11-L15】.

### Slippage and Sizing

- **Slippage:** When fetching quotes you can provide `slippage` as a percentage (e.g. `1.0` for 1 %) or `slippageBps` in basis points.  If neither is provided a default of 1 % is derived【774855396523611†L19-L23】.  Set a higher slippage on volatile or illiquid tokens to reduce rejections.
- **Sizing:** Before sending a trade the executor may adjust the input amount using liquidity‑aware sizing.  The internal helper floors the input amount to avoid dust and may refresh the quote if the amount changes significantly【774855396523611†L23-L29】.  Some strategies support probe/scale mode, where a small probe transaction estimates price impact before committing the remaining size【774855396523611†L27-L29】.

## Swap Execution Paths

There are three swap execution modes.  The strategy chooses one based on performance and risk requirements:

1. **Standard swap:** Builds a VersionedTransaction from the quote, signs it with the wallet and sends it via the current RPC connection.  The helper wraps and unwraps SOL, shields MEV via shared accounts, and awaits confirmation【774855396523611†L35-L41】.  Use this mode for manual trades or when preflight checks are desirable.
2. **Turbo swap:** Identical to the standard path but skips Solana preflight checks to minimise latency.  It optionally sends the transaction through a private RPC endpoint for lower latency【774855396523611†L43-L46】.  You can override `skipPreflight` in your strategy configuration.
3. **Jito bundle:** Packages the transaction into a bundle and submits it to the Jito MEV relay.  A tip is added in lamports and the response may return a bundle ID rather than a standard signature【774855396523611†L49-L52】.  Configure the relay URL via `JITO_RELAY_URL` and adjust the tip as needed.

## Fees and Prioritisation

Solana fees are the product of compute units and a price per unit.  Optional tips further incentivise inclusion.  The table below summarises the knobs available when calling the execution helpers:

| Parameter | Description | Where Used |
|---|---|---|
| `computeUnitPriceMicroLamports` | Micro‑lamports per compute unit.  Overrides the legacy `priorityFee` field【774855396523611†L61-L66】. | `utils/swap.js` |
| `tipLamports` | Optional tip (lamports) added to the fee; separate from the Jito tip【774855396523611†L66-L69】. | `utils/swap.js` |
| `jitoTipLamports` | Tip paid to the Jito relay when bundling a transaction【774855396523611†L49-L52】. | `utils/swap.js` |
| `autoPriorityFee` / `cuPriceMicroLamportsMin/Max` | Strategy‑level settings to derive a compute unit price based on retry attempts【774855396523611†L71-L74】. | `tradeExecutorTurbo.js` |
| `priorityFeeLamports` | Legacy alias for compute unit price【774855396523611†L71-L75】. | `tradeExecutorTurbo.js` |

Higher compute unit prices or tips increase inclusion probability but also increase cost.  Slippage controls the acceptable deviation from the quoted price; raising both slippage and priority fee can improve reliability during congestion【774855396523611†L82-L89】.

### Slippage vs Fee Interaction

Priority fees do not improve the quote itself; they only accelerate inclusion.  Slippage defines how far the execution price may drift from the quote.  In volatile markets consider increasing both slippage tolerance and compute unit price to reduce failure rates【774855396523611†L82-L89】.

## Idempotency and Quorum

Turbo swaps derive an **idempotency key** from the user ID, wallet, mint and slot bucket.  The key is salted (`IDEMPOTENCY_SALT`) and stored for a configurable TTL (`IDEMPOTENCY_TTL_SEC` or `IDEMPOTENCY_TTL_MS`).  Duplicate requests within the TTL return the original transaction hash and do not resend【774855396523611†L91-L99】.  Configure these variables in your environment file (see `CONFIG_REFERENCE.md`).

Transactions are sent through a **quorum of RPC endpoints**.  If the required number of acknowledgments is not reached, a `rpc-quorum-not-reached` error is thrown【774855396523611†L100-L103】.  Adjust the list of endpoints and quorum threshold in your strategy or environment settings.

## Blockhash Prewarm

Before sending a transaction, the executor calls `blockhashPrewarm` to fetch and cache a recent blockhash.  This reduces the likelihood of `BlockhashExpired` errors and is particularly important when sending through multiple RPCs or Jito bundles【774855396523611†L110-L115】.  The default TTL for cached blockhashes is 2.5 seconds【774855396523611†L110-L115】.

## Aggregator vs Direct AMM

The bot prefers the Jupiter aggregator for routing, but under certain conditions it falls back to a direct AMM swap.  The fallback guard checks the age of the quote, liquidity freshness and observed volatility.  If the quote is older than `fallbackQuoteLatencyMs` and volatility is within the allowed threshold, the executor bypasses the router【774855396523611†L117-L126】.  Tune these thresholds in your strategy configuration.

## Next Steps

* Review `docs/CONFIG_REFERENCE.md` for configuration options such as slippage defaults, idempotency TTL and RPC quorum settings.
* See `docs/PERFORMANCE.md` for latency optimisation and fee tuning guidance.
* Read `docs/TROUBLESHOOTING.md` for solutions to common trading errors.
* For Turbo‑specific knobs (probe, leader timing, fallback) see `docs/strategies/turbo.md`.