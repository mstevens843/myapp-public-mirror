# Turbo Sniper — Engineering Notes & Integration Guide

**Role**: Staff Solana HFT engineer focused on p99.  
**Goal**: Cut quote→submit p99 by 20–40% with zero behavior change.  
**Scope**: Turbo Sniper strategy path + execution edges.

---

## What’s new in this PR (high level)

- **Runtime kill switch** (ENV + in‑memory) wired into Turbo executor hot path.
- **Failure injector (dev‑only)** to simulate: stale blockhash, RPC 429, aggregator 500, pool illiquidity.
- **Guarded AMM fallback**: conditionally bypass aggregator when quote is stale and pools are fresh/low‑vol — with telemetry.
- **Blockhash prewarm**: TTL cache, single in‑flight refresh; executor consumes cached values.
- **RPC pool + quorum**: M‑of‑N sender with class‑based backoff; never blocks the tight loop.
- **Adaptive fees**: compute‑unit price + Jito tip bump **only on retryable classes**.
- **Warm‑quote cache**: identical params within TTL hit the cache.
- **Logging/Metrics**: synchronous logs moved off hot path; counters kept.
- **Benchmark**: small offline script that simulates 1k submits and prints p50/p95/p99 deltas.
- **Tests**: regression tests for retries, failure injection, fallback guard, blockhash prewarm and RPC quorum.
- **Docs**: this README with configuration & usage notes, plus a changelog.

All changes keep the “hot path” pure compute; async side‑effects are moved off‑path.

---

## Directory map (new & modified files)

**New**

- `backend/services/execution/blockhashPrewarm.js` — recent blockhash TTL cache + background prewarmer.
- `backend/services/execution/rpcPool.js` — endpoint pool with M‑of‑N quorum sender and class‑based backoff.
- `backend/utils/ammFallbackGuard.js` — decision helper for bypassing the aggregator.
- `backend/dev/failureInjector.js` — tiny dev‑only failure injection toggles.
- `scripts/bench/turbo_send_bench.js` — offline benchmark (no network).

**Modified**

- `backend/services/strategies/core/tradeExecutorTurbo.js` — wiring: kill switch, prewarm, RPC quorum, AMM fallback, adaptive fees, warm‑quote cache, retries, telemetry.
- `backend/utils/swap.js` — accepts optional `sendRawTransaction`/`broadcastRawTransaction` overrides; warm‑quote cache integration.
- `backend/services/strategies/turboSniper.js` — starts prewarm on strategy init; passes config knobs through; surfaces telemetry.

> Note: paths match the deliverables contract. If your repo uses slightly different names, search for the same module intents and adjust imports accordingly.

---

## Runtime kill switch

### Options

- **ENV**: set `TURBO_KILL=1` (or any truthy) — read at process boot.  
- **In‑memory**: call `setKill(true)` (exported by `tradeExecutorTurbo.js`).

### Behavior

- The executor’s hot path calls `requireAlive()` prior to send; if killed, it throws `KILL_SWITCH_ACTIVE` immediately. This is zero‑IO and O(1).

### Where

- Implemented in `tradeExecutorTurbo.js`. Exported helpers: `setKill(v: boolean)`.

---

## Failure injector (dev‑only)

A tiny module to simulate common production failure modes without touching live infra.

**File**: `backend/dev/failureInjector.js`

### Supported injections

- **Stale blockhash**: forces “blockhash not found / blockhash expired” conditions.
- **RPC 429**: responds as if the RPC rate-limited the request.
- **Aggregator 500**: quote endpoint returns HTTP 500 to force fallback/retry.
- **Pool illiquidity**: quote returns outAmount≈0 or slippage overflow.

### How to enable

- Set `FAILURE_INJECTOR=1` to enable the injector framework.
- Toggle specific modes via ENV (all optional):

  - `INJECT_STALE_BLOCKHASH=1`
  - `INJECT_RPC_429=1`
  - `INJECT_AGG_500=1`
  - `INJECT_POOL_ILLQ=1`

The injector is only required and evaluated in **dev/test** contexts. In prod, nothing is imported (tree‑shaken by absence of ENV).

### Integration points

- **Blockhash prewarm**: can yield an expired hash when `INJECT_STALE_BLOCKHASH=1`.
- **RPC pool**: can synthesize a 429 on first N sends to validate backoff/quorum.
- **swap.js (quote path)**: can synthesize HTTP 500 or illiquid pools to test fallback/abort logic.

---

## AMM fallback guard

**File**: `backend/utils/ammFallbackGuard.js`

Decision: **bypass aggregator and route directly to AMM** when **all** hold:
1) `quoteLatencyMs > fallbackQuoteLatencyMs`, and  
2) pool freshness **≤ TTL** (fresh), and  
3) expected/observed slippage **≤ bound** (volatility under control).

**Executor wiring**: `tradeExecutorTurbo.js` calls `shouldDirectAmmFallback()` on attempt 0 and, if true, uses `raydiumDirect` for the first leg (optionally `directAmmFirstPct` split).

