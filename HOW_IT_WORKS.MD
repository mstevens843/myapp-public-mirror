The Solana Trading Bot platform is a full statck system built to automate and manage on-chain trading strategies with real-time visibility 
The backend is powered by Node.js and Express, handling both a REST API and a WebSocket server. 
It suppoets two main entry points: running strategies directly via CLI or managing them through a server-based dashboard. 
Strategies are modular, house under a central controller that dynamically loads the correct logic based on user input. 

Core utilities handle token monitoring, quote fetching, transaction execution, and wallet rotation. A secondary layer of service utilities 
supports logging, trade tracking, recap generation, and Telegram alerts for real-time feedback. 


Configurations are passed via CLI or dashboard and injected into the runtime environment, allowing strategies to remain stateless and swappable.
Trade results are stored in memory or flat files. with support for live export and daily performance recaps. The WebSocket layer broadcasts backend
logs directly to the frontend, allowing users to monitor the bot's internal behavior in real time. 

On the frontend a Vite + React dashboard enables users to configure strategy parameters, toggle between strategies, start/stop the bot, and view
visualized metrics. Components include real-time log viewers, live-updating charts for portfolio performance and trade output, a trade history table, 
and a recap panel summarizing daily PnL and performance. The UI persists confoig preferences via localStorage and offers CSV export, log reset, and 
strategy filtering tools. 

Together, This architecture allows the system to run either headlessly (via CLI) or interactively (via Dashboard). making it suitable for both production
bots and development experimentation. The platform is fully modular and designed to scale, new strategies, metrics, or integrations can be added without 
disrupting the core flow. 

## Additional File Structure Additions:
/backend
  ├── routes/
  │   ├── trades.js           New API for trade logs (merged from all bots)
  │   └── status.js           (Optional) Bot running mode/status route
  ├── logs/                   Per-strategy trade history (sniper.json, etc.)
  └── utils/
      ├── logTrade.js         Appends structured logs to file per strategy
      └── analyticsLogger.js ← 🔜 For Phase 5 PnL summaries

/frontend
  ├── components/
  │   ├── TradeChart.jsx     ← ✅ New: line graph of outAmount over time
  │   ├── ConfigPanel.jsx    ← ✅ New: edit and persist strategy config
  │   └── LogsConsole.jsx    ← ✅ New: real-time log stream (WebSocket)







### COMPLETE OPERATIONAL BREAKDOWN

## 🧠 1. What triggers a buy?
- Sends a `POST /api/mode/start` with your selected strategy and config.
- The backend: 
  - Writes the config to a `.json` file in `runtime/`
  - Spawns a new Node.js process running `strategies/<mode>.js` 
  - That file loads the config and enters a `loop` (based on `interval`) 
  - It checks for: 
    - ✅ Safe token (via safety engine)
    - ✅ Enough volume + price movement (e.g. 1h price + volume thresholds)
    - ✅ Wallet balance is above min
  - if all pass: `getSwapQuote()` -> `executeSwap()` -> logs trade. 


## ⏳ 2. How long is the buy window?
  - The `window is ongoing`. Each tick (every `interval` ms), the bot checks conditions. 
  - A token must meet `all entry filters` (e.g. price % change, volume, safety). 
  - If a match is found during a tick -> it buys immediately. 
  - Only `one trade per tick` is allowed (e.g. `break;` after trade). 


## 💸 3. Does it auto-sell?
- `No,` by default strategies like `sniper`, `scalper`, etc. `do not auto-sell`. 
- You can manually sell via the OpenTrades tab using onSell() handlers.
- Exception: `chadMode` has optional `autoSell` logic built in (configurable delay + dump) 
- `Stop does NOT sell your open positions`. It just halts the loop. 



## ⚖️ 4. Stop button behavior
- clicking `Stop:` 
  - Sends `POST /api/mpde/stop`
  - Kills the running child process.
  - `It does NOT sell` any positions. You must: 
    - Use Open Trades tab (handleSellTrade)
    - or call backend sell endpoint. 
    - Or manually sell with `manualExecutor.js`


