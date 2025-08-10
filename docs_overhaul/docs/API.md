# API Reference

This document describes the REST and WebSocket interfaces exposed by the trading bot.  The API is subject to change; consult the OpenAPI specification (`docs/examples/openapi.yaml`) for up‑to‑date schemas and status codes.  All endpoints accept and return JSON.  Authentication is required unless noted otherwise.

## Base URLs

The backend server listens on `http://localhost:3001` by default.  When deployed behind a reverse proxy, adjust accordingly.  WebSocket connections are upgraded on the same port under `/ws`.

## Authentication

API requests require a valid session cookie issued after signing in.  To obtain a session:

1. Request a login nonce via `POST /auth/nonce` (unauthenticated).  The server returns a random challenge.
2. Sign the nonce with your Solana wallet and send it to `POST /auth/login` along with the wallet public key.  The server verifies the signature and issues a short‑lived session cookie (see [`docs/AUTH.md`](AUTH.md)).
3. Include the session cookie on subsequent requests.  If two‑factor authentication is enabled, send a TOTP code in the `X-2FA-Token` header.

## Error Envelope

Errors are returned with appropriate HTTP status codes and a JSON body:

```json
{
  "error": "string describing the problem",
  "code": "optional machine readable code"
}
```

For unauthorized requests the server returns `401` (`Unauthorized`).  For forbidden actions (e.g. lacking admin role) it returns `403` (`Forbidden`).  Invalid inputs result in `400` (`Bad Request`).

## Placeholder Endpoints

Below is a high‑level overview of planned endpoints.  They are provided as a starting point for implementers and to assist with documentation.  Check the code for actual handlers.

### Strategies

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/api/strategies` | List all configured strategies along with their status (running/stopped), wallets and configuration. | ✔️ |
| `POST` | `/api/strategies` | Create and start a new strategy instance.  Body includes the strategy type (`scalper`, `sniper`, `rotation`, etc.) and configuration options (notional amount, slippage, wallet index). | ✔️ (admin) |
| `POST` | `/api/strategies/:id/start` | Start or resume a paused strategy. | ✔️ (admin) |
| `POST` | `/api/strategies/:id/stop` | Stop a running strategy. | ✔️ (admin) |
| `DELETE` | `/api/strategies/:id` | Remove a strategy configuration.  Does not cancel open positions. | ✔️ (admin) |

### Trades & Positions

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/api/positions` | Retrieve current positions for all wallets.  Supports query parameters `wallet`, `token` and `limit`. | ✔️ |
| `GET` | `/api/trades` | List recent trades.  Supports pagination via `offset` and `limit` query parameters. | ✔️ |
| `GET` | `/api/trades/:signature` | Get details of a specific trade by transaction signature. | ✔️ |

### Wallets & Sessions

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/api/wallets` | List loaded wallets and their public keys. | ✔️ |
| `POST` | `/api/wallets/arm` | Decrypt a wallet’s private key envelope and arm it for trading.  Body includes `walletId`, passphrase and optional TOTP. | ✔️ |
| `POST` | `/api/wallets/disarm` | Disarm a wallet, wiping its DEK from memory. | ✔️ |

### Utility

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/ping` | Health check endpoint; returns `pong`. | ✖️ |
| `GET` | `/metrics` | Prometheus metrics exposition.  Requires `METRICS_API_KEY` unless configured otherwise. | Conditional |
| `GET` | `/logs` | WebSocket endpoint for streaming logs in real time.  Subscribes to all logs from backend modules. | ✔️ |

## Pagination & Filtering

List endpoints support common query parameters:

- `limit` – maximum number of items to return (default 50, maximum 100).
- `offset` – zero‑based index to start listing from.  Use in combination with `limit` for pagination.
- Additional filters (e.g. `wallet`, `token`, `status`) may be supported per endpoint.

## WebSocket Events

Clients can subscribe to a WebSocket at `/ws` to receive log events and status updates.  Messages are JSON encoded with at least a `type` field.  Example:

```json
{ "type": "log", "module": "tradeExecutorTurbo", "level": "info", "message": "quote fetched", "timestamp": 1620000000 }
```

Separate event channels for strategy updates or positions may be implemented in future iterations.

## Next Steps

* See [`docs/AUTH.md`](AUTH.md) for authentication flows, session cookies and 2FA.
* Consult `docs/examples/openapi.yaml` for the OpenAPI scaffold and contribute endpoint definitions.
* To understand how strategies work behind the scenes, read [`docs/BOT_STRATEGIES.md`](BOT_STRATEGIES.md).
