# Telegram Bot

The trading bot includes an optional Telegram interface that allows users to execute trades, view positions and adjust settings via simple chat commands.  This document covers setup, core commands and access control.  All commands operate against the same backend used by automated strategies.

## Setup

1. **Enable Telegram** – Set the environment variable `START_TELEGRAM=true` in your `.env` file.  If this variable is not exactly `"true"` the bot startup code returns early.
2. **Provide a bot token** – Create a Telegram bot via BotFather and set `TELEGRAM_BOT_TOKEN` to the token string.
3. **Start the bot** – Run the entry point:

   ```sh
   node backend/telegram/index.js
   ```

   The bot uses long polling (`node-telegram-bot-api` default).  Deploy it as a separate process or container to isolate it from the trading hot path.
4. **Authorize users** – Implement or adjust the `isAuthorized` helper in `telegram/utils/auth.js` to define which chat IDs or usernames are allowed to use the bot.  Unauthorized attempts return a rejection message.

## Core Commands

Commands are matched via regular expressions defined in `telegram/index.js` and dispatched to handlers in `telegram/commandHandlers`.  Below is a non‑exhaustive list of supported commands and their behaviours.

| Command | Description | Notes |
|---|---|---|
| `/start` | Enables alerts for the chat and shows the main menu.  Initializes user preferences and logs access. | Requires authorization. |
| `/menu` | Re‑sends the interactive menu. | Same as `/start` but without enabling alerts. |
| `/stop` | Ends the current bot session and instructs the user to type `/start` again. | Clears in‑memory session state. |
| `/shutdown` | Shuts down the Node.js process (developer/debug only). | Protected by authorization; use with care. |
| `/buy <TOKEN> <AMOUNT>` | Performs a market buy of `<AMOUNT>` SOL of the specified token (mint or symbol).  If the user only types `/buy`, a multi‑step flow asks for the token and amount. |
| `/sell <TOKEN> <AMOUNT>` | Sells a position by amount or percentage.  If no amount is provided the bot enters an interactive flow to collect the percentage. |
| `/snipe <MINT>` | Triggers the Turbo Sniper manually with the given mint address.  Additional parameters can be passed in the match. |
| `/tpsl` | Manages take‑profit/stop‑loss orders.  Additional sub‑commands such as `/tpsl_delete` and `/tpsl_edit` remove or edit TP/SL settings. |
| `/wallet` | Shows a summary of wallets loaded via the wallet manager. |
| `/positions` | Displays open positions for the user. |
| `/safety` | Shows safety scores or risk heuristics for a token.  If invoked without arguments enters a flow to ask for a token. |
| `/trades` | Lists recent trades. |
| `/watchlist [MINT]` | Adds or removes a token from the watchlist if a mint is provided; otherwise shows the current watchlist. |
| `/unhide` | Restores all hidden tokens in `/positions`. |
| `/reset` | Clears the session state for the chat. |
| `/forget` | Clears recent mint history. |
| `/autorefresh` | Toggles automatic refresh of positions every 60 seconds. |

### Interactive Flows

Some commands require multi‑step input.  The bot stores a session state in memory keyed by chat ID to track the current step and command.  For example:

* If the user types `/buy` without arguments, the bot prompts for the token mint, then asks for the amount, then executes the trade.
* For `/sell` without an amount, the bot asks for the percentage to sell.
* DCA creation flows prompt for the token, frequency and amount in separate messages.

### Alerts and Preferences

Alerts (buys, sells, DCAs, limits, TP/SL) are enabled per chat when the user runs `/start`.  Preferences such as auto‑buy can be stored via the `userPrefs` service.  Commands modify these preferences accordingly.  To disable all alerts for a chat, call `/stop` or set `enabled: false` via `setTelegramPrefs`.

## Access Control & Rate Limits

Authorization is enforced by `isAuthorized(chatId)` in `telegram/utils/auth`.  Unauthorized users receive an error message and the command handler returns early.  Implement your own logic (e.g. allow‑list of chat IDs or usernames) to secure the bot.

The bot does not implement explicit per‑user rate limits, but heavy usage may trigger Telegram API throttling.  Avoid spamming trade commands, especially when using turbo mode.

## Running in Production

* Keep your `TELEGRAM_BOT_TOKEN` secret and never commit it to version control.
* Deploy the Telegram bot as a separate process or container; isolate it from automated strategies to avoid blocking the trading hot path.
* Regularly back up your `tp-sl-settings.json` and other local files used by the Telegram services.

## Next Steps

* Enable Telegram and define your allowed users in `.env` (`START_TELEGRAM`, `TELEGRAM_BOT_TOKEN`) and in `telegram/utils/auth`.
* See [`docs/strategies/turbo.md`](strategies/turbo.md) for details on the Turbo Sniper triggered via `/snipe`.
* Configure authentication and 2FA following [`docs/AUTH.md`](AUTH.md).