## 📂 5. Can I have multiple positions open?
- ✅ Yes, depending on your strategy:
  - `scalper` and `rotationBot` support `multiple open trades`
  - Controlled via config: `maxOpenTrades`
- It stores open positions in memory of `open-trades.json (backend)



## 🧮 6. If I put 1 SOL, does it buy 1 token or multiple?
  - Depends on `strategy` + `positionSize` or `snipeAmount`: 
    - `sniper`: buys 1 token per tick, using `snipeAmount`: 
    - `rotationBot`: allocates based on `positionSize` and rotates. 
    - `scalper`: one token per tick, can repeat until `maxOpenTrades` or `dailyVolume` is hit. 
  - If you configure `snipeAmount: 0.1` and ahve `maxDailyVolume: 1`, it'll do 10 snipes max. 



## 📈 7. How does it decide which token to buy?
Each Strategy has specific filters tokens go through 


## 🧪 8. If 20+ tokens qualify, how does it choose which to buy?
- First one that passes `all checks during that tick`
- It only buys 1 per tick (`break` after first match) 
You can adjust:
  - `interval` (time between ticks) 
  - `maxOpenTrades`
  - `monitoredTokens` list to narrow it down 


## ♾️ 9. Does it just keep going forever until I stop it?
- Yes, unless 
  - `haltOn Failures` triggers (e.g. 3-5 failed swaps) 
  - Wallet balance is too low. 
  - Daily volume limit hit. 
  - Bot crashes 
  - You press `Stop`




## 💥 10. What if bot crashes mid-trade?
If you enabled ✅ Auto-Restart, the backend:
  - Wait 3 secs -> restarts bot with same config. 
If not: 
  - Bot halts
  - You can manually re-start -> it picks up fresh logic. 
  - `It won't resume old open trades`. You'll see them in open trades tab but must sell manually. 


## 🔄 11. Is the whole process automated?
- ✅ `Buy side = automated`
- ❌ `Sell side = manual unless in ChadMode (auto-sell)` or you code it
- ✅ Strategy switching, token scanning, filtering, honeypot protection, logging = all automated
- ⚙️ Manual sell = via dashboard or backend call


## 🔐 Bonus: Safety Before Every Trade
Before buying any token:
`isSafeToBuy()` runs:
  - 9-layer check (honeypot, blacklist, liquidity, ownership, freeze authority, top holders, etc.)​
This is enforced in `every`strategy before executeSwap().













#### Heartbeat of entire Bot system: THE TICK ########################################################

## Tick 
**A Tick**: is a single loop cycle of the bot's strategy logic. 
It's like a `pulse` where the bot does this: 
  - 1. Scans the market. 
  - 2. Checks for qualifying tokens. 
  - 3. If one qualifies -> attempts to buy.
  - 4. Then `waits for the next tick` (based on your confugured interval) 







## 🧠 Example: What happens during 1 tick?
Let’s say `interval = 30000` (30 seconds):

Every 30 seconds, the bot will:
```js
setInterval(async () => {
   // 1. Get list of tokens (filtered or full)
   // 2. Check: price change, volume, honeypot, wallet balance
   // 3. If passes all checks:
   //    🔁 Buy 1 token, log, alert, etc.
   // 4. Then wait 30s until next tick
}, interval);
```

`Only 1 token gets through per tick unless the strategy explicitly supports multi-buy per tick.`


## 📍 How long is a tick?
**That depends on your interval in config**:

```json
{
  "interval": 3 // means 1 tick = 30 seconds
}
```





## 🚀 Does sniper buy on first tick?
`Yes`, but only if conditions are met. 
When you click `Start`, here's what happens:
  - First tick begins immediately (no delay). 
  - It: 
    - Scans tokens
    - Looks for monitored ones 
    - Applies filters (price pump, volume, safety) 
  
  - If `no match` -> does nothing. 
  - Waits for the next tick. 

So yes, `Sniper buys on the first tick where a token passes all filters`. 





## 🔁 Do some strategies buy multiple tokens in one tick? 