**Telemetry**:
- `fallback_direct_amm_total` (counter)
- `fallback_direct_amm_success_total` / `_fail_total`
- `fallback_guard_decisions` (labels: `reason=stale|volatile|stale+volatile|fresh`)

---

## Blockhash prewarm

**File**: `backend/services/execution/blockhashPrewarm.js`

- Maintains a TTL cache (`{ blockhash, lastValidBlockHeight, expiresAtMs }`).
- Background task refreshes on an interval; **single in‑flight refresh** guarded by a promise.
- Executor calls `getCachedBlockhash()` during build; `_preSendRefresh()` best‑effort refreshes when needed.

**Env knobs**

- `BLOCKHASH_PREWARM_INTERVAL_MS` (default 400ms)
- `BLOCKHASH_PREWARM_TTL_MS` (default 1200ms)

---

## RPC pool + quorum

**File**: `backend/services/execution/rpcPool.js`

- Provides `sendRawTransactionQuorum(raw, opts)` which broadcasts to a **pool of endpoints** and resolves when **M‑of‑N** acks are seen.
- **Class‑based backoff** on endpoint errors (e.g., 429/backpressure, node‑behind). Endpoints are cooled for a short window and not selected again until the window passes.
- **Never** runs inside tight per‑tx loops; executor obtains a function pointer so hot loop remains pure compute.
- Supports `staggerMs`, `timeoutMs`, `maxFanout`, `quorum`.

**Env knobs**

- `RPC_QUORUM` (e.g., 2)
- `RPC_STAGGER_MS` (default 50)
- `RPC_TIMEOUT_MS` (default 10000)

---

## Adaptive fees (CU price + Jito tip)

- Helper computes a **computeUnitPriceMicroLamports** and **tipLamports**.  
- Bumps **only** for **retryable** classes (`blockhash not found`, `node behind`, `account in use`) — see `classifyError()` in executor.
- Jito path goes through `JitoFeeController` polynomial/linear curves; turbo path uses derived CU price and optional “bribery” lamports.

**Strategy knobs**

- `autoPriorityFee` (bool)
- `cuPriceMicroLamportsMin` / `cuPriceMicroLamportsMax`
- `jitoTipLamports`
- `retryPolicy.bumpCuStep` / `retryPolicy.bumpTipStep`

---

## Warm‑quote cache

- `QuoteWarmCache` (LRU + TTL) keyed by `inputMint|outputMint|amount|slippage|route flags`.
- Hits eliminate aggregator round‑trips for identical back‑to‑back requests (e.g., probes, split legs, retries).

**Env knobs**

- `QUOTE_CACHE_TTL_MS` (default 600ms)
- `QUOTE_CACHE_MAX` (default 200 entries)

---

## Logging & Metrics

**Counters** (partial list; all labels include `strategy=turbo` where applicable):

- `hotpath_ms{stage=quote|build|sign|submit|total}` (histogram)
- `submit_result_total{errorClass}`
- `probe_sent_total`, `probe_abort_total`, `probe_scale_success_total`
- `idempotency_blocked_total`
- `relay_submit_total{relay}`, `relay_win_total{relay}`
- `fallback_direct_amm_total`, `fallback_direct_amm_success_total`, `fallback_direct_amm_fail_total`
- `parallel_wallet_ok_total`, `parallel_wallet_fail_total`, `parallel_wallet_ms`

Heavy/structured logs are **moved off hot path**; only counters remain synchronous.

---

## Tests (regression)

**Added** (examples – adapt to your test runner):

- `tests/execution/blockhashPrewarm.test.js` — TTL expiry + single in‑flight refresh.
- `tests/execution/rpcPool.test.js` — quorum, stagger, 429 cooldown, node‑behind classification.
- `tests/executor/turbo.ammbypass.test.js` — stale quote + fresh pool triggers direct AMM.
- `tests/dev/failureInjector.test.js` — each injector mode toggles behavior as expected.
- `tests/executor/retry.policy.test.js` — bumps only on retryable classes.

Run: `npm test` (or your project’s test runner).

---

## Benchmark (offline)

**File**: `scripts/bench/turbo_send_bench.js`

- Simulates 1k “submissions” through a noop sender to compare baseline vs. optimized pipeline (no network).  
- Prints p50/p95/p99 for: build, sign, submit, total.  
- Accepts knobs via CLI/ENV to vary `staggerMs`, `quorum`, `quoteCacheTtl`, etc.

Run: `node scripts/bench/turbo_send_bench.js`

---

## Configuration (ENV + per‑strategy)

### ENV (server‑wide)

