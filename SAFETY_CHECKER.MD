### Curent WatchChecker + Safety Checker Flow 
1. User enters a mint address in the token mint address input inside `configPanel`
2. User optionally clicks `Check Token Safety` - this sends to POST `/api/manual/check-token-safety and receives the
result. 
3. If passed,, they can now click `+ Add to Watchlist`, which saves the token to `localStorage.sniper_watchlist` 
along with the safety result. 
4. In the `Watchlist tab`, those tokens display with: 
    - ✅ or ❌ based on token.safety.passed
    - Buttons for `Snipe` or `Remove`. 


### IN Watchlist, We'll allow users to: 
    - Filter the watchlist by `Safe`, `Unsafe`, or `ALL`
    - Run safety checks directly from the Watchlist tab (just incase they never ran it before.)
    - [Optional] Let them add tokens directly from the Watchlist tab, without using the configPanel at all. 



### User Flow Summarized: 
1. Paste mint into `Token Mint Address`
2. Safety is automatically checked (with visible Check Token Safety Panel show right below)
3. click `Add to Watchlist` adds token with saved safety result.
4. In `Watchlist tab`:
    - User can recheck safety manually 
    - Filter to Safe / Unsafe
    - Remove or snipe with 1 Click



### 🔍 Current Safety Layers

| **Check ID**         | **Label**                   | **What It Verifies**                                                                 |
|----------------------|-----------------------------|----------------------------------------------------------------------------------------|
| `honeypot`           | Honeypot Trap               | Blocks selling or restricts transfers — common rugpull trick                          |
| `liquidity`          | Liquidity Healthy           | Fails if liquidity is too low or not locked                                           |
| `blacklist`          | Blacklist Check             | Flags tokens or creators found in known scam blacklists                               |
| `ownership`          | Owner Renounced             | Warns if the owner still has control over key token functions                         |
| `verified`           | Verified Contract           | Checks if the source code is verified on explorers like SolanaFM                      |
| `tradingOpen`        | Trading Enabled             | Detects if trading is paused or disabled                                              |
| `freezeAuthority`    | Freeze Authority Removed    | Warns if a wallet still has permission to freeze transfers                            |
| `mintAuthorityOwned` | Mint Authority OK           | Flags if minting is still enabled or possible                                         |
| `topHolderRisk`      | No Whale Control            | Fails if >20% of supply is held by a single wallet (whale risk)                       |

---

### 🧠 How It Works Behind the Scenes

| **Check Name**        | **Source**                          |
|------------------------|--------------------------------------|
| `honeypot`             | Simulated Jupiter Swap              |
| `liquidity`            | Birdeye API                         |
| `blacklist`            | Pump.fun + hardcoded lists          |
| `ownership`            | Pump.fun + SolanaFM                 |
| `verified`             | SolanaFM or other explorers         |
| `tradingOpen`          | Simulated order routing             |
| `freezeAuthority`      | Direct `getAccountInfo`             |
| `mintAuthorityOwned`   | Direct `getMint()` query            |
| `topHolderRisk`        | Token holders snapshot API          |