- ❌ Most don’t. Nearly all current strategies only allow 1 trade per tick:
  - `sniper`, `scalper`, `breakout`, etc. all `break;` after first buy. 
- ✅ RotationBot can rotate and enter multiple trades over multiple ticks, based on config like:
  - `maxOpenTrades`
  - `cooldown`
  - Wallet rotation logic 


### ⚙️ Summary of the `Tick` Mechanism
- Heres' how `tick-based automation` works at a high level: 


## Bot 
**Lifecycle Step**:    	 **What Happens**:
⏯ Start Triggered	       `POST /api/mode/start` → spawns strategy with config
⏱ Tick Begins	           Strategy loop runs based on `interval` (`setInterval`)
🔍 Token Checks	         Applies filters: price, volume, honeypot, wallet, etc.
✅ Match Found	          Buys 1 token (only one per tick unless otherwise coded)
🧾 Log + Alert	         Records trade, sends Telegram/WS alerts
💤 Waits for Next Tick	 Sleeps until next loop
⛔ Stop Triggered	      `POST /api/mode/stop` → halts loop/child process





WHat mode uses more than one tick? you said wait til next tick? if i put 1 in sniper doesnt it spend it all in one tick? 

What are all the token checks each token has to go through? and where does it being to start searching. Is is 
because the list of solana tokens is vast. Does it stat searching from new tokens dropped ? and start therer? or hwere? 

and so interval is basically the same thing is a tick? if i set interval for 30000, that means the tick is 30000ms? 

Most strategis use the full amo8int in one tick? so if i out 1 sol in it uses it on first tick where perarmetes met? 
so if the bot spends all the sol, then what do the ticks do. are they still onhgoing? or paused? 

what do you mean sleeps until nmext loop. like if ms is 30 secondas? and it buys in 10 seconds, it sleeps until 30 seconds is up and repeats? 










### Where does Bot start searching in the token list? 
- ✅ It uses fetchTokenList() (Jupiter Aggregator feed) — live tokens.

- There is `no timestamp sorting` - it doesn't say `start with newest token ever created`
- Instead, it comaprex against a `Set` of `seen` tokens 
  - if it's a `token not seen yet`, it runs safety/price/volume checks
  - If it passes -> it becomes a candidate to snipe 


🧠 So it’s not like a scroll from newest to oldest. It’s:
- 🔁 Grab current token list from Jupiter
- 🧠 Filter out already sniped tokens (seen)
- 🔬 Run filters (entry threshold, volume, safety)
- ✅ First one that passes → bot buys it




## 🔁 3. If a token meets parameters but buy fails, does it retry?
**❌ By default: No, it moves on.**

- The bots `adds it to the "seen" set` as soon as it passes filters, before the trade. 
- If `executeSwap()` fails:
  - It logs failure
  - Increments failureCount
  - But that token is already marked as seen 
  - So it won;t retryt unless: 
    - You `restart the bot`
    - Or manually clear the `seen` cache in memory (currently not exposed)

  
🧪 You can change this behavior by modifying sniper.js to only add to seen after a successful trade. If need be. 



## 🧠 TL;DR Recap
**You Set...*	                   **Bot Behavior**
Amount = 1, maxTrades = 4	       Spends `1 SOL per trade` × up to `4 = 4 SOL` total
Wallet only has 1 SOL	           Only 1 trade possible; other ticks will fail/skip
Want to split 1 SOL in 4 buys	   Set `Amount = 0.25` and `maxTrades = 4`
### BOT WILL INEVETABLY RUN UNTIL IT USES THE FULL AMOUNT AND MAX TRADES, unless stopped. 

**Token Discovery Logic**
- Pulls live token list from Jupiter
- Filters out seen tokens
- Runs safety + price + volume
- Buys first match per tick


**Failed Swap Behavior**
- Adds token to seen before swap
- If buy fails, it won’t retry
-


You want to modify retry logic? Add token prioritization? Or set it up to retry failed mints later in the session? Let’s go 👨‍🚀

Let me know if you want to:

⏳ Add configurable delays before first tick

🔁 Allow multi-trade per tick for specific strategies

🧠 Build a flow diagram of the tick lifecycle

