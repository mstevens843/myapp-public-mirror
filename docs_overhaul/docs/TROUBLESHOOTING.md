# Troubleshooting Guide

This document lists common issues encountered when running the bot and provides diagnostic hints with remediation steps.  Always check your logs for specific error messages; most failures include a clear reason string and can be traced back to the relevant module.

## Blockhash Expired

### Symptoms

- Errors such as `"Blockhash not found"` or `"expired blockhash"` when sending a transaction.
- Transactions time out or never appear on chain.

### Cause

Solana requires each transaction to reference a recent blockhash to prevent replay attacks.  If the blockhash becomes stale (older than ~150 seconds) validators will reject the transaction.  In turbo mode the executor prewarms a cache of recent blockhashes and refreshes them when the cache is empty【457849038443768†L18-L27】.  Disabling blockhash prewarm or running on a slow RPC may cause expiry.

### Resolution

1. Ensure `blockhashPrewarm` is enabled (default).  It is disabled only when explicitly turned off in the strategy.
2. Configure multiple fast RPC endpoints via `rpcQuorumClient` so that blockhashes can be refreshed even when one RPC lags【457849038443768†L32-L34】.
3. When sending manual transactions, fetch a fresh blockhash via `connection.getLatestBlockhash()` immediately before building the transaction【457849038443768†L34-L38】.

## Stale Quote or Slippage Violations

### Symptoms

- The execution price differs significantly from the quote.
- The bot logs `"AMM fallback triggered"` due to a stale router quote【457849038443768†L44-L47】.
- Swap fails with `"Slippage limit exceeded"`.

### Cause

Liquidity on newly created pools changes quickly.  The `ammFallbackGuard` monitors the age of quotes and price volatility; if a quote is older than a threshold or volatility exceeds the configured tolerance, the guard aborts the router path and falls back to a direct AMM swap【457849038443768†L51-L56】.  Slippage configured too low can also cause failures.

### Resolution

1. Increase `maxQuoteAgeMs` and volatility thresholds in your strategy if legitimate trades are being aborted【457849038443768†L61-L64】.
2. Adjust your slippage percentage (e.g. `slippageBps`) to tolerate expected price movements during execution【457849038443768†L61-L64】.
3. Use the turbo executor, which recomputes quotes just before sending and falls back to direct AMM when necessary【457849038443768†L66-L67】.

## Quorum Not Met / Partial Acknowledgements

### Symptoms

- The trade executor logs `"quorum not reached"` and rolls back.
- Only a subset of RPC endpoints confirm the transaction.

### Cause

The `RpcQuorumClient` requires that a transaction be acknowledged by a quorum of endpoints.  If endpoints are overloaded or geographically distant the quorum may not be met【457849038443768†L70-L83】.

### Resolution

1. Review your list of RPC endpoints and remove any that are unreliable or high latency【457849038443768†L88-L90】.
2. Lower the quorum threshold (e.g. `quorum=1`) for development at the expense of fault tolerance【457849038443768†L86-L91】.
3. Investigate network connectivity and ensure outbound traffic is not blocked【457849038443768†L92-L93】.

## Idempotency Failures

### Symptoms

- Error `"Duplicate idempotency key"` or repeated trades.
- The executor refuses to send a transaction even though no previous trade succeeded.

### Cause

Turbo mode derives an idempotency key from the strategy, token and block height and stores it in an in‑memory cache with a TTL.  If a previous attempt crashed after storing the key but before sending, subsequent attempts will be considered duplicates until the TTL expires【457849038443768†L106-L112】.

### Resolution

1. Wait for the TTL to expire (default 15 minutes) or adjust `IDEMPOTENCY_TTL_MS`/`IDEMPOTENCY_TTL_SEC` in your configuration【457849038443768†L116-L122】.
2. Ensure the executor completes its send path and does not crash before clearing the key.  Check logs for underlying exceptions【457849038443768†L123-L124】.

## Wallet Not Armed / Encryption Errors

### Symptoms

- Error `"AUTOMATION_NOT_ARMED"` or `"Key not found"` when attempting to sign.
- Strategies exit immediately without sending transactions.

### Cause

Private keys are encrypted using an envelope scheme.  Before signing, the wallet must be armed by decrypting the data encryption key (DEK) and caching it in memory.  If the wallet is not armed or the session has expired the executor throws `AUTOMATION_NOT_ARMED`【457849038443768†L126-L140】.

### Resolution

1. Run the `arm` command via Telegram or CLI.  You will be prompted for your passphrase and optionally a 2FA code【457849038443768†L144-L145】.
2. Ensure `ENCRYPTION_SECRET` is correctly set and matches the secret used during key generation【457849038443768†L144-L148】.
3. Check the session TTL in `sessionKeyCache` and adjust if necessary.  Strategies running longer than the TTL without re‑arming will trigger this error【457849038443768†L149-L153】.

## 2FA or Authorization Failures

### Symptoms

- Telegram bot responds with `"Not authorised"`.
- API requests return `403` despite valid credentials.

### Cause

If two‑factor authentication is enabled, the middleware requires a valid TOTP.  The user must supply a fresh TOTP code via the `X-2FA-Token` header or through the Telegram flow.  Codes expire every 30 seconds【457849038443768†L164-L176】.

### Resolution

1. Ensure 2FA is configured and the correct TOTP secret is stored in your user profile【457849038443768†L170-L174】.
2. Provide a new TOTP code in the header for each request or step【457849038443768†L174-L175】.
3. For testing, disable the 2FA middleware or set `TWO_FA_ENABLED=false` in your environment (reduces security).

## Debugging Tips

- Enable `DEBUG=*` in your environment to see detailed logs from modules such as `tradeExecutorTurbo`, `rpcQuorumClient` and `swap.js`【457849038443768†L180-L184】.
- Use `dryRun=true` to simulate strategies without broadcasting and inspect the output【457849038443768†L185-L186】.
- Inspect the metrics endpoint (`/metrics`) to monitor latency, error rates and circuit breaker health【457849038443768†L187-L188】.
- For persistent issues not covered here, check the code at the referenced lines or add logging around the failing component【457849038443768†L188-L190】.

## Next Steps

* See `docs/CONFIG_REFERENCE.md` for configuration knobs that influence failure modes.
* Review `docs/SECURITY.md` for key lifecycle and incident playbooks.
* Consult `docs/TELEGRAM.md` and `docs/AUTH.md` for further details on authentication flows.