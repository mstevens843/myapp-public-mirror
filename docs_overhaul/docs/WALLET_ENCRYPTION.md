# Wallet Encryption & Key Management

This trading bot must handle private keys securely.  Keys are never stored in plain text; instead they are encrypted at rest and only decrypted in memory when needed.  This document summarises the encryption scheme and the operational lifecycle of keys.

## Envelope Encryption

Private keys are wrapped using a two‑layer envelope pattern implemented in `backend/armEncryption/envelopeCrypto.js`【670737199171197†L10-L24】.  When a user uploads a key:

1. **Derive a Key Encryption Key (KEK)** – The user’s passphrase is combined with a random salt and passed through Argon2id (a memory‑hard KDF) to derive a 32‑byte KEK【670737199171197†L10-L24】.
2. **Generate a Data Encryption Key (DEK)** – A random 32‑byte DEK is generated.  The private key is encrypted with the DEK using AES‑256‑GCM【670737199171197†L17-L21】.
3. **Wrap the DEK** – The DEK is then encrypted with the KEK via AES‑256‑GCM【670737199171197†L20-L23】.  The result is a blob containing the wrapped DEK, IVs, tags and KDF parameters.  Additional Authenticated Data (AAD) binds the ciphertext to a user/wallet context【670737199171197†L22-L25】.
4. **Zeroization** – Intermediate keys (KEK and DEK) are zeroed in memory immediately after use【670737199171197†L26-L28】.

During decryption the process is reversed: the KEK is derived from the passphrase and salt, used to decrypt the DEK, and finally the DEK decrypts the private key.  If any step fails an `Error("Decryption failed")` is thrown and no key material is returned【670737199171197†L30-L33】.

## Session Key Cache (Arm‑to‑Trade)

To prevent unencrypted keys from being persisted to disk, the bot uses an **in‑memory session cache** for Data Encryption Keys (DEKs).  The module `backend/armEncryption/sessionKeyCache.js` exposes functions to arm, extend and disarm wallet sessions【670737199171197†L35-L49】.  When a user “arms” a wallet:

1. The decrypted DEK is stored in a Map keyed by `userId:walletId` along with an expiry timestamp【670737199171197†L37-L43】.
2. The `arm()` function takes a TTL in milliseconds and stores the DEK and expiry.  Subsequent calls to `getDEK()` return the DEK as long as the TTL has not elapsed; otherwise the session is purged【670737199171197†L43-L48】.
3. The cache is swept periodically and any expired DEKs are zeroised.  This design ensures that keys are only resident in memory for a bounded period and can be explicitly disarmed by the user【670737199171197†L43-L48】.

Two environment variables control session and envelope encryption:

| Variable | Purpose | Default | Used In |
|---|---|---|---|
| `ENCRYPTION_SECRET` | Hex‑encoded 32‑byte secret used to encrypt/decrypt sensitive fields via AES‑256‑GCM.  Missing this variable causes the server to throw at startup【670737199171197†L55-L57】. | none – **required** | `backend/middleware/auth/encryption.js` |
| `ENCRYPTION_SECRET_OLD` | Optional secondary hex key used for key rotation.  When provided it allows the server to decrypt data encrypted with the old key while encrypting new data with the primary key【670737199171197†L59-L62】. | `null` | `backend/middleware/auth/encryption.js` |

## In‑Memory Private Key Loading

For swap execution the bot must sign transactions.  The helper `backend/utils/swap.js` loads the base58‑encoded private key from `process.env.PRIVATE_KEY` and converts it to a Keypair【670737199171197†L67-L72】.  If this variable is missing or invalid the module throws an error.  The private key is never written back to disk.  When running strategies in parallel across multiple wallets a similar mechanism loads additional keys (`PRIVATE_KEY2`, etc.).

## Operational Guidance

* Generate your **passphrase** offline and keep it secret.
* Store your **encrypted private key blob** (the envelope) in the database or your password manager – never store raw keys in `.env`.
* Use `arm()` to load the DEK into memory only when you intend to trade.  The session will expire automatically based on the configured TTL.  Disarm the wallet after trading or when stepping away from the machine.
* Rotate the encryption secret periodically by setting `ENCRYPTION_SECRET_OLD` to the previous key and updating `ENCRYPTION_SECRET` with the new one.  Run a migration script to re‑encrypt existing data, then remove the old secret.

## TODO

The current mirror does not include the endpoint to arm/disarm wallets nor the frontend flow prompting for the passphrase【670737199171197†L93-L98】.  Those handlers should be documented in future work.  If you add new key management functions, update this document and [`docs/SECURITY.md`](SECURITY.md).

## Next Steps

* Set `ENCRYPTION_SECRET` and (optionally) `ENCRYPTION_SECRET_OLD` in your `.env` file (see [`docs/CONFIG_REFERENCE.md`](CONFIG_REFERENCE.md)).
* See [`docs/SECURITY.md`](SECURITY.md) for threat models and incident response steps.
* Learn how to arm a wallet via CLI or Telegram commands in [`docs/TELEGRAM.md`](TELEGRAM.md).
