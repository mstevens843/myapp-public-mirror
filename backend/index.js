
/**
 * index.js - Dual-mode bot controller: CLI launcher or Express + WebSocket server.
 *
 * This entry point can run in two modes:
 *
 * 1. CLI Mode – invoked via `node index.js <strategy>` it will load a wallet,
 *    fetch its balance and immediately launch the given strategy.  This path
 *    allows individual strategies to be run outside of the HTTP server for
 *    debugging and scripting.
 *
 * 2. Server Mode – if no CLI argument is supplied the module boots an
 *    Express REST API and WebSocket server.  It exposes `/api/*` endpoints to
 *    start/stop bots and streams log output to connected WebSocket clients.
 *    It also schedules a handful of cron jobs to prune trade logs and roll up
 *    monthly summaries.
 *
 * Enhancements made in the reliability pass include:
 *
 * - A single set of global `uncaughtException` and `unhandledRejection`
 *   handlers.  These route all unexpected failures through the central
 *   logger rather than silently terminating the process or leaking listeners.
 * - A heartbeat for WebSocket connections.  Clients are pinged every
 *   30 seconds; if a client fails to respond with a pong the connection is
 *   terminated and a health counter is updated.  This prevents zombie
 *   connections from consuming resources indefinitely.
 * - Graceful shutdown logic that clears the heartbeat interval in addition
 *   to closing the HTTP and WebSocket servers.  A failsafe timer still
 *   exists to exit the process should shutdown hang.
 * - Concurrency guards around scheduled cron jobs.  Each job is wrapped in
 *   a single‑flight mutex so if the previous invocation hasn’t completed
 *   subsequent runs are skipped.  Start/finish events and duration are
 *   logged for observability.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Load metrics instrumentation early.  This patches Prisma globally and
// exposes helpers used later in this file.  Importing here ensures that
// Prisma clients instantiated in downstream modules receive middleware
// automatically.  METRICS_ENABLED controls whether metrics are collected
// and whether the /metrics endpoint is exposed.
const metrics = require('./utils/metrics');

const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const { WebSocketServer } = require('ws');
const { monitorEventLoopDelay } = require('perf_hooks'); // ← added: for event-loop delay shedder
const { spawn } = require('child_process');
const strategies = require('./services/strategies');
const loadKeypair = require('./utils/wallet');
const connection = require('./config/rpc');
const validateEnv = require('./middleware/validateEnv');
const createCors = require('./middleware/cors');
const securityHeaders = require('./middleware/securityHeaders');
const { createRateLimiter, authLimiter } = require('./middleware/rateLimit');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const { startNetworthCron } = require('./services/utils/analytics/netWorthSnapshot');
const cron = require('node-cron');
const { runDaily, runMonthly } = require('./services/utils/analytics/tradeRetention');
const { startWatchdog } = require('./services/utils/strategy_utils/strategyWatchdog');
const { injectBroadcast } = require('./services/strategies/logging/strategyLogger');
require('./loadEnv');
const { startBackgroundJobs } = require('./services/backgroundJobs');
const { csrfProtection } = require('./middleware/csrf'); // ← added: CSRF middleware (double-submit)

// ----------------------------------------------------------------------------
// Global process‑level error handling
//
// Attach exactly one handler for uncaught exceptions and unhandled promise
// rejections.  Other modules should never call `process.on` for these events.
// If a fatal error occurs the logger will record it and the process will
// continue running – developers can decide whether to exit based on severity.
process.on('uncaughtException', (err) => {
  try {
    logger.error('Uncaught Exception:', err);
  } catch (e) {
    // If the logger itself blows up fall back to stderr
    console.error('Uncaught Exception (logger failure):', err);
  }
});
process.on('unhandledRejection', (reason) => {
  try {
    logger.error('Unhandled Rejection:', reason);
  } catch (e) {
    console.error('Unhandled Rejection (logger failure):', reason);
  }
});

// Ensure critical environment variables are present before proceeding.  This
// throws early if misconfigured, preventing undefined behaviour at runtime.
validateEnv();

// Initialise the strategy scheduler early (must be first)
const { init } = require('./services/utils/strategy_utils/scheduler/strategyScheduler');
init();

// Determine CLI mode vs server mode from argv
const modeFromCLI = process.argv[2];

// Helper to wrap cron jobs in a mutex.  If a job is still running when its
// schedule fires again the invocation is skipped.  Duration and outcome are
// logged.
function wrapCronJob(name, fn) {
  let running = false;
  return async function () {
    if (running) {
      logger.warn(`[cron] ${name} skipped – previous run still executing`);
      return;
    }
    running = true;
    const start = Date.now();
    logger.info(`[cron] ${name} starting`);
    try {
      await fn();
      const duration = Date.now() - start;
      logger.info(`[cron] ${name} completed in ${duration}ms`);
    } catch (err) {
      logger.error(`[cron] ${name} failed: ${err.message || err}`);
    } finally {
      running = false;
    }
  };
}

if (modeFromCLI) {
  // ────────────────────────── CLI Mode Runner ────────────────────────────
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
        console.log(`✅ Available modes: ${Object.keys(strategies).join(', ')}`);
        process.exit(1);
      }
      // Start strategy
      console.log(`🚀 Starting ${modeFromCLI} strategy…`);
      strategies[modeFromCLI]();
    } catch (err) {
      console.error('❌ Error loading wallet or fetching balance:', err.message);
    }
  })();
} else {
  // ────────────────── Express + WebSocket Server Mode ────────────────────
  // Stop any running bots when the process receives a termination signal
  ['SIGINT', 'SIGTERM', 'SIGUSR2'].forEach((sig) =>
    process.once(sig, () => {
      const { runningProcesses } = require('./services/utils/strategy_utils/activeStrategyTracker');
      for (const botId in runningProcesses) {
        try {
          runningProcesses[botId].proc.kill('SIGTERM');
        } catch (e) {
          console.warn(`Failed to kill bot ${botId}:`, e.message);
        }
      }
      process.exit();
    })
  );

  const app = express();

  // Subscribe to risk engine kill events. When a user breaches a risk limit
  // the risk engine emits a 'kill' event. We relay this as a notification
  // so the user sees an alert in their preferred channels. This is set up
  // early to ensure events emitted during API handling are captured. Note:
  // requiring here avoids importing riskEngine in CLI mode where it's unused.
  try {
    const riskEngine = require('./services/riskEngine');
    const { sendNotification } = require('./services/notifications');
    riskEngine.on('kill', ({ userId, reason }) => {
      try {
        sendNotification(userId, 'RISK_KILL', { message: `Trading disabled: ${reason}` });
      } catch (err) {
        logger.error('Failed to send risk kill notification', { err: err.message });
      }
    });
  } catch (_) {
    // risk engine or notifications may not be available in some contexts
  }

  // -------------------------------------------------------------------------
  // Server hardening: remove X-Powered-By header and apply security middleware.
  app.disable('x-powered-by');

  // IMPORTANT when behind a reverse proxy / CDN: trust proxy so rate‑limiters
  // and IP checks see the real client IP instead of the proxy’s address.
  app.set('trust proxy', 1); // ← added

  // Assign a unique ID to each request for log correlation.
  app.use(requestId);

  // Apply security headers.  Content Security Policy can be enabled in
  // report‑only mode via ENABLE_CSP_REPORT_ONLY env var.  See
  // middleware/securityHeaders.js for details.
  app.use(securityHeaders());

  // Enforce strict CORS with an allow‑list derived from env vars and sensible
  // development defaults.  Credentials are enabled to allow cookie‑based auth.
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

  // EXTRA auth limiter: slows brute force & enumeration on login/refresh/etc.
  app.use('/api/auth', authLimiter); // ← added

  const PORT = process.env.PORT || 5001;

  let currentModeProcess = null; // Track current running strategy (if spawned via API)

  // Required to read cookies like access_token from incoming requests
  app.use(cookieParser());

  // -------------------------------------------------------------------------
  // DDoS GUARD RAILS (added):
  //
  // (1) Inflight shedder — when concurrent requests exceed MAX_INFLIGHT we
  //     return 503 to shed load and preserve latency for healthy clients.
  //     Tune with DDOS_MAX_INFLIGHT (default 1500).
  let inflight = 0;
  const MAX_INFLIGHT = Number(process.env.DDOS_MAX_INFLIGHT || 1500);
  app.use((req, res, next) => {
    inflight++;
    res.on('finish', () => { inflight--; });
    if (inflight > MAX_INFLIGHT) {
      return res.status(503).json({ error: 'SERVER_BUSY' });
    }
    next();
  });
  //
  // (2) Event‑loop delay shedder — if p95 event‑loop delay rises above a
  //     threshold (CPU/IO pressure) we temporarily shed new requests.
  //     Tune with DDOS_ELD_P95_MS (default 200ms).
  let eld;
  try { eld = monitorEventLoopDelay({ resolution: 20 }); eld.enable(); } catch {}
  const ELD_P95_MS = Number(process.env.DDOS_ELD_P95_MS || 200);
  app.use((req, res, next) => {
    if (eld) {
      const p95ms = eld.percentile(95) / 1e6;
      if (p95ms > ELD_P95_MS) {
        return res.status(503).json({ error: 'SERVER_BUSY' });
      }
    }
    next();
  });

  // -------------------------------------------------------------------------
  // Metrics middleware – record timing and errors for every request.  Only
  // attach when metrics are explicitly enabled via METRICS_ENABLED env var to
  // avoid any measurable overhead in production unless desired.  Place this
  // ahead of route handlers so that all downstream middleware is timed.
  if (process.env.METRICS_ENABLED === 'true') {
    app.use(metrics.httpMetricsMiddleware);
  }

  // Parse JSON unless Stripe webhook
  //
  // Explicitly limit JSON body size to mitigate abusive payloads. The
  // default `express.json()` will happily consume arbitrarily large bodies
  // which can exhaust memory or CPU. Cap the request size at 100 kilobytes
  // which is more than enough for all our API payloads. Should a client
  // exceed this limit Express will respond with a 413 status code. Note
  // that Stripe webhooks are handled separately via `express.raw()` so
  // JSON parsing must be skipped for that route.
  app.use((req, res, next) => {
    if (req.originalUrl === '/api/payment/webhook') {
      return next(); // skip, let express.raw() handle it
    }
    // Apply a 100kb limit to all JSON bodies
    return express.json({ limit: '100kb' })(req, res, next);
  });

  // CSRF protection (double‑submit cookie) for unsafe methods
  app.use(csrfProtection); // ← added

  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Metrics endpoint – returns Prometheus formatted metrics for scraping.
  // Exposed only when METRICS_ENABLED is set to 'true'.  If disabled the
  // route is omitted entirely (resulting in a 404).  Instead of returning
  // the raw registry directly we delegate to `metrics.metricsEndpoint`
  // which performs API key and IP allow‑list checks before serving.  See
  // middleware/metrics.js for details.
  if (process.env.METRICS_ENABLED === 'true') {
    app.get('/metrics', metrics.metricsEndpoint);
  }

  /**
   * API Router Injection
   * Injects current mode process and setter for use in route files
   */
  const apiRouter = require('./api');
  app.use(
    '/api',
    (req, res, next) => {
      req.currentModeProcess = currentModeProcess;
      req.setModeProcess = (proc) => {
        currentModeProcess = proc;
      };
      next();
    },
    apiRouter
  );

  // Centralised error handler.  Logs the error and returns a sanitized
  // response.  Must be registered after all other middleware and routes.
  app.use(errorHandler);

  // Create HTTP + WebSocket server (for logsConsole)
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGUSR2']; // nodemon = SIGUSR2

  // Heartbeat: ping/pong management and health counters
  let wsPingInterval;
  const wsHealth = { connections: 0, disconnections: 0 };

  // Minimal GS origin allow‑list for WS (aligned with HTTP CORS origins)
  const ALLOW_ORIGINS = (process.env.CORS_ORIGINS || process.env.DEV_CORS_ORIGIN || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  // Wrap the graceful shutdown logic to clear heartbeat interval
  function gracefulExit() {
    console.log('👋  Graceful shutdown…');
    // 1. Tell strategyLauncher we’re shutting down
    const { runningProcesses } = require('./services/utils/strategy_utils/activeStrategyTracker');
    for (const meta of Object.values(runningProcesses)) {
      try {
        meta.proc.kill('SIGINT');
      } catch {}
    }
    // 2. Clear heartbeat interval
    if (wsPingInterval) {
      clearInterval(wsPingInterval);
      wsPingInterval = null;
    }
    // 3. Close WS & HTTP server
    wss.close(() => {
      server.close(() => {
        console.log('✅  HTTP/WS closed – exiting.');
        process.exit(0);
      });
    });
    // 4. Failsafe exit after 3 s
    setTimeout(() => process.exit(1), 3000);
  }
  STOP_SIGNALS.forEach((sig) => process.once(sig, gracefulExit));

  /**
   * WebSocket connection for real‑time logs
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

  wss.on('connection', (ws, req) => {
    // Reject WS from disallowed origins (same allow‑list as HTTP CORS)
    const origin = (req.headers.origin || '').trim();
    if (ALLOW_ORIGINS.length && origin && !ALLOW_ORIGINS.includes(origin)) {
      try { ws.close(1008, 'origin not allowed'); } catch {}
      return;
    }

    ws.isAlive = true;
    wsHealth.connections++;
    clients.add(ws);
    console.log('🧠 LogsConsole connected via WebSocket');

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', () => {
      wsHealth.disconnections++;
      clients.delete(ws);
      console.log('🔌 WebSocket disconnected');

      // Record the disconnect for Prometheus and log ratio breaches.  A safe
      // ratio is computed relative to the number of connections seen so far.
      try {
        metrics.recordWsDisconnect(wsHealth.connections, wsHealth.disconnections);
      } catch (e) {
        // ignore if metrics disabled or unavailable
      }
    });
  });

  // Heartbeat interval: ping clients every 30s and terminate if no pong
  wsPingInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        // No pong received since last check → terminate
        wsHealth.disconnections++;
        console.warn('⚠️  Terminating stale WebSocket client');
        try {
          ws.terminate();
        } catch (err) {
          console.warn('⚠️  Failed to terminate stale client:', err.message);
        }

        // Update metrics for the stale disconnect
        try {
          metrics.recordWsDisconnect(wsHealth.connections, wsHealth.disconnections);
        } catch {}
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (e) {
        // if ping fails the socket will be closed on next iteration
        console.warn('⚠️  Failed to ping client:', e.message);
      }
    }
  }, 30_000);

  // Launch cron jobs with concurrency guards
  const safeRunDaily = wrapCronJob('runDaily', runDaily);
  const safeRunMonthly = wrapCronJob('runMonthly', runMonthly);
  const safePruneAndRoll = wrapCronJob('pruneAndRoll', async () => {
    const { pruneAndRoll } = require('./services/utils/analytics/tradeRetention');
    await pruneAndRoll();
  });
  // Schedule daily job at midnight PT
  cron.schedule('0 0 * * *', safeRunDaily, { timezone: 'America/Los_Angeles' });
  // Schedule monthly job at 00:05 PT on the first of each month
  cron.schedule('5 0 1 * *', safeRunMonthly, { timezone: 'America/Los_Angeles' });
  // Safety prune every night at 00:05 PT
  cron.schedule('5 0 * * *', safePruneAndRoll, { timezone: 'America/Los_Angeles' });

  // Launch server
  server.listen(PORT, () => {
    console.log(`🧠 Bot controller API + WS running @ http://localhost:${PORT}`);
    startBackgroundJobs();
    // Restore scheduled jobs and arm limit-price watchers
    require('./services/utils/strategy_utils/scheduler/strategyScheduler');
  });
}