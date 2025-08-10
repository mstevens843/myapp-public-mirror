# Developer Onboarding

Welcome!  This guide provides a fast‑lane to get a development environment running.  Use it to perform your first dry trade in under 15 minutes.  For full context see the deeper docs.

## 0) Prerequisites

- Node.js **18+** with npm (or pnpm/yarn)
- A Solana RPC endpoint (e.g. https://api.mainnet-beta.solana.com or your own private RPC)
- A base58 private key for a throwaway wallet (for local/dev)

> For architecture and module background see `README.md` and `docs/BOT_STRATEGIES.md`.

## 1) Pull Code & Configure

```bash
# from your workspace
git clone https://github.com/YOURUSER/myapp.git
cd myapp

# create your env file
cp docs/examples/.env.example .env
```

Edit `.env` and set the **minimum viable variables**:

| Variable | Why |
|---|---|
| `SOLANA_RPC_URL` | Public RPC; used for quotes and on‑chain reads【732702013707346†L4-L10】. |
| `PRIVATE_KEY` | Base58 encoded secret key for a dev wallet【732702013707346†L12-L17】. |
| `ENCRYPTION_SECRET` | Required for deriving KEKs used in wallet encryption【732702013707346†L27-L31】. |
| `START_TELEGRAM` + `TELEGRAM_BOT_TOKEN` (optional) | Enable Telegram bot for interactive commands【732702013707346†L21-L25】. |
| `PRIVATE_SOLANA_RPC_URL` (optional) | Low‑latency private RPC for turbo trades【732702013707346†L5-L9】. |
| `JITO_RELAY_URL` (optional) | Used for Jito MEV bundles【732702013707346†L9-L10】. |

> A complete reference of every environment variable is provided in `docs/CONFIG_REFERENCE.md`.

## 2) Know the Map (60 Seconds)

The turbo executor pipeline can be summarised as:

```
Event → Passes → Quote → Build → Submit → Post‑trade
  ^       ^       ^        ^        ^          ^
  |       |       |        |        |          |
core/poolCreateListener.js
         core/passes.js
                  utils/swap.js (getSwapQuote / executeSwap*)
                               strategies/core/tradeExecutorTurbo.js
                               strategies/core/rpcQuorumClient.js
                               strategies/core/parallelFiller.js
```

Key pointers:

- Cheatsheet: `docs/strategies/turbo.md` for the end‑to‑end turbo pipeline.
- Trading paths & fees: `docs/TRADING.md`.
- Security & keys: `docs/WALLET_ENCRYPTION.md` and `docs/SECURITY.md`.

## 3) First Run (Pick One Path)

### A) Telegram‑Driven (Interactive)

Launch the Telegram handler:

```bash
node backend/telegram/index.js
```

Use `/status`, `/buy`, `/sell`, `/snipe`, `/tpsl`, `/stop` and other commands to interact with the bot.  See `docs/TELEGRAM.md` for a full command reference.

### B) Strategy/Monitor Runners (Headless)

Run any of the light monitors to smoke‑test the pipeline without a UI:

```bash
node backend/monitors/startMonitorTpSl.js
node backend/monitors/startMonitorLimits.js
node backend/monitors/startMonitorDca.js
```

These monitors use the same utilities as production strategies and will exercise quoting, swap execution and logging without the front‑end.

## 4) Safe Turbo Preset

Start with conservative defaults before tuning.  See the **Safe Turbo** section in `docs/BOT_STRATEGIES.md` for recommended preset values.  This includes moderate probe sizes, reasonable slippage and volatility thresholds.

## 5) Verify Quickly

- Perform a tiny notional trade (or run with `dryRun=true`) and observe logs for:
  - Quote TTL and slippage values – see `utils/swap.js`.
  - Quorum send and blockhash freshness – see `strategies/core/rpcQuorumClient.js`.
  - Idempotency key derivation and TTL – see `strategies/core/tradeExecutorTurbo.js`.
- If anything fails, consult `docs/TROUBLESHOOTING.md`.

## 6) Next Steps

- **Performance:** Tune compute unit price, Jito tips and RPC pools → `docs/PERFORMANCE.md`.
- **Observability:** Explore Prometheus metrics and labels → `docs/METRICS.md` (to be added).
- **Deployment:** Learn about process managers, health checks and backups → `docs/DEPLOYMENT.md`.
- **Security:** Understand key lifecycle and threat models → `docs/SECURITY.md`.

## FAQ

| Question | Answer |
|---|---|
| **Where do I see all envs and defaults?** | `docs/CONFIG_REFERENCE.md`. |
| **Where are the risk checks implemented?** | `backend/services/strategies/core/passes.js`. |
| **How do I split orders across wallets?** | `strategies/core/parallelFiller.js`. |
| **Direct AMM vs aggregator?** | `backend/utils/ammFallbackGuard.js` and `docs/TRADING.md`. |

<small>Questions or gaps?  Add a `TODO(need-code-source)` note directly in the docs and open an issue so we can fix it in the next pass.</small>