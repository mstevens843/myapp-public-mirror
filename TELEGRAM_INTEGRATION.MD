# 📲 Telegram Integration - Solana Trading Bot

This module enables full Telegram integration for the Solana trading bot dashboard. It allows real-time trade alerts, safety warnings, and configurable user preferences via Telegram messaging.

---

## 🔧 Features

- ✅ Connect your personal Telegram Chat ID to receive alerts
- ✅ Send test alerts to verify setup
- ✅ Toggle notification preferences (Trade alerts, Safety warnings)
- ✅ Persist chat ID and preferences on backend
- ✅ Uses Telegram Bot API to send messages securely

---

## 📁 File Structure

### 📦 Backend

#### `/routes/telegram.js`
| Route                          | Method | Description                                |
|--------------------------------|--------|--------------------------------------------|
| `/api/telegram/set-chat-id`    | POST   | Save/update Telegram Chat ID               |
| `/api/telegram/test`           | POST   | Sends a test message to current Chat ID    |
| `/api/telegram/chat-id`        | GET    | Fetch saved Chat ID                        |
| `/api/telegram/preferences`    | GET    | Fetch saved preferences                    |
| `/api/telegram/preferences`    | POST   | Update preferences (`{ trade, safety }`)   |

#### `/telegram/bots.js`
- Sends actual Telegram messages using Axios and Bot API
- Uses `TELEGRAM_BOT_TOKEN` from `.env`
- Stores `chatId` in memory or reads from environment

### 🖥️ Frontend

#### `components/Tabs/TelegramTab.jsx`
- Chat ID input
- Connect + Test buttons
- Checkboxes for:
  - ✅ Trade Alerts
  - ❗ Safety Alerts

#### `utils/api/telegram.js`
Encapsulates frontend API calls:

```js
setTelegramChatId(chatId)
sendTelegramTest()
getTelegramChatId()
getTelegramPreferences()
setTelegramPreferences(prefs)
```

---

## 📦 .env Variables

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=optional_default_id
```

---

## 🧪 Testing Setup

1. Create a bot on [BotFather](https://t.me/BotFather)
2. Start a chat with the bot
3. Use a site like https://api.telegram.org/bot<your_token>/getUpdates to grab your `chat_id`
4. Add to `.env` or use the UI to set it
5. Hit "Test Alert" on the frontend

---

## 🧠 Future Improvements

- [ ] Store chat ID + prefs in persistent DB (SQLite, Postgres)
- [ ] Allow multiple users (bot-to-many model)
- [ ] Customize alert types or message templates
- [ ] Integrate `/start` Telegram bot command to sync ID automatically

---

## 🧵 Summary

This Telegram module makes your Solana bot more responsive, safer, and real-time. It’s lightweight, extendable, and built for developers who want hands-on control.

Built with ❤️ by [Mathew Stevens]
