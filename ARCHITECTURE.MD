### ARCHITECTURE


### ⚙️ BACKEND OVERVIEW
The backend is built with Node.js + Express and serves both: 
    - A `REST API` for bot control and trade data. 
    - A `WebSocket server` for real-time log straming to the frontend. 

It supports two main run modes: 
1. CLI Mode - Launch a strategy directly with a config file. 
2. Server Mode - Manage strategies from a live control panel. 



### 🧩 Strategy & Utility Architecture 
- `Strategies` are fully modular and dynamically loaded based on user input. 
- Token monitoring and swap logic via Jupiter API
- Wallet rotation and Solana transaction execution. 

Supporting utilities are divided into: 
- `Core Utils`: Market data, swap execution, wallet handling. 
- `Service Utils`: Logging, trade tracking, recao generation, Telegram alerting. 


### ⚙️ Config & State Management
Configuration is passed via: 
    - CLI args (`--mode sniper --config ./configs/sniper.json)
    - Or injected from the frontend dashboard. 

The bot treatss strategies as a `stateless`, and injectss runtime coding via environment.
Trade results are saved in memory or flat files (CSV-Only) and summarized with daily recap logic



### 🌐 WebSocket Integration
- Console logs from the backend are broadcasted over WebSocket to all connected frontends, allowing live insights into bot behavior 
(trades, errors, actions, etc.) with zero latency. 


### 💻 Frontend Dashboard
The frontend is built with Vite + React and includes: 
    - Strategy selector and configuration panel 
    = Start/stop controls over live bot execution 
    - Real-time log stream viewer 
    - Trade history table
    - Dynamic portfolio & trade output charts.
    - Daily performance & trade output charts 
    - CSV export and log reset 
    - Auto-restart toggle and persistent localStorage config. 


### 🧩 Architecture Summary: 
Together, this platform provides: 
    - Headless automation via CLI 
    - Interactive control via dashboard
    - Real-time feedback via WebSocket + logs
    - `Extendable Structure` for adding new strategies or integrations. 


