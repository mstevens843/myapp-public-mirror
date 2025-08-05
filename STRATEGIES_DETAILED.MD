# Advanced Strategy Breakdown - Solana Trading Bot 

The document contains **deep-dive explanation** of how each trading strategy works at the code level. 

-- 


## Rotation Bot 
**File**: `rotationBot.js`
**Purpose**: Roates capital across multiple tokens and wallets, reallocating to the strongest performing asset based on price and volume metrics. 

### How it works

1. **Token Discovery**: 
    - Aggregates tokens from a `sectors` object (grouped by theme/category). 
    - Flattens them into a unified list for scanning. 

2. **Candidate Filtering**:
    - For each tokenL 
        - Checks 6h price % gain (`entryThreshold`)
        - Verifies volume exceeds (`volumeThreshold`)
        - Filters by `minMomentum`


3. **Rotation Rules**: 
    - Enforce cooldown per token to avoid re-buying too soon. 
    - Validates SOL balance and ensures below `maxOpenTrades`. 


4. **Execution**: 
    - Uses wallet rotation via `getNextWallet()` logic. 
    - Swaps into top candidate with `executeSwap()` and logs result. 
    - Prevents excessive daily trading with `maxDailyVolume`. 


5. **Extras**: 
    - Dry run support
    - Telegram alert integration
    - Logs every trade with metadata 

### Key Config 
- `sectors`, `rotationInterval`
- `entryThreshold`, `minMomentum`, `volumeThreshold`
- `positionSize`, `maxOpenTrades`, `takeProfit`, `stopLoss`
- `cooldown`, `dryRun`, `haltOnFailures`, `maxDailyVolume`


--- 






## Scalper Mode 

**File**: `scalper.js`
**Purpose**: Executes rapid in-and-out trades on volatile tokens for small, frequent profits. 

### How it Works

1. **Tick Loops**: 
    - Runs at a fixed interval (`interval`) 
    - Iterates through pre-defined `monitoredTokens`

2. **Filter Criteria**: 
    - Price change over 1 hour > `entryThreshold`
    - Volume must exceed `volumeThreshold` 
    - Honeypot checks with `isSafetoBuy`


3. **Execution**: 
    - Sends swap quote via `getSwapQuote()`
    - Executes trade with `executeSwap()`
    - Adds to `openTrades` and limits concurrency


4. **Safety Nets**: 
    - Wallet balance check (`minBalance`)
    - Failure count haltsbot after `haltonFailures`


5. **Dry Run**: 
    - Simulates swap and logs result if enabled. 


### Key Config 
- `monitoredTokens`, `scalpAmount`, `slippage`, `interval`
- `entryThreshold`, `volumeThreshold`
- `takeProfit`, `stopLoss`, `maxOpenTrades`

--- 




## Rebalancer 
**File**: `rebalancer.js`
**Purpose**: Keeps your portfolio in line with defined target token allocations by auto-swapping betweeen them.

### How It Works 

1. **Portfolio Scan**: 
    - Loads token balances and prices
    - Computes current % allocation for each token. 

2. **Deviation Detection**: 
    - Compares current allocation vs. `targetAllocations`
    - Skips if difference < `rebalanceThreshold` 

3. **Swap Execution**: 
    - Swaps from over-weighted -> under-weighted token 
    - Enforeces `minTradeSize` to avoid dust.

4. **Controls**: 
    - Max trades per cycle (`maxTradesPerCycle`) 
    - Honeypot check before any swap
    - Telegram updates + trade logging. 

5. **Dry Run**:
    - All logic executed, but no transaction occurs. 


### Key Config 
- `targetAllocations` (mint -> %) 
- `rebalanceThreshold`, `minTradeSize`
- `slippage`, `dryRun`, `maxTradesPerCycle`
- `haltOnFailures` 

--- 







## TrendFollower 
**Purpose**: Buys oken that are trending up over a longer window, aiming to catch organic rallies. 

### How it Works

1. **Token Loop**: 
    - Monitors configured tokens via `trendWindow` (default 6h) 

