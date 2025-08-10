# Developer Onboarding (fast‑lane)

This is the short, copy‑pasteable track to get a dev environment running and oriented. It links to the fuller docs when you need detail.

---

## 0) What you need
- Node.js 18+ and npm (or pnpm/yarn)
- A Solana RPC endpoint
- A base58 private key for a throwaway wallet (for local/dev)

> Full architecture + background: see `README.md` and `docs/BOT.md`.

---

## 1) Pull code & set config
```bash
# from your workspace
git clone https://github.com/mstevens843/myapp-public-mirror.git
cd myapp-public-mirror

# create your env file
cp .env.example .env
```

Edit `.env` and set the **minimum viable vars**:

| Variable | Why |
|---|---|
| `SOLANA_RPC_URL` | Public RPC; used everywhere. |
| `PRIVATE_KEY` | Wallet for local testing. |
| `ENCRYPTION_SECRET` | Required by auth/encryption for secrets-at-rest. |
| `START_TELEGRAM` + `TELEGRAM_BOT_TOKEN` (optional) | If you want to drive the bot from Telegram. |
| `PRIVATE_SOLANA_RPC_URL` (optional) | Low‑latency private RPC for turbo path. |
| `JITO_RELAY_URL` (optional) | If you plan to test Jito bundle sending. |

> Every env var is documented with type/default/source in `docs/CONFIG_REFERENCE.md`.

Quick audit of env usage (optional):
```bash
node scripts/extract-env.mjs ./backend | sort | uniq
```

---

## 2) Know the map (60 seconds)
```
Event → Passes → Quote → Build → Submit → Post‑trade
  ^        ^        ^        ^        ^          ^
  |        |        |        |        |          |
  core/poolCreateListener.js
           core/passes.js
                    utils/swap.js (getSwapQuote / executeSwap*)
                              strategies/core/tradeExecutorTurbo.js
                              strategies/core/rpcQuorumClient.js
                              strategies/core/parallelFiller.js
```
- Cheatsheet: `docs/TURBO_SNIPER.md` (end‑to‑end turbo pipeline)
- Trading paths & fees: `docs/TRADING.md`
- Security & keys: `docs/WALLET_ENCRYPTION.md`, `docs/SECURITY.md`

---

## 3) First run (pick ONE path)

### A) Telegram‑driven (interactive)
```bash
# brings up the Telegram command handler
node backend/telegram/index.js
```
- Commands cheat‑sheet: `docs/TELEGRAM.md` (status, snipe, setconfig, stop, panic)
- Gate access: see `backend/telegram/utils/auth.js`

### B) Strategy/monitor runners (headless)
Run any of the light monitors (good for smoke tests):
```bash
node backend/monitors/startMonitorTpSl.js
node backend/monitors/startMonitorLimits.js
node backend/monitors/startMonitorDca.js
```
> These use the same utils and will exercise swap/quote/logging without the full UI.

---

## 4) Safe Turbo preset (recommended defaults)
Start with a conservative baseline before turning knobs:
- See **Safe Turbo** section in `docs/TURBO_SNIPER.md` for the preset values and rationale.
- Validators & gotchas: `docs/BOT.md` and `docs/TROUBLESHOOTING.md`.

---

## 5) Verify quickly
- Run a tiny notional trade (or **dry‑run** if your entrypoint supports it) and watch logs for:
  - quote ttl, slippage, size → `utils/swap.js`
  - quorum send + blockhash freshness → `strategies/core/rpcQuorumClient.js`
  - idempotency key + ttl → `strategies/core/tradeExecutorTurbo.js`
- If anything fails, jump to `docs/TROUBLESHOOTING.md`.

---

## 6) Next steps (choose your lane)
- **Performance**: tune CU price, Jito tips, RPC pool → `docs/PERFORMANCE.md`
- **Observability**: Prometheus metrics and labels → `docs/METRICS.md`
- **Deployment**: process manager, health, backups → `docs/DEPLOYMENT.md`
- **Security**: key lifecycle, incident playbook → `docs/SECURITY.md`

---

## FAQ
- **Where do I see all envs and defaults?** → `docs/CONFIG_REFERENCE.md`
- **Where are the risk checks?** → `backend/services/strategies/core/passes.js`
- **How do I split orders across wallets?** → `strategies/core/parallelFiller.js`
- **Direct AMM vs aggregator?** → `backend/utils/ammFallbackGuard.js` and `docs/TRADING.md`

<small>Questions or gaps? Ping the team and add a `TODO(need-code-source)` note directly in the docs so we fix it in a code‑backed pass.</small>
