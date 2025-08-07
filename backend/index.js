/** index.js - Dual-mode bot controller: CLI launcher or Express + WebSocket server. 
 * 
 * Features: 
 * - CLI Mode:
 *      - Accepts aa strategy name via `process.argv[2]
 *      - Loads wallet + balance
 *      - Launces strategy directly from `./services/strategies`
 * 
 * - Server Mode: 
 *      - Starts Express REST API and WebSocket server on PORT 5001
 *      - Exposes `/api/*` strategy control endpoint
 *      - WebSocket broadcasts console logs to connected frontend
 *      - Shares `currentModeProcess` between routes for process control 
 * 
 * - Used as the main entry point for both development (server mode)
 * and production script execution (CLI Mode)
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");
const strategies = require("./services/strategies");
const loadKeypair = require("./utils/wallet");
const connection = require("./config/rpc");
// const { loadWalletsFromLabels } = require("./services/utils/wallet/walletManager"); // 
const { startNetworthCron } = require("./services/utils/analytics/netWorthSnapshot");
const cron = require("node-cron");
const { runDaily, runMonthly } = require("./services/utils/analytics/tradeRetention");
const { startWatchdog } = require("./services/utils/strategy_utils/strategyWatchdog");
const { injectBroadcast } = require("./services/strategies/logging/strategyLogger");
require("./loadEnv");
const { startBackgroundJobs } = require("./services/backgroundJobs");

// -----------------------------------------------------------------------------
// Additional security modules. These help harden the server against common
// vulnerabilities by adding sane HTTP headers and limiting request rates.
// Helmet sets various headers like X‑Frame‑Options, X‑Content‑Type‑Options, etc.
// Rate limiting mitigates brute force attacks and DoS by capping request volume.
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// If a mode is passed via CLI, run strategy directly.
const modeFromCLI = process.argv[2];

console.log("✅ THIS IS THE REAL index.js RUNNING");

// ✅ MUST be first
const { init } = require("./services/utils/strategy_utils/scheduler/strategyScheduler");
init();



if (modeFromCLI) {
  // === CLI Mode Runner ===
  (async () => {
    try {
        // Load wallet & fetch balance
      const wallet = loadKeypair();
      const balance = await connection.getBalance(wallet.publicKey);
      console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
      console.log(`Balance: ${balance / 1e9} SOL`);
        // invalid strategy check
      if (!strategies[modeFromCLI]) {
        console.error(`❌ Invalid mode: ${modeFromCLI}`);
        console.log(`✅ Available modes: ${Object.keys(strategies).join(", ")}`);
        process.exit(1);
      }
      // Start strategy
      console.log(`🚀 Starting ${modeFromCLI} strategy...`);
      strategies[modeFromCLI]();
    } catch (err) {
      console.error("❌ Error loading wallet or fetching balance:", err.message);
    }
  })();
} else {
  // === Express + WebSocket Server Mode ===
  // ⛔ Kill all running bots if server is exited
["SIGINT", "SIGTERM", "SIGUSR2"].forEach((sig) =>
  process.once(sig, () => {
    const { runningProcesses } = require("./services/utils/strategy_utils/activeStrategyTracker");
    for (const botId in runningProcesses) {
      try {
        runningProcesses[botId].proc.kill("SIGTERM");
      } catch (e) {
        console.warn(`Failed to kill bot ${botId}:`, e.message);
      }
    }
    process.exit();
  })
);


  const app = express();

  // ---------------------------------------------------------------------------
  // Server hardening: remove X-Powered-By header and apply security middleware.
  app.disable('x-powered-by');

  // Apply Helmet to set a broad set of security-related HTTP headers. We disable
  // the built-in CSP here to avoid conflicts with dynamic scripts in the frontend.
  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  // Apply a global rate limiter to protect against abuse. The maximum number of
  // requests per window can be tuned via RATE_LIMIT_MAX_REQUESTS env var. We skip
  // Stripe webhooks to avoid interfering with third-party callbacks.
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '300', 10),
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.originalUrl === '/api/payment/webhook',
  });
  app.use(globalLimiter);

  const PORT = process.env.PORT || 5001;

  // const { loadWalletsFromLabels } = require("./services/utils/wallet/walletManager");
  // loadWalletsFromLabels(["default.txt"]); // ✅ same as Telegram startup

  let currentModeProcess = null; // Track current running strategy (if spawned via API)

  // ✅ Allow frontend to send credentials (cookies) on cross‑origin requests.
  // In practice CORS errors often occur when the expected FRONTEND_URL is not
  // defined or the client is served from an unexpected origin (e.g. using a
  // different port during development).  To make CORS behaviour more
  // predictable we derive an allow‑list from either CORS_ALLOWED_ORIGINS
  // (comma‑separated) or FRONTEND_URL.  If neither are set we simply allow
  // any origin.  This prevents sudden “CORS policy” failures if env vars are
  // missing or misconfigured.  The callback signature follows the express‑cors
  // docs: callback(err, allow).  Requests without an Origin header (e.g.
  // server‑to‑server or curl) are always allowed.
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || process.env.FRONTEND_URL || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        // allow requests with no origin like mobile apps or curl
        if (!origin) return callback(null, true);
        // no allow list configured → allow all origins
        if (allowedOrigins.length === 0) return callback(null, true);
        // check against allow list
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        // otherwise reject
        return callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
    })
  );

// ✅ Required to read cookies like access_token from incoming requests
app.use(cookieParser());

// ✅ Parse JSON unless Stripe webhook
app.use((req, res, next) => {
  if (req.originalUrl === '/api/payment/webhook') {
    next(); // skip, let express.raw() handle it
  } else {
    express.json()(req, res, next);
  }
});



  /**
   * API ROuter Injection
   * Injects current mode process and setter for use in route files
   */
  const apiRouter = require("./api");
  app.use("/api", (req, res, next) => {
    req.currentModeProcess = currentModeProcess;
    req.setModeProcess = (proc) => {
        currentModeProcess = proc;    
    };
    next();
}, apiRouter);