2. **Filter**: 
    - Price % gain must exceed `threshold`
    - Volume required (optional) 
    - Honeypot check required 

3. **Execution**: 
    - Sends quote -> executes swap 
    - Logs trade with metadata 

4. **Planned Features**: 
    - EMA crossovers 
    - Trend Continuation
    - Exit logic with trailing stop 

### Key Config 
- `tokens`, `trendWindow`, `threshold`
- `tradeAmount`, `slippage`, `interval` 
- `takeProfit`, `stopLoss`, `maxOpenTrades`
- `confirmationCandles` (stubbed) 

--- 





## Sniper Mode

**Purpose**: Detects and buys newly listed tokens instantly after reappearance on Jupiter Aggregator, with integrated safety checks
and wallet rotation. 

### How it Works

1. **Token Discovery**: 
    - Loads known token list from memory or config. 
    - Compares against seen tokens; filters for new/monitored ones. 

2. **Candidate Filtering**: 
    - Verifies token has not alreafy been sniped 
    - Checks 1h price change against `volumeThreshold`. 
    - Confirms `isSafeToBuy` passes honeypot & blacklist checks. 
    - Ensures wallet has MIN_BALANCE SOL.
    - Aborts if daily trade volume exceeds `maxDailyVolume` 

3. **Execution**: 
    - Uses `getSwapQuote()` to estimate trade. 
    - Executes with `exectuteSwap()` unless `dryRun` mode. 
    - Logs trade metadata (price impact, hash, time). 
    - Limits to `1 trade per tick`.

4. **Rotation Rules**: 
    - Loads wallets from labels using `loadWalletsFromLabels()`.
    - Uses `getCurrentWallet()` to rotate through available seats. 

5. **Extras**:
    - Telegram alerts on snipe success/failure
    - Analytics logs written to `trades.json`
    - Halts after X failures via `haltOnFailures`


**Key Config**: 
- `monitoredTokens`, `entryThreshold`, `volumeThreshold`2
- `slippage` `snipeAmount`, `interval`
- `takeProfit`, `stopLoss`
- `wallets` (array of labels)
- `inputMint` (default base token, e.g. SOL) 









## Delayed Sniper 

**Purpose**: Detects new token mints and executes a buy after a short delay, helping avoid rugs and unripe liquidity traps. 

**How it Works**: 
1. **Token Discovery**: 
    - Pulls token list from Jupiter or external feeds. 
    - Tracks unseen tokens via a `seen` Set. 
    - Skips tokens already sniped or on coo

2. **Warm-Up Delay**: 
    - When a new tolen is found, waits  `delayMS` milliseconds
    - Avoids buying toklens before liquidity is added. 
    - Ensures any early honeypot mechanics trigger before entry. 


3. **Candidate Filtering**: 
    - Confirms token 
    - Confirms price appreciation 
    - Skips tokens that dont shoew upward movement

4. **Execution**: 
    - Uses `getSwapQuote` to simulate trade. 
    - if `dryrun` is off, executes swap with `executeSwap()`/ 
    - Logs all trade results (whether success or fail). 
    - Sends Telegram message on outcome. 

5. **Rotation Rules**: 
    - Loads wallet(s) from labels in config using `loadWalletsFromArray()`
    - Validates SOL balance for execution and network fees. 
    - Skips trade if total daily volume exceeded `maxDailyVolume`


6. **Extras**: 
    - Cooldown per token (`COOLDOWN`) to avoid re-entry.
    - Halts completly after `HALT_ON_FEATURES` errors. 
    - Logs everything with timestamps + full metadata. 
    - Only attempts `1 token per tick`. 


**Key Config
- `monitoredTokens`, `delayMs`, `entryThreshold`, `volumeThreshold`








## Breakout Mode

**Puropose**: Detects sudden price and volume breakouts on monitored tokens and enters positions early, aiming to ride explosive momentum before the rest 
of the market reacts. 

**How It Works**: 
1. **Token Discovery**: 
    - Monitors a list of tokens provided via `monitoredTokens`
    - Each run checks a price change and current volume data. 
    - Skips tokens on cooldown (tracked via `lastTrade`).