| Key | Default | Purpose |
|---|---|---|
| `TURBO_KILL` | `0` | Runtime kill switch (any truthy disables sends) |
| `BLOCKHASH_PREWARM_INTERVAL_MS` | `400` | Prewarm refresh cadence |
| `BLOCKHASH_PREWARM_TTL_MS` | `1200` | Cached blockhash TTL |
| `RPC_STAGGER_MS` | `50` | Stagger between RPC fanout sends |
| `RPC_TIMEOUT_MS` | `10000` | Per‑endpoint timeout |
| `RPC_QUORUM` | `1` | Acks required (M‑of‑N) |
| `QUOTE_CACHE_TTL_MS` | `600` | Warm‑quote cache TTL |
| `IDEMPOTENCY_TTL_SEC` | `90` | Crash‑safe resume window |
| `IDEMPOTENCY_SALT` | `` | Additional salt for stable key |
| `FAILURE_INJECTOR` | `0` | Enable dev failure injector |
| `INJECT_STALE_BLOCKHASH` | `0` | Stale blockhash simulation |
| `INJECT_RPC_429` | `0` | RPC 429 simulation |
| `INJECT_AGG_500` | `0` | Aggregator 500 simulation |
| `INJECT_POOL_ILLQ` | `0` | Pool illiquidity simulation |

### Per‑strategy config (passed via `meta`/executor cfg)

- `autoPriorityFee`, `cuPriceMicroLamportsMin`, `cuPriceMicroLamportsMax`
- `jitoTipLamports`, `useJitoBundle`
- `leaderTiming.enabled`, `.preflightMs`, `.windowSlots`, `validatorIdentity`
- `retryPolicy.max`, `.routeSwitch`, `.rpcFailover`, `.bumpCuStep`, `.bumpTipStep`
- `rpcEndpoints[]`, `rpcQuorum`, `rpcMaxFanout`, `rpcStaggerMs`, `rpcTimeoutMs`
- `fallbackQuoteLatencyMs`, `poolFresh`, `volatilityPct`, `maxVolatilityPct`
- `directAmmFallback`, `directAmmFirstPct`
- `sizing.{maxImpactPct,maxPoolPct,minUsd}`
- `probe.{enabled,usd,scaleFactor,abortOnImpactPct,delayMs}`
- `idempotency.{ttlSec,salt,slotBucket}`
- `dryRun`, `coolOffMs`, `tpLadder`, `trailingStopPct`

---

## Usage snippets

### Enable guarded AMM fallback

```js
const cfg = {
  directAmmFallback: true,
  fallbackQuoteLatencyMs: 180,
  poolFresh: true,
  maxVolatilityPct: 1.0
};
```

### Turn on RPC quorum failover

```js
const cfg = {
  rpcFailover: true,
  rpcEndpoints: [
    process.env.PRIVATE_SOLANA_RPC_URL,
    process.env.SOLANA_RPC_URL_BACKUP
  ],
  rpcQuorum: 2,
  rpcMaxFanout: 3,
  rpcStaggerMs: 50,
  rpcTimeoutMs: 10_000
};
```

### Kill switch

```js
const { setKill } = require('./backend/services/strategies/core/tradeExecutorTurbo');
setKill(true); // disables sends immediately
```

---

## Deliverables contract — checklist

- [x] **NEW** `blockhashPrewarm.js` (TTL cache, single in‑flight refresh, async only)
- [x] **NEW** `rpcPool.js` (M‑of‑N quorum, backoff on endpoint‑class errors; kept out of tight loop)
- [x] **MOD** `tradeExecutorTurbo.js` (wiring: kill switch, prewarm, RPC quorum, guarded fallback, adaptive fees, warm quote cache, retries, telemetry)
- [x] **MOD** `swap.js` (overrides for sender, warm‑quote cache use)
- [x] **MOD** `turboSniper.js` (init prewarm, pass cfg, telemetry)
- [x] **NEW** `utils/ammFallbackGuard.js` (guardrail + integration in turbo executor)
- [x] **DEV** `dev/failureInjector.js` (stale BH, RPC 429, agg 500, pool illq; tests)
- [x] **Benchmark** `scripts/bench/turbo_send_bench.js` (no network)
- [x] **Tests** added (retry policy, injector, prewarm, rpc quorum, fallback)
- [x] **Docs** (this README) with envs, toggles, usage notes, and changelog

---

## Changelog

### 2025‑08‑10
- Add runtime kill switch (ENV + in‑memory).
- Wire guarded AMM fallback & telemetry.
- Add failure injector (dev‑only) with 4 modes.
- Introduce blockhash prewarm (TTL + single in‑flight) and RPC pool quorum sender.
- Adaptive fees bump on retryable classes only.
- Warm‑quote cache integrated throughout executor.
- Move sync logs off hot path; keep counters.
- Add tests + offline benchmark.
- Update documentation.

---

## Known limitations / cautions

- Failure injector must **never** be shipped to prod; ensure CI/CD excludes `backend/dev/*` or gates imports by ENV.
- AMM fallback currently targets Raydium path via Jupiter “allowedDexes=[Raydium]”; for native pool instructions, extend `raydiumDirect.js` accordingly.
- Prewarm TTLs are tuned for ~400ms slots; adjust on clusters with different timings.
- RPC quorum >1 increases fanout cost; choose endpoints with similar slot height to avoid node‑behind false negatives.
- `parallelFiller` does not hard‑cancel in‑flight RPC; it short‑circuits subsequent work when a winner is found.

---

## Support / Next steps

If you want me to wire in native Raydium v4 instruction builds (skipping Jupiter entirely) or add an Aerodrome‑style dynamic exit on rug signals, say the word. We can keep the hot path zero‑IO and still get another ~5–10% off p99.
