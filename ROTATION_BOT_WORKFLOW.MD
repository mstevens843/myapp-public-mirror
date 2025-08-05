This updated version:

At startup:

Loads your configured token list per wallet (cfg.wallets[].tokens).

Stores this list in memory (labelToTokens) and uses it for that wallet’s entire session.

Does not rely on the wallet’s current balances to determine which tokens to consider.

Every interval:

Queries momentum for all tokens in that wallet’s configured list — even if you don’t currently hold them.

Ranks those tokens and determines which is strongest.

Compares strongest vs your current holding.

If you already hold strongest → no trade.

If not → swap positionSize SOL into strongest.

If SOL drops below safe minimum → halts bot.

🔄 Does it keep the list and keep checking it each interval?
✅ Yes.

The list of configured tokens is kept in memory and reused every tick.

Each tick queries their latest price momentum & ranks them.

🚦 Does it rotate into one token?
✅ Yes — at each interval:

Chooses the strongest-performing token from your configured list.

If not already holding that token, it swaps into it.

Otherwise stays put.

📝 Summary:
Keeps your configured token list (per wallet) as the “universe” to operate in.

Continuously monitors all tokens in the list at each tick.

Decides whether to rotate based on current holding vs strongest.

Stops if SOL is too low.

Only deals with tokens explicitly configured.

So yes — this is now properly designed for what you described.

If you like, I can also draft a short README snippet or diagram showing the workflow of this version — just say the word. 🚀







You said:
yes please 


ChatGPT said:
✅ Here’s a clear README snippet + diagram describing the updated rotationBot workflow:

📄 RotationBot v2 – Workflow
The RotationBot keeps your capital rotated into the strongest-performing token out of a pre‑defined list, per wallet.

🧭 How It Works
✅ At Startup:

Loads your config:

Wallet labels (wallet1, wallet2, …)

Per-wallet list of tokens to monitor (e.g., [SOL, POPCAT]).

Initializes each wallet & stores its token list in memory.

✅ At Each Interval:

Selects current wallet.

Looks up its configured token list.

For each token:

Gets latest momentum (% change over 5m/24h).

Skips tokens below minMomentum.

Ranks tokens in descending momentum.

Compares strongest token vs what wallet currently holds.

If already holding strongest → do nothing.

If not → swaps positionSize SOL into strongest token.

Checks SOL balance:

If below minimum → halts bot.

Moves to next wallet.

✅ Halt conditions:

Too many errors.

Insufficient SOL.

🔄 Rotation Logic
Tick	Action
✅	Query momentum for all configured tokens
🔍	Rank tokens
🤔	Compare strongest vs current holding
🔁	Rotate into strongest if different
💤	Otherwise do nothing

🚦 Example
Config:
json
Copy
Edit
{
  "rotationInterval": 900000,
  "positionSize": 0.02,
  "wallets": [
    { "label": "wallet1", "tokens": ["SOL", "USDC"] },
    { "label": "wallet2", "tokens": ["SOL", "CHILLGUY"] },
    { "label": "wallet3", "tokens": ["SOL", "POPCAT", "CHILLGUY"] }
  ]
}
Run:
arduino
Copy
Edit
node rotationBot.js config.json
Wallet 1: Rotates between SOL & USDC.

Wallet 2: Rotates between SOL & Chillguy.

Wallet 3: Rotates between SOL, Chillguy, & Popcat.

🔷 Workflow Diagram
plaintext
Copy
Edit
   ┌──────────────┐
   │ Startup:     │
   │ Load wallets │
   │ + token lists│
   └──────┬───────┘
          │
          ▼
   ┌─────────────────────┐
   │ Every Interval:      │
   │ 1. Rank tokens       │
   │ 2. Compare strongest │
   │ 3. Rotate if needed  │
   │ 4. Next wallet       │
   └────────┬─────────────┘
            │
            ▼
      (repeat until halted)