2. **Breakout Detection**: 
    - Requires price % change over last 6h > `breakoutThreshold` 
    - Volume must exceed `minLiqudiity`. 
    - Volume must also be 2.5x (or more) the average volume (`volumeSpikeMultiplier`) 
    - if all pass -> its a breakout candidate. 

3. **Execution**: 
    - Loads wallet via `loadsWalletsFromArray()` and gets current one. 
    - Skips execution if SOL balance too low or daily volume cap hit. 
    - Fetches swap quote and executes it (unless `dryRun` is true).
    - Records trade metadata including price impace, hash, and PnL targets 

4. **Rotation Rules**: 
    - Uses wallet manager to load/rotate accounts. 
    - Prevents double-entry into the same token using cooldwon per mint. 

5. **Extras**: 
    - Logs every trade with success/failure state and analytics. 
    - Built-in honeypot check (`isSafetoBuy`) 
    - Stops the bot after `haltOnFailures`



**Key Config**: 
- `monitoredTokens`, `breakoutThreshold`, `volumeSpikeMultiplier`
- `interval`, `minLiquidity`, `slippage`, `positionSize`
- `takeProfit`, `stopLoss`, `cooldown`
- `dryRun`, `haltOnFailures`, `maxDailyVolume` 
- `wallets`, `inputMint`





## Chad Mode 

**Purpose**: High risk, high-reward mode designed to snipe fresh mints or low-cap tokens with fast execution
and optional auto-dump. Ideal for aggressive traders looking for fast flips/ 

**How it Works**:

