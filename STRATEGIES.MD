# TRADING STRATEGIES OVERVIEW

This file documents the purpose, logic, and configuration for each supported strategy in the Solana Trading Bot platform. 

--- 

## SNIPER MODE

**Purpose**: Detect newy listed tokens and snipe them instantly before the market reacts. 

**Execution**: 
- Scans Jupiter token list for new or unknown mints. 
- Applies safety checks (honeypot, blacklist, liquidit). 
- Executes swap if token meets pump and volume thresholds. 


**Key Config**: 
- `monitoredTokens`: Optional array of specific mints to monitor. 
- `entryThreshold`: Minimum 1h price % change to consider. 
- `volumeThreshold`: Minimum token volumn in SOL. 
- `snipeAmount`: Amount to spend per buy (in SOL). 
- `takeProfit`, `stopLoss`: Passed into logs for future use. 
- `haltOnFailures`: Halts bot afrter X consecutive failed snipes. 
- `dryRun`: If true, no swap is made; logs only. 


**Unique Features**: 
- Real-time new token detection
- Multi-wallet rotation
- Telegram alerts
- Jupiter price simulation







## DELAYED SNIPER MODE

**Purpose**: Wait and re-check newly launched tokens a few seconds later to reduce risk. 

**Execution**
- Similar to Sniper, but introduces a delay before buying. 
- Allows liquidity and price action to stabilize slightly 

**Config**: 
- Same as Sniper, with optional `delayMs` Field

**Use Case**: For users who prefer to wait a few seconds before jumping in to avoid front-running rugs. 

--- 







## SCALPER MODE

**Purpose**: Rapidly enter and exit trades based on fast micro movements. 

**Execution**
- Continuously monitor known tokens. 
- Buys on signal (e.g. price spike), then exits on small gain. 
- Aims for multiple small wins rather than large gains. 


**Key Config**
- `tokens`: Tokens to scalp. 
- `slippage`, `interval`, `takeProfit`, `stopLoss`
- `maxTrades`: Max concurrent trades or round trips. 

**Use Case**: High frequency trading style for volatile tokens. 

--- 







## TREND FOLLOWER 

**Purpose**: Ride sustained uptrends on tokens with momentum. 

**Execution**: 
- Looks for steady price climnbs over multiple intervals. 
- Buys in on breakout confimration. 

**Config**
- `priceChangeThreshold`
- `volumeThreshold`
- `slippage`. `takeProfit`, `stopLoss`

**Use Case**: Good for trending markets or seasonal pumps. 

--- 





## ROTATION BOT

**Purpose**: Rotate trades across multiple wallets and/or tokens to spread risk. 

**Execution**
- Executes a round-robin strategy over predefined mints and wallets. 
- Applies time interval, safety check, and config per run. 

**Key Config**
- `wallets`: Array of wallet labels
- `tokens`: Array of token mints
- `slippage`, `interval`, `maxTrades`

**Use Case**: Useful for large portfolios or stealth wallet rotation. 

--- 






## DIP BUYER

**Purpose**: Buy tokens when they sharply drop in price (catching dips). 


**Execution** 
- Monitors for fast drops (e.g. > 10%). 
- Executes buy if volume is still high and token is safe. 


**Key Config**
- `dipThreshold`: How steep a drop to consider. 
- `volumeThreshold`
- `takeProfit`, `stopLoss`

**Use Case:** Contrarian style; works during volatile markets. 


--- 









## BREAKOUT

**Purpose**: Detect breakout moves and buy before major runups. 

**Execution**
- Looks for breakout candles or fast liquidity + price jumps. 
- Buys based on breakout poattern match. 

**Key Config**
- `priceChangeThreshold`
- `avgVolumeMultiplier`
- `volumeNow` 
- `takeProfit`, `stopLoss`

**Use Case** Perfect for catching tokens about to explode. 

--- 








## PAPER TRADER 

**Purpose**: Simulate trading strategies with zero  risk for testing. 

**Execution**
- Logs hypothetical trades based on strategy signals. 
- No wallet interaction. 

**key Config:**
- All strategy options supported. 
- `dryRun: true`

**Use Case**: Debugging, simulations, and analytics before going live. 

--- 





## CHAD MODE

**Purpose**: YOLO strategy - high ris, no risk, buys early. 

**Execution**
- Skips most safety checks. 
- Buys large size fast. 
- Designed for meme season or ultra-degen plays. 

**Key Config** 
- `ignoreSafetyChecks: true`
- `maxSpendPerToken`
- `minVolume`

**Use Case**: Only use if you're okay with risk. Built for chaos. 

--- 




## Rebalancer Strategy 

**Purpose**: Auto Redistributes SOL acrooss multiple wallets to ensure optimal balance before executing trades. 
Ideal for load balancing and ensuring liquidity availability. 

**Execution**
- Monitors liuve wallet balances
- Compares actual % allocation to target weights
- Buys or sells tokens to bring allocation back in line.
- Avoids trading if slippage or imbalance is too high. 

**Key Config** 
- `targetWeights`: `{ [mint] : number }` map ideal % allocations (e.g. 30% SOL, 20% JUP, etc.)
- `rebalanceThreshold`: How far off (%) before action is triggered. 
- `slippage`: Max allowed sloppage per swap. 
- `minTradeSize`: Smallest trade size to act on 


**Use Case**: Ideal for long-term DeFi strategies that want to stay exposed to multiple assets in fixed proportions. 


--- 


