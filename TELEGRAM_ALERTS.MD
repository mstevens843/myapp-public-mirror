# 📡 Telegram Alerts Integration - Solana Trading Bot

## 🧠 Purpose

This Telegram integration adds **real-time alerts** to your trading bot so users can receive critical updates about **trades**, **safety checks**, and **bot activity** — all from their phone via Telegram. It's designed to provide **peace of mind**, especially when running the bot in **auto-mode**.

---

## 🔧 Features

- ✅ **Enter Telegram Chat ID** and connect instantly
- ✅ **Test Alert** to verify the integration
- ✅ **Trade Notifications** — get pinged when a buy/sell is executed
- ✅ **Safety Alerts** — get alerted if a token fails safety checks
- ✅ **Preference toggles** for Trade vs Safety alerts
- ✅ **Disconnect** anytime
- ✅ Local feedback: visual "✅ Preferences saved" badge

---

## 🚨 Real Use Cases

### 1. 📈 Real-Time Trade Feedback
> *"Bot just bought $TOKEN at 0.3 SOL"*  
> *"Sold $TOKEN with +45% PnL"*

You get alerted when a trade is made — so you don’t have to babysit your dashboard.

---

### 2. 🛡️ Safety Check Alerts
> *"Blocked trade: TOKEN_X failed honeypot simulation"*  
> *"Liquidity too low for TOKEN_Y — trade skipped"*

Even when a trade **fails**, you know **why** — critical for diagnosing bot behavior.

---

### 3. 📱 Passive Monitoring (Auto Mode Friendly)
- Users can be **at the gym, asleep, or working**, and still stay informed.
- Enables **semi-autonomous bot management** without needing constant screen time.

---

### 4. 🔄 Expandable System (Planned)
Potential for:
- ⚠️ Error messages (Jupiter failure, RPC outage)
- 🔁 Bot restart alerts
- 📊 Trade performance summaries (daily)

---

## 💡 Why This Matters

| Value                        | Why It Matters                                          |
|-----------------------------|----------------------------------------------------------|
| ✅ Real-time feedback        | No need to check console logs or trade history manually |
| 🛡️ Safety alerts             | Protects capital — stay aware of failed trade reasons   |
| 📱 Mobile passive monitoring | You stay informed 24/7 without babysitting the app     |
| 🔄 Expandable logging        | Future-proof system for critical error and status info  |

---

## 📌 Example

- ✅ *Connected to Telegram*
- 📩 *Trade Executed: Bought $TOKEN*
- ❗ *Blocked: Safety check failed for $TOKEN*
- 💤 You sleep. Bot works. You still get the full story.

---

## 🧪 Setup Requirements

- Add your bot token + chat ID to `.env`
- Enable via **Telegram Alerts** tab in the dashboard
- Toggle on/off **Trade** or **Safety** alerts as desired

---

Built for full autonomy and peace of mind.
