## Wallet Encryption & Key Management

This trading bot must handle private keys securely.  Keys are never stored in
plain text; instead they are encrypted at rest and only decrypted in memory
when needed.  This document summarises the encryption scheme and the
operational lifecycle of keys.

### Envelope encryption

Private keys are wrapped using a two‑layer envelope pattern implemented in
`backend/armEncryption/envelopeCrypto.js`.  When a user uploads a key:

1. **Derive a Key Encryption Key (KEK)** – The user’s passphrase is combined
   with a random salt and passed through Argon2id (memory‑hard KDF) to derive
   a 32‑byte KEK【593023059091716†L18-L27】.
2. **Generate a Data Encryption Key (DEK)** – A random 32‑byte DEK is
   generated.  The private key buffer is encrypted with the DEK using
   AES‑256‑GCM【593023059091716†L31-L62】.
3. **Wrap the DEK** – The DEK is then encrypted with the KEK, also via
   AES‑256‑GCM【593023059091716†L60-L78】.  The result is a blob containing
   the wrapped DEK, the IVs, tags and KDF parameters.  Only a hint of
   application‑supplied AAD (Additional Authenticated Data) is stored in
   the blob; callers must supply the full AAD when unwrapping【593023059091716†L77-L83】.
4. **Zeroization** – Intermediate keys (KEK and DEK) are zeroed in memory
   immediately after use to reduce the risk of leakage【593023059091716†L64-L67】.

During decryption the process is reversed: the KEK is derived from the
passphrase and salt, used to decrypt the DEK, and finally the DEK decrypts
the private key【593023059091716†L85-L113】.  If any step fails an
`Error("Decryption failed")` is thrown and no key material is returned.

### Session key cache (Arm‑to‑Trade)

To prevent unencrypted keys from being persisted to disk, the bot uses an
in‑memory session cache for Data Encryption Keys (DEKs).  The module
`backend/armEncryption/sessionKeyCache.js` exposes functions to arm, extend and
disarm wallet sessions.  When a user “arms” a wallet, the decrypted DEK is
stored in a Map keyed by `userId:walletId` along with an expiry timestamp.
The `arm()` function takes a TTL in milliseconds and stores the DEK and
expiry【538111966748365†L21-L29】.  Subsequent calls to `getDEK()` return the
DEK as long as the TTL has not elapsed; otherwise the session is purged
automatically【538111966748365†L47-L51】.  The cache is swept every 30 seconds
and any expired DEKs are zeroized【538111966748365†L96-L105】.  This design
ensures that keys are only resident in memory for a bounded period and can
be explicitly disarmed by the user.

Two environment variables control session and envelope encryption:

| Variable | Purpose | Default | Source |
|---|---|---|---|
| `ENCRYPTION_SECRET` | Hex‑encoded 32‑byte secret used to encrypt/decrypt
  sensitive fields via `aes‑256‑gcm`.  Missing this variable causes the
  server to throw an error at startup【101048639847225†L6-L14】. | none –
  **required** | `backend/middleware/auth/encryption.js` |
| `ENCRYPTION_SECRET_OLD` | Optional secondary hex key used for key
  rotation.  When provided it allows the server to decrypt data encrypted
  with the old key while encrypting new data with the primary key【101048639847225†L6-L21】. | `null` | `backend/middleware/auth/encryption.js` |

### In‑memory private key loading

For swap execution the bot must sign transactions.  The helper
`backend/utils/swap.js` loads the base58‑encoded private key from
`process.env.PRIVATE_KEY` and converts it to a Keypair【107868020100458†L35-L41】.
If this variable is missing or invalid the module throws an error.  The
private key is never written back to disk.  When running strategies in
parallel across multiple wallets a similar mechanism loads additional
keys (`PRIVATE_KEY2`, etc.).

### Operational guidance

* Generate your **passphrase** offline and keep it secret.
* Store your **encrypted private key blob** (the envelope) in the database or
  your password manager – never store raw keys in `.env`.
* Use `arm()` to load the DEK into memory only when you intend to trade.  The
  session will expire automatically based on the configured TTL.  Disarm the
  wallet after trading or when stepping away from the machine.
* Rotate the encryption secret periodically by setting `ENCRYPTION_SECRET_OLD`
  to the previous key and updating `ENCRYPTION_SECRET` with the new one.  Run
  a migration script to re‑encrypt existing data, then remove the old secret.

### TODO

The current mirror does not include the endpoint to arm/disarm wallets nor the
frontend flow prompting for the passphrase.  Those handlers should be
documented in future work.