# Deployment Guide

This guide describes recommended deployment practices for the trading bot.  The goal is to run the services reliably in production with observability, fault tolerance and secure configuration.  Although the repository does not include an official Docker image or Kubernetes manifests, the following guidelines provide a starting point for operators.

## Environment Matrix

The bot reads many parameters from environment variables.  A complete list of variables, their defaults and examples is documented in [`docs/CONFIG_REFERENCE.md`](CONFIG_REFERENCE.md).  For production deployments you should provide at least the following categories of variables:

| Category | Variables | Notes |
|---|---|---|
| **RPC & Trading** | `SOLANA_RPC_URL`, `PRIVATE_SOLANA_RPC_URL`, `PRIVATE_KEY`, `JITO_RELAY_URL` | Choose low‑latency RPC endpoints; avoid free shared RPCs.  Use a dedicated private relay for Jito bundles.  Keep secret keys out of your shell history. |
| **Security** | `ENCRYPTION_SECRET`, `ENCRYPTION_SECRET_OLD`, `IDEMPOTENCY_SALT`, `METRICS_API_KEY` | Rotate encryption secrets periodically; set a unique idempotency salt to prevent collisions between environments. |
| **Telegram** | `START_TELEGRAM`, `TELEGRAM_BOT_TOKEN` | Provide a bot token and set `START_TELEGRAM=true` only in environments where operators interact via Telegram. |
| **Feature Flags & Metrics** | `DISABLED_STRATEGIES`, `DISABLED_ENDPOINTS`, `METRICS_ALLOW_IPS` | Disable unused strategies or endpoints and restrict metrics access to trusted CIDR ranges. |

Copy `docs/examples/.env.example` to `.env`, edit the values and load it via your process manager.  **Never commit `.env` to version control.**

## Running the Backend

The backend entry point is `backend/index.js`.  It sets up the Express API, strategy loops, encryption, session handling and metrics.  To run the server:

```sh
npm install
# copy the example env and edit your secrets
cp docs/examples/.env.example .env

# start the backend in production mode
NODE_ENV=production node backend/index.js
```

To start only the Telegram bot, run `node backend/telegram/index.js`.  To launch monitors (e.g. TP/SL, limits, DCAs) run the scripts under `backend/monitors/`.

## Process Management

Use a process supervisor such as **pm2**, **systemd** or **Kubernetes Deployments** to ensure the bot restarts on crash and on code updates.  Example using pm2:

```sh
pm2 start backend/index.js --name mybot --watch --env production
pm2 start backend/telegram/index.js --name telegram --env production
```

When using Kubernetes, specify resource requests and limits (e.g. 200 mCPU and 512 MiB memory) and configure a HorizontalPodAutoscaler based on CPU usage or queue depth metrics (`queue_depth`).

### Autoscaling

Strategies are CPU‑bound only during transaction build and idle most of the time.  Running multiple instances can increase throughput when handling many snipes simultaneously.  Use environment variables such as `START_STRATEGIES`, `MAX_CONCURRENCY`, `COMPUTE_UNIT_PRICE` and `JITO_TIP_LAMPORTS` to tune concurrency and fees (see [`docs/CONFIG_REFERENCE.md`](CONFIG_REFERENCE.md)).

## Health Checks

Implement **liveness** and **readiness** probes:

- **Liveness** – call `/ping` or `/metrics` to verify that the process is responsive.  Ensure authentication is handled correctly.
- **Readiness** – check database connectivity, RPC endpoint availability and strategy initialisation.  Expose an endpoint that returns `200` only when the bot is ready to accept trades.

If using Kubernetes, configure `livenessProbe` and `readinessProbe` in the Pod spec accordingly.

## Logs & Monitoring

Configure your logging infrastructure to ingest stdout from the backend.  Set `DEBUG=*` in development to see detailed module logs, and restrict to specific namespaces (e.g. `swap`, `tradeExecutorTurbo`, `rpcQuorumClient`) in production.  Forward logs to a central system like Elastic or Loki.  Scrape metrics from `/metrics` and export them to Prometheus and Grafana dashboards.  See [`docs/PERFORMANCE.md`](PERFORMANCE.md) for metrics and tuning guidance.

## Database & Storage

This mirror does not include migrations, but the backend can record trades and positions in a PostgreSQL database.  Use a managed database with automated backups.  Configure the connection string via `DATABASE_URL`.  For wallet storage, use the encrypted envelope scheme described in [`docs/WALLET_ENCRYPTION.md`](WALLET_ENCRYPTION.md).  Enable at‑rest encryption on your storage layer.

## Docker & Containerisation

A minimal `docker-compose.yml` is provided under `docs/examples/` to illustrate a three‑service stack (backend, frontend and Postgres).  It is not intended for production but serves as a starting point.  Example Dockerfile:

```Dockerfile
FROM node:18-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production
COPY . .
USER node
CMD ["node", "backend/index.js"]
```

Build and run with:

```sh
docker build -t mybot .
docker run -d --env-file .env --name mybot -p 3001:3001 mybot
```

You can then deploy this container into your orchestrator of choice.  Add health check definitions and volume mounts for persistent storage as needed.

## Zero‑Downtime Upgrades

When deploying updates, ensure new pods start and pass readiness probes before terminating old ones.  Maintain idempotency by keeping the `IDEMPOTENCY_SALT` constant between versions; changing it may cause the executor to treat in‑flight trades as new.  If you must change the salt, drain existing pods and wait for idempotency caches to expire (default 15 minutes).  For high‑availability deployments consider running multiple instances and load balancing traffic.

## Next Steps

* Review [`docs/SECURITY.md`](SECURITY.md) for security hardening.
* Configure CORS following the recipe in [`docs/CORS.md`](CORS.md).
* Use the example `docker-compose.yml` in `docs/examples/` as a starting point for containerised deployments.
