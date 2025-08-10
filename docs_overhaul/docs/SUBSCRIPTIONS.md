# Subscriptions & Entitlements

This document explains how the project manages user subscriptions, entitlements and rate limiting.  These features restrict access to strategies, API endpoints and Telegram commands based on the user’s plan.  **Note:** The public mirror does not include payment integration; the following is a conceptual reference.

## Plans

You may define multiple subscription tiers to monetise the bot.  A typical setup includes:

| Plan | Entitlements |
|---|---|
| **Free** | Access to manual trading via the dashboard and Telegram.  Limited to one strategy and a low daily trade cap.  Limited metrics access. |
| **Pro** | All Free features plus access to multiple strategies, advanced dashboards (TP/SL, DCA, limit orders), higher trade caps, and priority support. |
| **Enterprise** | Unlimited strategies, custom risk profiles, dedicated private RPC and Jito relay endpoints, and bespoke support. |

Entitlements are enforced by middleware in the API and Telegram layers.  For example, users on the Free plan may not invoke the Turbo Sniper or call `/snipe` in Telegram.  When a user exceeds their limit the API returns `429 Too Many Requests` and provides guidance on upgrading.

## Billing & Payment

The repository does not include a payment provider.  In production you would integrate a service like [Stripe](https://stripe.com/) or [Paddle](https://paddle.com/) to handle billing.  Store the subscription ID and status in your database and synchronise entitlements on webhook events (e.g. subscription created, payment failed).  Ensure webhook secrets are stored securely in your `.env` file and documented in `CONFIG_REFERENCE.md`.

## Rate Limiting

To prevent abuse each subscription tier has associated rate limits.  The bot may enforce:

- **Daily trade cap:** Maximum number of trades per day per user.
- **Monthly volume cap:** Maximum notional volume traded per month.
- **API request rate:** Requests per minute to the REST API or Telegram commands.

These limits are configured in your environment or database and applied by middleware.  Exceeding a limit returns a `429` status.  Tune these values based on infrastructure capacity and business goals.

## Entitlement Checks

When a request arrives the API extracts the user’s subscription plan and compares it against the required entitlement for the endpoint.  For example, the Turbo Sniper requires the `turbo` entitlement; the `/metrics` endpoint may require a `metrics` entitlement.  If the user lacks the requisite entitlement the API returns `403 Forbidden`.

Entitlements can also be time‑bound (e.g. trial periods) or tied to specific wallets.  Store entitlement metadata in your database and update it on plan changes.

## Implementation Notes

- Use a feature flag such as `SUBSCRIPTIONS_ENABLED` to toggle subscription enforcement in non‑production environments.
- Create a `subscriptions` table with fields `userId`, `plan`, `status`, `expiresAt` and `entitlements` (JSON).  Update this table on billing webhooks.
- Add middleware in your Express server and Telegram bot to check entitlements before handling requests.
- Document all environment variables controlling subscriptions and rate limits in `docs/CONFIG_REFERENCE.md`.
- For Stripe integration, generate one webhook secret per environment and store it in `.env` as `STRIPE_WEBHOOK_SECRET` (placeholder).

## Next Steps & TODOs

* Flesh out a concrete plan list and pricing.  Decide which strategies belong to which plans.
* Implement a billing provider integration (e.g. Stripe) and handle subscription life‑cycle events.
* Define and document rate limit values.  Expose them in the API response headers for transparency.
* Provide an admin dashboard for managing users and subscriptions.
* Add tests in `tests/subscriptions.test.js` to verify entitlement enforcement.