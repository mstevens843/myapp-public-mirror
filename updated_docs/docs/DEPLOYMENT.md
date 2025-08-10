# Deployment Guide

This document describes recommended deployment practices for the trading bot
backend.  The goal is to run the services reliably in production with
observability, fault tolerance and secure configuration.  Although the
repository does not include an official Docker image or Kubernetes manifests,
the following guidelines provide a starting point.

## Environment Matrix

The bot reads many parameters from environment variables.  A complete list of
variables, their defaults and examples can be found in `docs/CONFIG_REFERENCE.md`.
For production deployments you should provide at least the following:

| Category          | Variables                                            | Notes |
|-------------------|------------------------------------------------------|------|
| **RPC & Trading** | `SOLANA_RPC_URL`, `PRIVATE_SOLANA_RPC_URL`, `PRIVATE_KEY`, `JITO_RELAY_URL` | Choose low‑latency RPC endpoints; avoid free shared RPCs.  Use a dedicated private relay for Jito bundles.  Keep secret keys out of your shell history. |
| **Security**      | `ENCRYPTION_SECRET`, `ENCRYPTION_SECRET_OLD`, `IDEMPOTENCY_SALT`, `METRICS_API_KEY` | Rotate encryption secrets periodically; set a unique idempotency salt to prevent collisions between environments. |
| **Telegram**      | `START_TELEGRAM`, `TELEGRAM_BOT_TOKEN` | Provide a bot token and set `START_TELEGRAM=true` only in environments where human operators interact via Telegram. |
| **Feature Flags** | `DISABLED_STRATEGIES`, `DISABLED_ENDPOINTS`, `METRICS_ALLOW_IPS` | Disable unused strategies or endpoints and restrict metrics access to trusted CIDR ranges. |

Create a `.env` file from the example provided in this repository and load it
via your process manager (e.g. `pm2 start --env production`).  Never commit
real secrets to version control.

## Running the Backend

The backend entry point is `backend/index.js`.  It sets up the Express API,
database connections, strategy loops and telemetry.  To run the server:

```sh
# Install dependencies (once)
npm install

# Copy `.env.example` to `.env` and edit variables
cp .env.example .env

# Start the backend in production mode
NODE_ENV=production node backend/index.js
```

You can also start only the Telegram bot by running `node backend/telegram/index.js` or
the monitors using the scripts in `backend/monitors/`.

## Process Management

Use a process supervisor such as `pm2`, `systemd` or Kubernetes Deployments to
ensure the bot restarts on crash and restarts automatically on code updates.
For example, with pm2:

```sh
pm2 start backend/index.js --name mybot --watch --env production
pm2 start backend/telegram/index.js --name telegram --env production
```

### Autoscaling

Strategies are CPU‑bound only during transaction building and idle most of the
time.  Running multiple instances can increase throughput when handling many
snipes simultaneously.  If using Kubernetes, specify resource requests and
limits (e.g. 200 mCPU, 512 MiB memory) and configure a HorizontalPodAutoscaler
based on CPU usage or queue depth metrics (`queue_depth` gauge【665845919011301†L119-L126】).

## Health Checks

Implement liveness and readiness probes:

* **Liveness** – call `/metrics` or a simple `/ping` endpoint to verify the
  process is responsive.  Ensure authentication is handled.
* **Readiness** – check database connectivity, RPC endpoint availability and
  strategy initialisation.  Expose an endpoint that returns 200 only when the
  bot is ready to accept trades.

If using Kubernetes, configure `livenessProbe` and `readinessProbe` in the
Pod spec accordingly.

## Logs & Monitoring

Configure your logging infrastructure to ingest stdout from the backend.  Set
`DEBUG=*` in development to see detailed module logs, and restrict to
`DEBUG=swap,tradeExecutorTurbo,rpcQuorumClient` in production.  Forward logs
to a central system like Elastic or Loki.  Scrape metrics from `/metrics` and
export them to Prometheus and Grafana dashboards (see `docs/METRICS.md`).

## Database & Storage

While this public mirror does not include database migrations, the backend
expects a PostgreSQL database for recording trades and positions.  Use a
managed database with automated backups.  Configure connection strings via
environment variables (e.g. `DATABASE_URL` if present).  For wallet storage,
use the encrypted envelope scheme described in `WALLET_ENCRYPTION.md` and
enable at‑rest encryption on your storage layer.

## Docker & Containerisation

An example `Dockerfile` could look like:

```Dockerfile
FROM node:18-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production
COPY . .
RUN chown -R node:node /app
USER node
CMD ["node", "backend/index.js"]
```

Build and run with:

```sh
docker build -t mybot .
docker run -d --env-file .env --name mybot mybot
```

You can then deploy this container into your orchestrator of choice.  Add
health check definitions and volumes for persistent storage as needed.

## Zero‑Downtime Upgrades

When deploying updates, ensure new pods start and pass readiness probes before
terminating old ones.  Maintain idempotency by keeping the `IDEMPOTENCY_SALT`
constant between versions; changing it may cause the executor to treat
in‑flight trades as new.  If you must change the salt, drain existing pods and
wait for idempotency caches to expire.