📊 Track how many ticks occurred per session

You're diving into the engine room of your bot now — and that’s when things get powerful 🔥





### ElITE CONTROL OPERATOR PANEL (EVERYTHING THAT MATTERS)

### 🧠 1. Tick (Loop Interval) – the Heartbeat
- Defines how often the bot checks for trades
- One tick = one scan = one possible trade
- Controlled by interval (ms)


### 🔁 2. Seen Tokens Set – the Memory
Prevents buying the same token twice
Once a token is “seen” (even on fail), it’s skipped in future ticks
Resets only when:
You restart the bot
You modify logic to purge/refresh it
✅ Pro Tip: You can modify this to allow re-sniping or delayed retries.



### 📦 3. snipeAmount (or positionSize) – the Payload
- Controls how much SOL per trade
- Not divided by maxTrades — each trade uses this amount
- If snipeAmount = 1, each trade costs 1 SOL


### 🛑 4. maxTrades – the Limit
- Caps how many successful trades the bot can do per session
- Not a target — just a ceiling
- You can set to very high (or infinite) to let it go wild


### 🛡️ 5. Safety Filters – the Gatekeeper
Before any trade can happen, token must pass:

**Check**: |            **Why it matters**
Honeypot trap |         Prevents stuck tokens
Liquidity health |       Avoids low-liq slippage traps
Ownership renounced |   Avoids rug risk
Freeze/mint control |   Detects centralized scams
Whale distribution |    Avoids tokens owned 90% by 1 wallet
Contract verified |     Only buys public + verifiable tokens

These run every tick — they’re `non-negotiable` if isSafeToBuy is enabled​



 ### 6. Daily Volume Cap – the Governor
- Configurable as maxDailyVolume
- Caps total SOL spent per day
- Bot will skip trades once this is reached, even if other filters pass

✅ This is useful if you want to throttle risk without limiting trade count.



### 🔁 7. Wallet Rotation – the Multi-Wallet Brain
If using rotation-capable strategies (rotationBot, etc.):
  - Each tick can rotate to a different wallet
  - Balances are checked individually
  - Prevents one wallet from draining fully

✅ Can be extended to use wallets based on safety rating, wallet health, or usage history.



 ### 8. Failure Count & Auto-Halt – the Emergency Brake
  - Tracks how many failed swaps happened in a row
  - If failures ≥ haltOnFailures, bot pauses
  - Prevents burn on faulty tokens or unstable network


 ### 💥 THE CORE MECHANICS HIERARCHY ####
```pgsql
[TICK]
  └── Scan Tokens
        └── Filter Unseen
              └── Safety Check
                    └── Quote Check
                          └── Wallet Balance
                                └── Execute Trade (if all pass)
                                      └── Log Trade + Mark as Seen
``` 




### ✅ 1. How does rotationBot work?
**Think of rotationBot as a meta-strategy:**
**It runs like a Sniper, Scalper, or Breakout — but rotates wallets between ticks.**

✅ Core behaviors:
- Uses loadWalletsFromLabels() to load multiple wallets.

**On each tick:**
- Rotates to a new wallet (rotateWallet() from walletManager.js)
- Runs standard token checks (price, volume, safety)
- Executes 1 trade with the current wallet.
- It can behave like a sniper or scalper, depending on which detection logic you wrap it with. **Right now, it likely mimics sniper-style detection.**

Let me know if you want it to switch strategy logic per tick — that's possible







###  2. Are we using a DB at all?
**🟥 Not currently.**

**You have:**
- Empty /models folder
- No Sequelize logic called

**All data is:**
- Stored in-memory
- Logged to flat .json files (like open-trades.json, manual-trades.json, trades.json)

✅ This works fine for bots.
💡 If you want historical data, search, analytics, or persistent tracking across restarts → then DB is helpful. But it’s optional.






### ✅ 3. How does safety check work?
You’re using the isSafeToBuyDetailed(mint) function from safetyChecks.js​
.

It performs 9 major checks, grouped like this:

