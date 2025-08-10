# Security

Protecting private keys, preventing unauthorized trades and mitigating insider risk are paramount for a trading bot.  This document outlines the threat model and the controls implemented to safeguard your funds.  Where the code does not yet implement a control, a `TODO` note is left for future hardening.

## Threat Model

* **Key theft** – An attacker may obtain access to the machine running the bot or leak the `.env` file and steal the unencrypted `PRIVATE_KEY`.  If stolen, funds can be lost immediately【765796178364190†L7-L12】.
* **Unauthorized commands** – Without proper access control, an unauthorized user could send buy/sell commands via Telegram or REST and drain funds【765796178364190†L13-L17】.
* **Malicious tokens** – Buying tokens with high holder concentration or low liquidity burn is risky and may lead to rugs.  Heuristics aim to mitigate this, but false negatives are possible【765796178364190†L15-L18】.
* **Network attacks** – Relying on a single public RPC exposes the bot to rate limiting, dropped transactions or censorship【765796178364190†L18-L20】.

## Controls

### Environment & Feature Flags

* Store secrets in a `.env` file outside version control.  The swap module explicitly throws if `SOLANA_RPC_URL` or `PRIVATE_KEY` is missing or invalid【765796178364190†L26-L30】.
* Disable strategies or API endpoints globally by setting `DISABLED_STRATEGIES` or `DISABLED_ENDPOINTS`【765796178364190†L30-L33】.  Feature flags prevent accidental execution of unstable components.

### Wallet Encryption & Arm‑to‑Trade

* **Envelope encryption** – Private keys are encrypted using a two‑layer envelope pattern: a Data Encryption Key (DEK) encrypts the private key with AES‑256‑GCM and is itself wrapped by a Key Encryption Key (KEK) derived from your passphrase【670737199171197†L8-L27】.  Additional Authenticated Data (AAD) binds the ciphertext to a context.
* **Arm sessions** – Before an automated strategy can trade with a protected wallet, the user must **arm** the wallet.  The `armSessionManager` caches the decrypted DEK in memory with a TTL and returns `AUTOMATION_NOT_ARMED` if a trade is attempted without an active session【765796178364190†L47-L51】.  Keys are zeroised upon disarm or expiry.
* **Passphrase & 2FA** – Use a strong passphrase and optionally enable two‑factor authentication when arming a wallet.  The code currently leaves 2FA enforcement as a TODO【765796178364190†L53-L56】.

### Telegram Bot Hardening

* Only authorised chat IDs should be allowed to interact with the bot.  Implement an allow‑list in `isAuthorized` and reject unauthorized attempts【765796178364190†L60-L64】.
* Avoid exposing destructive commands (e.g. `/shutdown`) in production; restrict them to admin users【765796178364190†L63-L64】.
* Do not log secrets or user data to console.  Redact wallet addresses, passphrases and tokens before logging【765796178364190†L65-L67】.

### RPC & Network

* Use multiple RPC endpoints and quorum sending via `rpcQuorumClient` to avoid single points of failure【765796178364190†L70-L76】.
* The RPC manager rotates endpoints after consecutive errors【765796178364190†L71-L79】.  Configure quorum size and acknowledgment thresholds according to your tolerance for missing a block.
* When using Jito bundles, sign your own transactions and send them to reputable relays.  Never allow untrusted code to sign on your behalf【765796178364190†L80-L81】.

### Incident Playbook

1. **Key compromise** – Immediately revoke the affected wallet by withdrawing funds to a new address and removing the private key from all environments.  If using envelope encryption, disarm the session to zeroise the DEK【765796178364190†L85-L88】.
2. **Unauthorized Telegram access** – Rotate the bot token via BotFather and update `TELEGRAM_BOT_TOKEN`.  Adjust the allow‑list in `isAuthorized`【765796178364190†L88-L91】.
3. **RPC outage** – If many `rpc-quorum-not-reached` errors occur, switch to backup endpoints and consider lowering the quorum threshold【765796178364190†L91-L93】.
4. **Heuristic false negative** – If a rug is detected after purchase, tighten the heuristics thresholds (holder concentration, LP burn minimum) in your configuration and monitor metrics【765796178364190†L93-L95】.

## TODOs

* **CSRF & Session cookies** – The current code does not expose a web login, but if HTTP endpoints are added, ensure CSRF tokens and secure cookies are used【765796178364190†L99-L101】.
* **Role‑based access control** – Currently authorization is binary.  Future development should implement roles (admin vs trader) and map them to commands and strategy controls【765796178364190†L100-L103】.
* **Audit logging** – Centralise logs and audit them for anomalies.  Offload logs to a secure store instead of stdout【765796178364190†L104-L106】.

## Next Steps

* See [`docs/WALLET_ENCRYPTION.md`](WALLET_ENCRYPTION.md) for details on the envelope encryption scheme.
* Configure two‑factor authentication via [`docs/AUTH.md`](AUTH.md) and set `TWO_FA_ENABLED=true` in production.
* Read [`docs/CORS.md`](CORS.md) to harden HTTP endpoints against cross‑origin attacks.
