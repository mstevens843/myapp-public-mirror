### Token Safety Check System
- This Solana bot includes a `multi-layered token safety engine` to detect and block risky trades before they happen
This system protects users from honeypots, scams, and rugpulls by scanning each token through several independent
APIs and on-chain validations. 


# What happens when you run a Safety Check
- Whenever a user runs safety check (or adds to a token to the Watchlist), the backend performs full diagnostic
using:
- `POST /api/manual/check-token-safety`
This calls the backend utility 
`isSafeToBuyDetailed(mint)`
- it returns a verdict (`passed: true/false`) along with a detailed `breakdown` of all checks performed. 




### 🔍 CURRENT SAFETY LAYERS

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



THESE RETURN `TRUE` IF SAFE, BUT `FALSE` IF FLAGGED. THEY ARE GROUPED BY CATEGORY ON THE FRONTEND AND SCORED. 



### Safety Score Calculation:
- Each token is given a `Safety Score (%)`:
(score = # of checks passed / total checks) * 100
    - ✅ 85%+ = Likely Safe
    - ⚠️ 60-84% = Medium Risk
    - ❌ Below 60% = Unsafe / Unverified
This is shown visually with color coding and breakdown badges in the Watchlist tab.



### 💡 Sample Result: 
{
  mint: "So11111111111111111111111111111111111111112",
  passed: true,
  breakdown: {
    honeypot: true,
    liquidity: true,
    blacklist: true,
    ownership: true,
    verified: true,
    tradingOpen: true,
    freezeAuthority: true,
    mintAuthorityOwned: true,
    topHolderRisk: true
  }
}



### Why it Matters: 
- ❌ You don't buy a token that locks your funds.
- ❌ You don't get rugged by a whale or malicious contract.
- ✅ You only interact with tokens that pass public verification, control audits, and LP locks.


Let me know if you want this broken into multiple sections (like /docs/safety.md), or if you want to add diagrams or flowcharts. We can also add “How to Extend Safety Checks” next if you're planning to open this up for contributors or plugin logic.