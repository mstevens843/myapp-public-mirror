# Authentication & Authorization

This project exposes both API and bot‑driven workflows.  It does **not** rely on a traditional username/password database – instead it uses **web3 wallet signatures** to establish identity, short‑lived session tokens to maintain state and a simple role model enforced by middlewares.

## Sign‑In Flow

1. **Nonce challenge** – A client initiates login by requesting a challenge via `POST /auth/nonce`.  The server generates a random nonce, persists it along with the associated wallet address and returns it to the client.
2. **Wallet signature** – The client signs the nonce with the user’s private key using `window.solana.signMessage()` or any Solana signing API.  The signature, wallet public key and original nonce are sent to `POST /auth/login`.
3. **Verification** – The server verifies that the signature matches the public key and that the nonce is still valid.  If the check passes, a session cookie is issued.  The cookie contains a short‑lived JWT encoded with the user’s ID and role【38012518862774†L20-L27】.
4. **Session TTL** – Sessions are short (typically 15 minutes) and must be refreshed.  Clients should periodically call a `refresh` endpoint to obtain a new token before the old one expires.

## Session & Cookie Handling

The server stores the session token in an **HTTP‑only cookie**.  Cookies are configured with `SameSite=Lax` and marked `Secure` when running behind HTTPS.  Cross‑domain requests are rejected unless they originate from the configured frontend domain.  The session middleware attaches a `user` object to `req` on successful validation; downstream handlers should check `req.user.role` to enforce authorization【38012518862774†L29-L37】.

## Two‑Factor Authentication & Roles

The authentication middleware supports optional **two‑factor authentication (2FA)**.  The `check2FA` middleware reads the user’s 2FA settings from the database and compares a TOTP token with the stored secret【38012518862774†L40-L47】.  When enabled, users must supply a valid TOTP during login and when arming a wallet.

Roles are defined at account creation.  The backend expects at least two levels:

* **admin** – can deploy strategies, manage wallets and read metrics.
* **trader** – can execute trades but cannot manage other users.

Routes use simple checks like `if (req.user.role !== 'admin') return res.status(403)` to enforce role‑based access control【38012518862774†L49-L56】.

## CORS and CSRF

API routes enable CORS only for the frontend domain.  Pre‑flight requests are handled automatically via the middleware described in [`docs/CORS.md`](CORS.md).  Cross‑Site Request Forgery (CSRF) protection is provided by double submitting the session cookie and an `X-CSRF-Token` header.  The token is included in the login response and must be echoed by the client on every write request【38012518862774†L58-L64】.

## Error Responses

Authentication errors return HTTP 401 (`Unauthorized`) with a JSON body `{ "error": "Invalid signature" }`.  Authorization failures return HTTP 403 (`Forbidden`).  Invalid signatures or expired nonces produce the same generic 401 response to avoid leaking whether a user exists【38012518862774†L68-L71】.

## TODO

Some authentication functions (such as the endpoint that returns the nonce or performs the signature verification) are not visible in this mirror and are currently undocumented【38012518862774†L73-L78】.  Future iterations should locate those handlers and document their behaviour in this file.  Additional roles and permissions may be introduced as new features are added.

## Next Steps

* Set up two‑factor authentication by generating a TOTP secret and storing it in your user profile.  See `TWO_FA_ENABLED` and `TWO_FA_SECRET` in [`docs/CONFIG_REFERENCE.md`](CONFIG_REFERENCE.md).
* Review [`docs/SECURITY.md`](SECURITY.md) for threat models and controls.
* Configure CORS following [`docs/CORS.md`](CORS.md) to protect against cross‑origin abuse.
