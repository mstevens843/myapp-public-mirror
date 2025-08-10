# Telegram Bot

The trading bot includes an optional Telegram interface that allows users to
execute trades, view positions and adjust settings via simple chat commands.
This document covers setup, core commands and access control.  All commands
operate against the same backend used by automated strategies.

## Setup

1. **Enable Telegram:** Set the environment variable `START_TELEGRAM=true` in
   your `.env` file.  If this variable is not exactly `"true"` the bot
   startup code returns early【673739940498900†L0-L4】.
2. **Provide a bot token:** Create a Telegram bot via BotFather and set
   `TELEGRAM_BOT_TOKEN` to the token string【673739940498900†L46-L47】.
3. **Start the bot:** Run the entry point:

   ```sh
   node backend/telegram/index.js
   ```

   The bot uses long polling (the default for `node-telegram-bot-api`).

4. **Authorize users:** Implement or adjust the `isAuthorized` helper to define
   which chat IDs or usernames are allowed to use the bot.  Unauthorized
   attempts return a "You're not authorized" message【673739940498900†L67-L79】.

## Core Commands

Below is a non‑exhaustive list of supported commands and their behaviours.
Commands are matched via regular expressions defined in `telegram/index.js` and
dispatch to corresponding handlers in `telegram/commandHandlers`.

| Command | Description | Notes |
|---|---|---|
| `/start` | Enables alerts for the chat and shows the main menu.  Initializes user preferences and logs access【673739940498900†L82-L93】. | Requires authorization. |
| `/menu` | Re‑sends the interactive menu. | Same as `/start` but without enabling alerts【673739940498900†L96-L99】. |
| `/stop` | Ends the current bot session and instructs the user to type `/start` again【673739940498900†L101-L112】. | Clears in‑memory session state. |
| `/shutdown` | Shuts down the Node.js process (developer/debug only)【673739940498900†L116-L123】. | Protected by authorization; use with care. |
| `/buy <TOKEN> <AMOUNT>` | Performs a market buy of `<AMOUNT>` SOL of the specified token (mint or symbol)【673739940498900†L125-L135】.  If the user only types `/buy`, a multi‑step flow asks for the token and amount. |
| `/sell <TOKEN> <AMOUNT>` | Sells a position by amount or percentage【673739940498900†L149-L154】.  If no amount is provided the bot enters an interactive flow to collect the percentage. |
| `/snipe <MINT>` | Triggers the Turbo Sniper manually with the given mint address【673739940498900†L143-L147】.  Additional parameters can be passed in the match. |
| `/tpsl` | Manages take‑profit/stop‑loss orders【673739940498900†L162-L165】.  Additional sub‑commands such as `/tpsl_delete` and `/tpsl_edit` remove or edit TP/SL settings【673739940498900†L228-L234】. |
| `/wallet` | Shows summary of wallets loaded via the wallet manager【673739940498900†L167-L172】. |
| `/positions` | Displays open positions for the user【673739940498900†L174-L177】. |
| `/safety` | Shows safety scores or risk heuristics for a token.  If invoked without arguments enters a flow to ask for a token【673739940498900†L179-L182】. |
| `/trades` | Lists recent trades【673739940498900†L184-L187】. |
| `/watchlist [MINT]` | Adds or removes a token from the watchlist if a mint is provided; otherwise shows the current watchlist【673739940498900†L189-L193】. |
| `/unhide` | Restores all hidden tokens in `/positions`【673739940498900†L195-L213】. |
| `/reset` | Clears the session state for the chat【673739940498900†L216-L223】. |
| `/forget` | Clears recent mint history【673739940498900†L236-L244】. |
| `/autorefresh` | Toggles automatic refresh of positions every 60 seconds【673739940498900†L254-L259】. |

### Interactive Flows

Some commands require multi‑step input.  The bot stores a session state in
memory keyed by chat ID to track the current step and command.  For example:

- If the user types `/buy` without arguments, the bot enters a session where it
  first prompts for the token mint, then asks for the amount, then executes
  the trade【673739940498900†L289-L317】.
- For `/sell` without an amount, the bot enters an `awaitingSellPercent` step
  and asks for the percentage to sell【673739940498900†L274-L287】.
- DCA creation flows prompt for the token, frequency and amount in separate
  messages【673739940498900†L335-L345】.

### Alerts and Preferences

Alerts (buys, sells, DCAs, limits, TP/SL) are enabled per chat when the user
runs `/start`.  Preferences such as auto‑buy can be stored via the
`userPrefs` service.  Commands modify these preferences accordingly.  To
disable all alerts for a chat, call `/stop` or set `enabled: false` via
`setTelegramPrefs`.

## Access Control & Rate Limits

Authorization is enforced by `isAuthorized(chatId)` in `telegram/utils/auth`.
Unauthorized users receive an error message and the command handler returns
early【673739940498900†L67-L79】.  Implement your own logic (e.g. allow‑list of
chat IDs or usernames) to secure the bot.

The bot does not implement explicit per‑user rate limits, but heavy usage may
trigger Telegram API throttling.  It is advisable to avoid spamming trade
commands, especially when using the Turbo Sniper.

## Running in Production

* Keep your `TELEGRAM_BOT_TOKEN` secret and never commit it to version control.
* Deploy the Telegram bot as a separate process or container; isolate it from
  automated strategies to avoid blocking the trading hot path.
* Regularly back up your `tp-sl-settings.json` and other local files used by
  the Telegram services.