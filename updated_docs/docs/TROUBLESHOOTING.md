# Troubleshooting Guide

This guide lists common issues encountered when running the bot and provides
diagnostic hints along with remediation steps.  Always check your logs for
specific error messages; most failures include a clear reason string and can
be traced back to the relevant module.

## Blockhash Expired

### Symptoms

- Error message `"Blockhash not found"` or `"expired blockhash"` when sending a
  transaction.
- Transactions time out or never appear on chain.

### Cause

The Solana network requires that each transaction reference a recent blockhash
to prevent replay attacks.  If the blockhash becomes stale (older than ~150
seconds) validators will reject the transaction.  In turbo mode the executor
prewarms a cache of recent blockhashes and refreshes them whenever the cache
is empty【30051125156274†L369-L373】.  If you disable blockhash prewarm or run the
bot on a slow or unreliable RPC endpoint the blockhash may expire before
submission.

### Resolution

1. Ensure `blockhashPrewarm` is enabled (default).  It is disabled only when
   explicitly turned off in the strategy configuration.
2. Configure multiple fast RPC endpoints via the `rpcQuorumClient` so that
   blockhashes can be refreshed even when one RPC lags.  See
   `docs/CONFIG_REFERENCE.md` for environment variables controlling RPC hosts.
3. When sending manual transactions, fetch a fresh blockhash via
   `connection.getLatestBlockhash()` immediately before building the transaction.

## Stale Quote or Slippage Violations

### Symptoms

- Quote price differs significantly from execution price.
- Error `"AMM fallback triggered"` due to stale router quote【628800443557218†L0-L37】.
- Swap fails with `"Slippage limit exceeded"`.

### Cause

Liquidity on newly created pools changes rapidly.  `ammFallbackGuard`
monitors the age of quotes and price volatility; if the quote is older than a
threshold or volatility exceeds the configured tolerance, the guard aborts the
router path and falls back to a direct AMM swap【628800443557218†L0-L37】.
Additionally, slippage configured too low can cause transactions to fail.

### Resolution

1. Increase the `maxQuoteAgeMs` and volatility thresholds in the strategy
   configuration if legitimate trades are being aborted.
2. Adjust your slippage percentage (e.g. `slippageBps` on quote requests) to
   tolerate expected price movements during execution【107868020100458†L49-L83】.
3. Use the turbo executor which recomputes quotes just before sending and can
   fall back to direct AMM when necessary.

## Quorum Not Met / Partial Acknowledgements

### Symptoms

- The trade executor logs `"quorum not reached"` and rolls back.
- Only a subset of RPC endpoints return `Signature confirmation`.

### Cause

The `RpcQuorumClient` requires that a transaction be acknowledged by a quorum
of endpoints before it is considered sent.  If one or more endpoints fail to
return in time the quorum may not be met【338326861738027†L24-L96】.  This can occur
if endpoints are overloaded, misconfigured or geographically distant.

### Resolution

1. Review the list of RPC endpoints and remove any that are unreliable or
   introduce high latency.  Use providers with low latency to your region.
2. Lower the quorum threshold (e.g. `quorum=1` for development) at the risk
   of reduced fault tolerance.
3. Investigate network connectivity and ensure outbound traffic is not blocked
   by firewalls.

## Idempotency Failures

### Symptoms

- Error `"Duplicate idempotency key"` or repeated trades.
- Trade executor refuses to send a transaction even though no previous trade
  succeeded.

### Cause

The turbo executor uses an idempotency key derived from the strategy, token
address, block height and the `IDEMPOTENCY_SALT` environment variable
【30051125156274†L190-L200】.  The key is stored in an in‑memory cache with TTL
(`IDEMPOTENCY_TTL_MS` or `IDEMPOTENCY_TTL_SEC`).  If a previous attempt
crashed after persisting the key but before sending the transaction, the
executor will consider subsequent attempts duplicates until the TTL expires.

### Resolution

1. Wait for the idempotency TTL to expire (default 15 minutes)【692999803040974†L0-L2】
   and retry.
2. Adjust `IDEMPOTENCY_TTL_MS` or `IDEMPOTENCY_TTL_SEC` in your configuration
   to shorten the window (increased risk of duplicates) or lengthen it (in
   environments with unreliable crash recovery).
3. Ensure the executor completes its send path and does not crash before
   clearing the idempotency key (check logs for underlying exception).

## Wallet Not Armed / Encryption Errors

### Symptoms

- Error `"AUTOMATION_NOT_ARMED"` or `"Key not found"` when attempting to sign.
- Strategies exit immediately without sending transactions.

### Cause

The bot stores encrypted private keys in a secure envelope; before signing
transactions the wallet must be armed by decrypting the data encryption key
(DEK) and caching it in memory.  If the wallet is not armed or the session has
expired the executor throws `AUTOMATION_NOT_ARMED`【512100359176476†L20-L27】.

### Resolution

1. Run the `arm` command via Telegram or CLI to decrypt your wallet.  You will
   be prompted for your passphrase and optionally 2FA.
2. Ensure `ENCRYPTION_SECRET` is set correctly and matches the secret used
   during key generation【101048639847225†L6-L21】.
3. Check the session TTL in `sessionKeyCache.js` and adjust if necessary (see
   `WALLET_ENCRYPTION.md` for details).  Running strategies for longer than
   the TTL without re‑arming will trigger this error.【538111966748365†L21-L29】.

## 2FA or Authorization Failures

### Symptoms

- Telegram bot responds with `"Not authorised"`.
- API requests return `403` despite valid credentials.

### Cause

The middleware implements optional two‑factor authentication.  If `check2FA`
middleware is enabled the user must supply a valid TOTP code via the
`X-2FA-Token` header for API requests or through the Telegram bot flow.  The
middleware validates the TOTP using `speakeasy` and returns `403` on failure
【306951265335037†L10-L54】.

### Resolution

1. Ensure 2FA is configured and the correct TOTP secret is stored in your
   user profile.
2. Supply a fresh TOTP code in the header for each request.  Codes expire
   every 30 seconds.
3. If you wish to disable 2FA for testing, adjust your configuration or
   remove the `check2FA` middleware from the Express router.  Note that this
   reduces security.

## Debugging Tips

- Enable `DEBUG=*` in your environment to see detailed logs from modules such
  as `tradeExecutorTurbo`, `rpcQuorumClient` and `swap.js`.
- Use `dryRun=true` or `simulated=true` to simulate strategies without
  broadcasting transactions.
- Inspect the metrics endpoint (`/metrics`) to monitor latency, error rates and
  circuit breaker health (see `docs/METRICS.md`).
- For persistent issues not covered here, check the code at the referenced
  lines or add additional logging around the failing component.