1. **Setup + Validation**: 
    - Requires `outputMint` in config. If missing, the bot aborts. 
    - Loads wallets using   `LoadWalletsFromArray() and selects the current one.
    - Checks if wallet has minimum SOL to proceed (`0.01 SOL` threshold)

2. **HoneyPot + Safety Check**: 
    - Verifies token is not a scam using `isSafeToBuy()`. 
    - Skips any tokens flagged as unsafe. 

3. **Trade Execution**: 
    - Gets quote via `getSwapQuote()` with optional `priorityFeeLamports` for faster confirmation. 
    - Executes trade via `executeSwap()` and logs results. 

4. **Auto-Sell Logic (Optional)**: 
- If enabled, the bot will" 
    - Wait a fixed random delay (`autoSell.delay` or `randomDelayRange`)
    - Fetch quiote for the reverse swap (dump)
    - Execute dump trade with the same slippage + fee logic. 
    - Log and notify via Telegram. 

5. **Logging + Alerts**: 
    - Logs both buy and sell (dump) trades via `logTrade()`
    - Sends telegram notifications for all major events (success, failure, error) 
    
**Key Config**: 
- `inputMint`, `outputMint`: Token pair for swap
- `positionSize`: SOL amount to spend (e.g. 0.03)
- `slippage`: Tolerable price slippage %
- `priorityFeeLamports`: Optional boost for transaction speed. 
- `takeProfit`, `stopLoss`: Tracked in logs for post-trade analysis. 
- `dryRun`: Simulates the trade without execution. 
- `wallets`: Wallet Rotation support
- `autoSell`: Optional dump logic 
    - `enabled`: Turn off/on dump
    - `delay`: FIxed: turn on/off dump 
    `useRandomDelay`: Enable randomized wait
    - `randomDelayRange`: Min/max ms range (e.g [2000, 5000])


**Exras**: 
- 🛡 Honeypot Guard
- 🔁 Wallet Rotation
- 🔥 Priority Fee Handling
- 🔂 Optional Auto-Dump
- 📊 Trade Analytics
- 📲 Telegram Alerts (Buy/Dump/Error)
- 🧪 Dry Run Mode for safe testing






## Dip Buyer Mode 

**Purpose**: Enters bounce trades when a token experiences a rapid dip in price. Usedul for catching temporary dumpas, overreactions, or potentiral exit 
scams with rebounc potential.


**How It Works**: 

1. **Token Watchlist**: 
    - Loads a list of tokens from `watchedTokens` in the config. 
    - Loops through each token on a set interval (`interval`) 


2. **Price Drop Detection**:
    - Tracks current and historical prices for each token using `priceHistory`.
    - Compares current price against the one recorded within `recoveryWindow` (default: 5 minutes).
    - Triggers only if price drops by `dipThreshold` (e.g. 20%) within the lookback window.

3. **Volume Check**:
- Skips tokens with volume below `volumeThreshold`.

4. **Execution**:
    - Checks honeypot status with `isSafeToBuy()`.
    - Ensures wallet has enough SOL and hasn't exceeded maxDailyVolume.
    - Gets a quote with `getSwapQuote()` and optionally executes it using `executeSwap()` (unless `dryRun` is enabled).
    - Records result to analytics with `logTrade()`.

5. **Cooldown Control**:
    - Prevents re-buying same token too soon via `lastBuyTimestamps`.
    - Uses cooldown per token (default: 60s) before evaluating again.

6. **Wallet + Notifications**:
- Loads wallet(s) using `loadWalletsFromArray()`.
- Sends trade success or failure alerts via Telegram using `sendTelegramMessage()`.

**Key Config**:
`watchedTokens`: List of tokens to monitor for dips
`dipThreshold`: % drop that triggers buy (e.g. 0.2 for 20%)
`recoveryWindow`: Timeframe to check drop against (ms)
`interval`: Loop tick interval in ms
`volumeThreshold`: Minimum volume to consider
`positionSize`: Amount of SOL to spend per trade
`slippage`: Swap tolerance
`takeProfit`, stopLoss: PnL tracking (future use)
`cooldown`: Prevents re-buying too quickly
`dryRun`: Logs simulated trades without executing
`maxDailyVolume`: Total SOL cap per day
`haltOnFailures`: Stop bot after consecutive failures
`wallets`, `inputMint`: Used to load wallet and base token

**Extras**: 
- 🧠 Smart price tracking with historical memory
- 🛡 Honeypot protection
- 🔁 Wallet rotation
- 🧪 Dry run mode
- 🔔 Telegram alerts
- 📊 Analytics logging
- 🔂 Token-specific cooldown system






## Paper Trader Mode
**Purpose**: Simulates real trades using live market data, allowing you to test strategies safely without risking real funds. Ideal for backtesting logic, tracking theoretical PnL, or side-by-side testing with live bots.

**How It Works**

1. **Token Loop**:
    - Loads list of tokens from monitoredTokens.
    - Runs continuously on an interval (interval).
    - Skips tokens on cooldown (cooldown per token).

2. **Signal Detection**:
    - Checks 1h price change for each token.
    - Requires price % increase ≥ entryThreshold.
    - Requires volume ≥ volumeThreshold.

3. **Simulated Trade**:
- Gets quote using `getSwapQuote()`.
- Logs simulated input/output, slippage impact, and expected results.
- Saves trade details via `logTrade()` with `simulated: true`.

4. Notification + Logging:
    - Sends Telegram alerts with trade intent summary.
    - Optionally logs results to a local file (`logs/paper_trades.log`) if logToFile is true.

5. **Trade Limits**:
    - Tracks how many trades have been simulated today via dailyTrades.
    - Enforces a cap using maxDailyTrades.

**Key Config**: 
monitoredTokens: Tokens to simulate trades on

inputMint, slippage, positionSize: Trade configuration

interval: Time between trade scans

entryThreshold: Required price % increase to simulate buy

volumeThreshold: Minimum liquidity

cooldown: Per-token trade spacing

takeProfit, stopLoss: Logged for analytics (not executed)

dryRun: Should always be true for this mode

maxDailyTrades: Safety limit on simulated trades per run

logToFile: Toggle writing logs to file

Extras
✅ Zero-risk strategy testing

📉 Logs trades as if they were real

🧠 Helps validate configurations before live deployment

🔔 Telegram alerts for every simulated trade

📁 Optionally logs JSON to file for audit/tracking

