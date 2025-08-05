📦 Your Project
│
├── /api/mode/start
│    └── Spawns process: node services/strategies/sniper.js <configPath>
│
├── sniper.js (strategy logic)
│    ├── Handles config, scan interval, price filter, honeypot, trade, alert
│    └── CLI-ready OR process-spawned
│
├── AutoStrategyExecutor.js
│    └── Lets you run sniper (or multiple) directly in-process (used for tests, CLI, orchestration)
│
├── config.json (per strategy)
│    └── Passed into AutoStrategyExecutor or mode/start as spawn arg
│
└── openTrades + logs + alerts
     └── Used by sniper, TP/SL monitors, UI sync



### Summary of each Part 
1. -- ex: sniper.js
- The core bot logic. 
- Can run standalone via CLI (node `sniper.js` `config.json`) or be spawned via `/api/mode/start`
- Owns all strategy logic, including: 
    - Price/Volume Filter
    - HoneyPot Check
    - Cooldowns
    - Swap Executions
    - Logging + Alerts3

2. `AutoStrategyExecutor.js`
- Central Utility for programmatically triggering any strategy 
- Can run one or many strategies-in-process (no spawn()). 
- Useful for: 
    - CLI debugging. 
    - Testing 
    - MultiStrat Mode
    - Serverless Runs (Render dynos, one-shot deployments) 


3. `/api/mode/start`
- Starts your sniper (or any Strat) via Node's spawn(). 
- Writes config to disk, then starts the strategy as a separate subprocess. 
- Benefits: 
    - Process isolation
    - Easy Restart 
    - Clear Frontend Hook (`start` button -> this route)


4. Config Files (`/runtime/*.json`) 
- All strategies use config drive execution 
- Config Includes 
{
  "type": "sniper",
  "walletLabels": ["main"],
  "snipeAmount": 0.05,
  "slippage": 1.0,
  "loop": true
}





### How They Interact 

Trigger                         Calls                                OutCome 
`runAutoStrategy`               Calls `sniper(config)`               Directly executes logic in same process
`api/mode/start`                Spawns `node sniper.js configPath`   Launches it as subprocess, isolates crash
`node AutoStrategyExecutor.js`  calls `runAutoStrategy()`            CLI way to test or deploy 
Frontend `Start Bot`            sends POST to `/api/mode/start`      Spawns sniper via backend route



## ❓ Do You Need Anything Else Backend-Wise?
✅ You already have everything needed to:
- Run sniper standalone
- Run via frontend toggle
- Run multiple strategies
- Handle logs, alerts, failures



### Optional (Future) 
Add-On:                                         Why:
`monitorTpSl.js` hook for sniper                To auto-close sniper trades on TP/SL after entry 
`strategyStatus.js`                             Expose /api/strategy/status per strat for frontend status updates
`strategyValidator.js`                          Validate configs passed to `/start` before writing (e.g. check slippage range)
`MultiStrategyController.js`                    Use `AutoStrategyExecutor` to launch all enabled strategies in-process
watchDog                                        Kill-restart strategies don stuck tick, bad loop, or crash (if not using /mode)