app.use((err, req, res, next) => {           // <‑‑ catch every uncaught error
  console.error("💥 Unhandled error:", err);  // this still prints full stack
  res.status(500).json({ error: err.message }); // browser now sees the real msg
});

  // Create HTTP + WebSocket server (for logsConsole)
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
   const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGUSR2"]; // nodemon = SIGUSR2

 function gracefulExit() {
   console.log("👋  Graceful shutdown…");

   // 1. Tell strategyLauncher we’re shutting down
   const { runningProcesses } =
         require("./services/utils/strategy_utils/activeStrategyTracker");
   for (const meta of Object.values(runningProcesses)) {
     try { meta.proc.kill("SIGINT"); } catch {}
   }

   // 2. Close WS & HTTP server
   wss.close(() => {
     server.close(() => {
       console.log("✅  HTTP/WS closed – exiting.");
       process.exit(0);
     });
   });

   // 3. Failsafe exit after 3 s
   setTimeout(() => process.exit(1), 3000);
 }

 STOP_SIGNALS.forEach(sig => process.once(sig, gracefulExit));

  /** 
   * WebSocket connection for real-time logs
   * Overrides console.log and mirrors to frontend via WS. 
   */
  const clients = new Set();


  injectBroadcast((line) => {
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(line);
    }
  }
});

wss.on("connection", (ws) => {
  clients.add(ws);
  console.log("🧠 LogsConsole connected via WebSocket");

  ws.on("close", () => {
    clients.delete(ws);
    console.log("🔌 WebSocket disconnected");
  });
});


// const stripeWebhook = require('./payment');
// app.post('/webhook', stripeWebhook);
// Override console.log once globally
// const originalLog = console.log;
// console.log = (...args) => {
//   const line = args.join(" ");
//   for (const client of clients) {
//     if (client.readyState === client.OPEN) {
//       client.send(line);
//     }
//   }
//   originalLog(...args);
// };

  // // 🔁 Launch Telegram interactive bot (manual trade commands)
  // require("./telegram/index");

  startWatchdog(); // 🐶 Auto-restart frozen strategies


  startNetworthCron(); 
  cron.schedule("0 0 * * *", runDaily,   { timezone: "America/Los_Angeles" });
  
// 00:05 PT on the first of each month
  cron.schedule("5 0 1 * *", runMonthly, { timezone: "America/Los_Angeles" });

  // 00:05 PT every night → runs full prune + rollup as a safety net
  cron.schedule("5 0 * * *", () => {
    const { pruneAndRoll } = require("./services/utils/analytics/tradeRetention");
    pruneAndRoll();
  }, { timezone: "America/Los_Angeles" });

  // Launch server
  server.listen(PORT, () => {
    console.log(`🧠 Bot controller API + WS running @ http://localhost:${PORT}`);
    startBackgroundJobs();

              // ⚡ Restore scheduled jobs and arm limit-price watchers
          require("./services/utils/strategy_utils/scheduler/strategyScheduler");

  });
}