**Category**	      **Sub-Checks**	**Source**
🟢 Honeypot	        Simulated swap via Jupiter	Internal
🟢 Liquidity	      Birdeye liquidity + sketch name filter	Birdeye API
🛡 Ownership	      Mint renounced, freeze authority	Pump.fun API + Solana RPC
🛡 Blacklist	      Blacklist flag, dev-owned	Pump.fun
🔍 Verification	    Contract verified & audit clean	SolanaFM
🚦 Trading Open	    Trading enabled	Pump.fun
🧊 Freeze/Mint Ctrl	Mint & freeze authority removed	Solana RPC
🐋 Top Holder Risk	Dominance by one wallet (mocked now)	Future: Birdeye/Solscan

Each check sets a flag like:

```js
breakdown.liquidity = true;
breakdown.blacklist = false;
```

You see this per-token breakdown reflected in the Watchlist UI, e.g.:
- ✅ Liquidity Healthy
- ❌ Owner Not Renounced
- ✅ Verified Contract

That’s how your Watchlist UI knows which ones to greenlight or block.
The color badges directly reflect `breakdown` from `isSafeToBuyDetailed`.





### ✅ 4. Can we input a specific token for each strategy?
  ✅ Yes.

You can set a `targetToken` (like `JUPyex...rz7G`), and this gets passed via `monitoredTokens` in the config object.

When `targetToken` is set:
- `monitoredTokens` = [targetToken]
- Strategy will only evaluate that one token every tick.





### ✅ 5. If we have a Watchlist, does the bot filter through those first?
- ❌ Not yet — but we can add that easily.

***Current behavior***:
If `monitoredTokens` is set → bot only checks those

If `monitoredTokens` is empty → bot fetches full token list from Jupiter

✅ To prioritize the Watchlist, you’d just load its tokens into `monitoredTokens` automatically on start.

Want me to add that logic?




### ✅ 6. Where does the bot start in the token list? Alphabetical? Random?
- 🚫 No sort order.
- 🚫 Not alphabetical.
- 🚫 Not time-based.

Here’s exactly what happens:

1. `fetchTokenList()` gets a raw array of tokens from Jupiter
2. It filters out any tokens in `seen`
3. Then it loops in whatever order Jupiter gave them

So:
- 🧠 It's essentially "first token in the array that passes the filters."
- No smart ordering yet.

If you want:
- Sort by liquidity
- Sort by volume
- Shuffle to avoid bot patterns
…we can add any of that.





### Can I use multiple modes or use auto / manual mode at the same time ?
**YES**: You can use the bot automatically in one mode (e.g. auto-scaling) while manually sniping tokens at the same time. 

**BUT**: It depends `how your runtime is set up and where you're calling execution from.`

**✅ 1. Auto Strategy Mode (e.g. Scalper, Sniper, etc.)**
When you click `start` on the dashboard
  - It launches a Node.js child process: 
    ```js
    spawn("node", [`services/strategies/${mode}.js`, configPath])
    ```
  - That child process handles `its own loop` (tick-based) and wallet. 
  - It's completely isolated from `manual actions` unless they share the same wallet + SOL. 

**✅ 2. Manual Snipe (via Manual Trade Controls)**: 
When you click:
Buy 0.1 🟢  Buy 0.25 🟢  Buy 0.5 🟢  Buy 1 🟢

In `Manual Trade Controls`, it: 
  - Calls `performManualBuy()` from `manualExecutor.js`
  - Grabs current price
  - Executes `executeSwap()`
  - Logs to `manual-trades.json` and `open-trades.json`

### MANUAL BUYS DO NOT INTERFERE WITH THE AUTO-BOT -- UNLESS: 
  - You use the `same wallet`, and both tryt to spend SOL at the same time. 
  - You snipe a toen that's already being targeted by the aut-strategy. 

✅ So YES — you can:

Auto Bot Running	  Manually Snipe at the Same Time?	Caveats
✅ Sniper Mode	    ✅ Yes	                            Just don’t reuse same target
✅ Scalper Mode	  ✅ Yes	                            Use a different wallet if possible
✅ RotationBot	    ✅ Yes	                            Avoid sniping same wallet

