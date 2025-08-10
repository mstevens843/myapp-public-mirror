# Security

This document outlines the threat model and security controls in the trading
bot.  Protecting private keys, preventing unauthorized trades and mitigating
insider risk are paramount.  Where the code does not yet implement a
control, a TODO is marked for future hardening.

## Threat Model

* **Key theft:** An attacker may obtain access to the machine running the bot
  or leak the `.env` file and steal the unencrypted `PRIVATE_KEY` used by
  the wallet.  If stolen, funds can be lost immediately.
* **Unauthorized access via Telegram:** If the Telegram bot is exposed, an
  unauthorized user could send buy/sell commands and drain funds.
* **Malicious tokens:** Buying tokens with high holder concentration or low
  liquidity burn is risky and may lead to rugs.  The bot’s heuristics aim to
  mitigate this, but false negatives are possible.
* **Network attacks and RPC manipulation:** Sending a transaction through a
  single public RPC endpoint exposes the bot to rate limiting, dropped
  transactions or censorship.

## Controls

### Environment & Feature Flags

* Use `.env` to define secrets and do not commit it to version control.  The
  swap module explicitly throws if `SOLANA_RPC_URL` is missing or invalid【107868020100458†L19-L25】, and if `PRIVATE_KEY` is not present【107868020100458†L35-L41】.
* Disable strategies or API endpoints globally by setting
  `DISABLED_STRATEGIES` or `DISABLED_ENDPOINTS`【8826520530653†L21-L32】.  These
  feature flags prevent accidental execution of unstable components.

### Wallet Encryption & Arm‑to‑Trade

* **Envelope encryption:** Wallet private keys can be stored encrypted at rest
  using an envelope scheme.  A random Data Encryption Key (DEK) encrypts the
  private key with AES‑256‑GCM; the DEK is wrapped by a Key Encryption Key
  (KEK) derived from the user’s passphrase using Argon2id【593023059091716†L7-L83】.
  Additional Authenticated Data (AAD) binds the ciphertext to a user/wallet
  context.  Call `encryptPrivateKey` to encrypt and `decryptPrivateKeyWithDEK`
  to decrypt given a DEK【593023059091716†L47-L114】.
* **Arm sessions:** Before an automated strategy can trade with a protected
  wallet, the user must **arm** the wallet.  The `armSessionManager` stores
  the DEK in memory with a TTL and returns `AUTOMATION_NOT_ARMED` if a trade
  is attempted without an active session【30051125156274†L231-L248】.  Keys are
  zeroized upon disarm or expiry【512100359176476†L20-L27】.
* **Passphrase & 2FA:** The commented example in `armSession.js` shows how to
  use a passphrase and optional 2FA code to unwrap a DEK and arm a wallet.
  TODO(need‑code‑source): enforce 2FA in production.

### Telegram Bot Hardening

* Only authorized chat IDs should be allowed to interact with the bot.  The
  helper `isAuthorized` must implement an allow‑list; unauthorized attempts
  respond with a rejection message【673739940498900†L67-L79】.
* Avoid exposing `/shutdown` in production; restrict it to admin users only
  【673739940498900†L116-L123】.
* Do not log secrets or user data to console.  Sensitive information (wallet
  addresses, passphrases) should be redacted before logging.  TODO: audit all
  log statements for secrets.

### RPC & Network

* Use multiple RPC endpoints and quorum sending via `RpcQuorumClient` to avoid
  single points of failure【338326861738027†L24-L96】.  Configure the quorum size
  and required acknowledgments per your tolerance for missing a block.
* The RPC manager (`utils/rpcManager.js`) tracks consecutive errors and
  automatically rotates to the next endpoint after a threshold【574005653334842†L25-L77】.
* When using Jito bundles, sign your own transactions and send them to
  reputable relays.  Never allow untrusted code to sign on your behalf.

### Incident Playbook

1. **Key Compromise:** Immediately revoke the affected wallet by withdrawing
   funds to a new address and removing the private key from all environments.
   If using envelope encryption, disarm the session to zeroize the DEK.
2. **Unauthorized Telegram Access:** Rotate the bot token via BotFather and
   update `TELEGRAM_BOT_TOKEN`.  Adjust the allow‑list in `isAuthorized`.
3. **RPC Outage:** If many `rpc-quorum-not-reached` or similar errors occur,
   switch to backup endpoints and consider lowering the quorum.
4. **Heuristic False Negative:** If a rug is detected after purchase,
   tighten the heuristics thresholds (holder concentration, LP burn minimum)
   in your configuration.  Monitor the metrics for patterns.

## TODOs

* **CSRF & Session cookies:** The current code does not expose a web login,
  but if HTTP endpoints are added, ensure CSRF tokens and secure cookies are
  used.  TODO(need‑code‑source): verify Express middlewares.
* **Role‑based access control:** Currently authorization is binary.  Future
  development should implement roles (admin vs trader) and map them to
  commands and strategy controls.
* **Audit logging:** Centralise logs and audit them for anomalies.  Offload
  logs to a secure store instead of stdout.