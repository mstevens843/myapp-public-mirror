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
const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const strategies = require('./services/strategies');
const loadKeypair = require('./utils/wallet');
const connection = require('./config/rpc');
// Load and configure modular middleware.  See backend/middleware for
// implementation details.  These provide environment validation, CORS,
// security headers, rate limiting, request IDs and centralised error handling.
const validateEnv = require('./middleware/validateEnv');
const createCors = require('./middleware/cors');
const securityHeaders = require('./middleware/securityHeaders');
const { createRateLimiter, authLimiter } = require('./middleware/rateLimit');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');
// const { loadWalletsFromLabels } = require("./services/utils/wallet/walletManager"); // 
const { startNetworthCron } = require("./services/utils/analytics/netWorthSnapshot");
const cron = require("node-cron");
const { runDaily, runMonthly } = require("./services/utils/analytics/tradeRetention");
const { startWatchdog } = require("./services/utils/strategy_utils/strategyWatchdog");
const { injectBroadcast } = require("./services/strategies/logging/strategyLogger");
require("./loadEnv");
const { startBackgroundJobs } = require("./services/backgroundJobs");

// Ensure critical environment variables are present before proceeding.  This
// throws early if misconfigured, preventing undefined behaviour at runtime.
validateEnv();

// -----------------------------------------------------------------------------
// Additional security modules are provided via middleware under ./middleware.

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

  // Assign a unique ID to each request for log correlation.
  app.use(requestId);

  // Apply security headers.  Content Security Policy can be enabled in
  // report-only mode via ENABLE_CSP_REPORT_ONLY env var.  See
  // middleware/securityHeaders.js for details.
  app.use(securityHeaders());

  // Enforce strict CORS with an allow-list derived from env vars and sensible
  // development defaults.  Credentials are enabled to allow cookie-based auth.
  app.use(createCors());
  // Explicitly handle preflight (OPTIONS) requests for all routes.  This
  // improves clarity around CORS handling and returns a 204 No Content for
  // unknown routes rather than falling through to the next middleware.
  app.options('*', createCors());



  // Apply a global rate limiter to protect against abuse.  Limits can be tuned
  // via RATE_LIMIT_WINDOW_MS and RATE_LIMIT_MAX_REQUESTS environment variables.
  const globalLimiter = createRateLimiter({
    skip: (req) => req.originalUrl === '/api/payment/webhook',
  });
  app.use(globalLimiter);

  const PORT = process.env.PORT || 5001;

  // const { loadWalletsFromLabels } = require("./services/utils/wallet/walletManager");
  // loadWalletsFromLabels(["default.txt"]); // ✅ same as Telegram startup

  let currentModeProcess = null; // Track current running strategy (if spawned via API)

  // CORS is enforced via createCors() above.  See middleware/cors.js for details.

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

  // ---------------------------------------------------------------------------
  // Liveness & readiness probes.  These endpoints allow external monitors
  // (Kubernetes, load balancers, uptime checks) to verify that the service is
  // running and ready to handle requests.  Do not perform heavy work or
  // disclose sensitive information here.
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.get('/ready', (req, res) => {
    // In a more complete implementation you might test DB or dependency
    // connectivity here.  Keep it lightweight to avoid blocking.
    res.status(200).json({ status: 'ready' });
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


// Centralised error handler.  Logs the error and returns a sanitized
// response.  Must be registered after all other middleware and routes.
app.use(errorHandler);

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