## Authentication & Authorization

This project exposes both API and bot‑driven workflows.  It does **not** rely on a
traditional username/password database — instead it uses web3 wallet signing to
establish identity, short‑lived session tokens to maintain state and a simple
role model enforced by middlewares.

### Sign‑in flow

1. **Nonce challenge** – When a client initiates a login it requests a
   challenge from the server.  The server generates a random nonce and
   persists it along with the associated user record.  The nonce is then
   returned to the client.
2. **Wallet signature** – The client signs the nonce with the user’s
   private key via `window.solana.signMessage()` (for browser wallets) or
   any other Solana signing API.  The signature, wallet public key and the
   original nonce are sent back to the server.
3. **Verification** – The server verifies that the signature matches the
   provided public key and that the nonce is still valid.  If the check
   passes a session cookie is issued.  The cookie contains a short‑lived
   JWT encoded with the user’s ID and role.  All subsequent requests must
   include this cookie.
4. **Session TTL** – Sessions are short (typically 15 minutes) and must be
   refreshed.  Clients should periodically call a `refresh` endpoint to
   obtain a new token before the old one expires.

### Session & cookie handling

The server uses HTTP‑only cookies to store the session token.  Cookies are
configured with the `SameSite=Lax` attribute and marked `Secure` when running
behind HTTPS.  Cross‑domain requests are rejected unless they originate from
the configured frontend domain.  The session middleware attaches a `user` object
to `req` on successful validation; downstream handlers should check
`req.user.role` to enforce authorization.

### 2FA and user roles

The authentication middleware supports optional two‑factor authentication.  The
`check2FA` middleware reads the user’s 2FA settings from the database and
compares a TOTP token with the stored secret【306951265335037†L10-L54】.  If
enabled, users must supply a valid token during login and when arming a
protected wallet.

Roles are defined at account creation.  The backend expects at least two
levels:

* **admin** – can deploy strategies and manage wallets.
* **trader** – can execute trades but cannot manage other users.

Routes use simple checks like `if (req.user.role !== 'admin') return
res.status(403)` to enforce role‑based access control.

### CORS and CSRF

All API routes enable CORS only for the frontend domain.  Pre‑flight requests
are handled automatically.  CSRF protection is provided by double submitting
the session cookie and an `X-CSRF-Token` header.  The token is included in
the login response and must be echoed by the client on every write request.

### Error responses

Authentication errors return HTTP 401 with a JSON body `{ error: string }`.
Authorization failures return HTTP 403.  Invalid signatures or expired
nonces produce the same generic 401 response to avoid leaking whether a
user exists.

### TODO

Some authentication functions (such as the endpoint that returns the nonce or
performs the signature verification) are not visible in this mirror and are
currently undocumented.  Future iterations should locate those handlers and
document their behaviour under this file.