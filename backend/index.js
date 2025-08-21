/**
 * index.js - Dual-mode bot controller: CLI launcher or Express + WebSocket server.
 *
 * SUPER-DESCRIPTIVE DIAGNOSTICS added for WebSocket path/origin/heartbeat issues:
 *   • Boot-time WS config print (PORT, WS_PATH, origin policy, allow-list)
 *   • Connection logs include origin, URL path, remoteAddress, x-forwarded-for
 *   • Broadcast bridge logs type + sample of payload, and recipient count
 *   • Close/error logs include code + reason + human meaning
 *   • Heartbeat reports culled clients and totals
 *
 * Toggle verbosity (defaults ON):
 *   WS_VERBOSE=0   -> silence noisy info logs
 *   WS_ALLOW_ANY_ORIGIN=true (dev) bypasses origin allow-list
 *
 * What changed vs your previous new version
 *  - Added detailed logging around WS bootstrap, connection lifecycle, and broadcast path.
 *  - No behavioral change to message contract (still relays payload as-is).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Load metrics instrumentation early (Prisma middleware, etc.)
const metrics = require('./utils/metrics');

const express = require('express');
const cookieParser = require('cookie-parser');
const http = require('http');
const { WebSocketServer } = require('ws');
const { monitorEventLoopDelay } = require('perf_hooks');
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
const { startNetworthCron } = require('./services/utils/analytics/netWorthSnapshot'); // referenced in background jobs
const cron = require('node-cron');
const { runDaily, runMonthly } = require('./services/utils/analytics/tradeRetention');
const { startWatchdog } = require('./services/utils/strategy_utils/strategyWatchdog'); // side-effects on import
const { injectBroadcast } = require('./services/strategies/logging/strategyLogger');
require('./loadEnv');
const { ensureCsrfSeed, csrfProtection } = require('./middleware/csrf');

// Unified metrics flag
const METRICS_ENABLED = String(process.env.METRICS_ENABLED || '').trim().toLowerCase() === 'true';

// Verbose switch (default ON for forensic phase)
const WS_VERBOSE = false;
function vinfo(...args) { if (WS_VERBOSE) console.info('[WS]', ...args); }

// ----------------------------------------------------------------------------
// Global process-level error handling
validateEnv();

process.on('uncaughtException', (err) => {
  try { logger.error('Uncaught Exception:', err); } catch {}
  console.error('[fatal] uncaughtException:', err?.stack || err);
});
process.on('unhandledRejection', (reason) => {
  try { logger.error('Unhandled Rejection:', reason); } catch {}
  console.error('[fatal] unhandledRejection:', reason);
});

// Initialise strategy scheduler early
const { init } = require('./services/utils/strategy_utils/scheduler/strategyScheduler');
init();

// Determine CLI mode vs server mode from argv
const modeFromCLI = process.argv[2];

// Helper to wrap cron jobs in a mutex
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
      const wallet = loadKeypair();
      const balance = await connection.getBalance(wallet.publicKey);
      console.log(`Wallet: ${wallet.publicKey.toBase58()}`);
      console.log(`Balance: ${balance / 1e9} SOL`);

      if (!strategies[modeFromCLI]) {
        console.error(`❌ Invalid mode: ${modeFromCLI}`);
        console.log(`✅ Available modes: ${Object.keys(strategies).join(', ')}`);
        process.exit(1);
      }

      console.log(`🚀 Starting ${modeFromCLI} strategy…`);
      strategies[modeFromCLI]();
    } catch (err) {
      console.error('❌ Error loading wallet or fetching balance:', err.message);
    }
  })();
} else {
  // ────────────────── Express + WebSocket Server Mode ────────────────────
  ['SIGINT', 'SIGTERM', 'SIGUSR2'].forEach((sig) =>
    process.once(sig, () => {
      const { runningProcesses } = require('./services/utils/strategy_utils/activeStrategyTracker');
      for (const botId in runningProcesses) {
        try { runningProcesses[botId].proc.kill('SIGTERM'); } catch (e) {
          console.warn(`Failed to kill bot ${botId}:`, e.message);
        }
      }
      process.exit();
    })
  );

  const app = express();

  // Disable ETag validators on /api
  app.set('etag', false);

  // Risk engine kill relay (best-effort)
  try {
    const riskEngine = require('./services/riskEngine');
    const { sendNotification } = require('./services/notifications');
    riskEngine.on('kill', ({ userId, reason }) => {
      try { sendNotification(userId, 'RISK_KILL', { message: `Trading disabled: ${reason}` }); } catch (err) {
        logger.error('Failed to send risk kill notification', { err: err.message });
      }
    });
  } catch {}

  // Security & platform middleware
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestId);
  app.use(securityHeaders());

  // CORS (credentials enabled inside createCors)
  app.use(createCors());
  app.options('*', createCors());

  // Rate limiting
  const globalLimiter = createRateLimiter({
    skip: (req) => req.originalUrl === '/api/payment/webhook',
  });
  app.use(globalLimiter);
  app.use('/api/auth', authLimiter);

  // JSON parsing with 100kb limit (skip Stripe webhook)
  app.use((req, res, next) => {
    if (req.originalUrl === '/api/payment/webhook') return next();
    return express.json({ limit: '100kb' })(req, res, next);
  });

  // Cookies + CSRF (double-submit cookie)
  app.use(cookieParser());
  app.use(ensureCsrfSeed);
  app.use(csrfProtection);

  // DDoS guard rails
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

  // Metrics
  if (METRICS_ENABLED) {
    app.use(metrics.httpMetricsMiddleware);
  }

  // Health endpoints
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/ready', (_req, res) => res.status(200).json({ status: 'ready' }));

  // /metrics (guarded by METRICS_ENABLED)
  if (METRICS_ENABLED) {
    app.get('/metrics', metrics.metricsEndpoint);
  }

  // API router
  let apiRouter = null;
  try {
    console.log('[boot] loading API router…');
    apiRouter = require('./api');
    console.log('[boot] API router loaded ✅');
  } catch (e) {
    console.error('[boot] Failed to load API router:', e?.stack || e);
  }
  let currentModeProcess = null;
  if (apiRouter) {
    app.use(
      '/api',
      (req, _res, next) => {
        req.currentModeProcess = currentModeProcess;
        req.setModeProcess = (proc) => { currentModeProcess = proc; };
        next();
      },
      apiRouter
    );
  } else {
    app.use('/api', (_req, res) => res.status(503).json({ error: 'API_BOOT_FAILED' }));
  }

  // Error handler (last)
  app.use(errorHandler);

  // ───────────────────────── HTTP + WS server ────────────────────────────
  const PORT = process.env.PORT || 5001;
  const server = http.createServer(app);

  const WS_PATH = process.env.WS_PATH || '/ws/logs';
  const wss = new WebSocketServer({ server, path: WS_PATH });

  const WS_ALLOW_ANY_ORIGIN = String(process.env.WS_ALLOW_ANY_ORIGIN || '')
    .trim().toLowerCase() === 'true';

  const ALLOW_ORIGINS = new Set(
    (process.env.CORS_ORIGINS || process.env.DEV_CORS_ORIGIN || '')
      .split(',').map(s => s.trim()).filter(Boolean)
  );

  // Boot-time config print
  (function printWsBootConfig() {
    vinfo('boot', {
      PORT,
      WS_PATH,
      WS_ALLOW_ANY_ORIGIN,
      ALLOW_ORIGINS: Array.from(ALLOW_ORIGINS),
      NODE_ENV: process.env.NODE_ENV,
    });
    if (!WS_ALLOW_ANY_ORIGIN && ALLOW_ORIGINS.size === 0) {
      console.warn('[WS] No allowed origins configured. In dev you can set WS_ALLOW_ANY_ORIGIN=true or CORS_ORIGINS=http://localhost:5173');
    }
  })();

  // Heartbeat / metrics
  let wsPingInterval;
  const wsHealth = { connections: 0, disconnections: 0, culled: 0 };

  // Broadcast bridge
  const clients = new Set();
  function shortSample(v) {
    try {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return s.length > 240 ? s.slice(0, 240) + '…' : s;
    } catch { return String(v).slice(0, 240); }
  }
  injectBroadcast((line) => {
    const type = typeof line;
    const msg = shortSample(line);
    vinfo('broadcast', { type, len: (msg || '').length, sample: msg });
    let sent = 0;
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        try { client.send(line); sent++; } catch (e) {
          console.warn('[WS] failed to send to a client:', e?.message);
        }
      }
    }
    vinfo('broadcast result', { recipients: clients.size, delivered: sent });
  });

  function meaningForCloseCode(code) {
    const map = {
      1000: 'normal',
      1001: 'going away',
      1002: 'protocol error',
      1003: 'unsupported data',
      1005: 'no status',
      1006: 'abnormal close (handshake drop)',
      1007: 'invalid payload',
      1008: 'policy violation (likely origin/CORS)',
      1009: 'message too big',
      1010: 'mandatory extension',
      1011: 'internal error',
      1012: 'service restart',
      1013: 'try again later',
      1015: 'TLS handshake failure',
    };
    return map[code] || 'unknown';
  }

  wss.on('connection', (ws, req) => {
    const origin = (req.headers.origin || '').trim();
    const xff = (req.headers['x-forwarded-for'] || '').toString();
    const remote = req.socket?.remoteAddress || req.connection?.remoteAddress;

    if (WS_VERBOSE) console.log('[WS] connection', { origin, path: req.url, xff, remote });

    if (!WS_ALLOW_ANY_ORIGIN && ALLOW_ORIGINS.size && origin && !ALLOW_ORIGINS.has(origin)) {
      if (WS_VERBOSE) console.warn('[WS] closing – origin not allowed:', origin,
        'allowed:', Array.from(ALLOW_ORIGINS));
      try { ws.close(1008, 'origin not allowed'); } catch {}
      return;
    }

    ws.isAlive = true;
    wsHealth.connections++;
    clients.add(ws);
    if (WS_VERBOSE) console.log('🧠 LogsConsole connected via WebSocket (total clients:', clients.size, ')');

    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (buf) => {
      // Usually clients don't send, but log if they do.
      try {
        const s = buf.toString();
        vinfo('client->server message', { len: s.length, sample: shortSample(s) });
      } catch {}
    });
    ws.on('close', (code, reasonBuf) => {
      const reason = Buffer.isBuffer(reasonBuf) ? reasonBuf.toString() : String(reasonBuf || '');
      wsHealth.disconnections++;
      clients.delete(ws);
      if (WS_VERBOSE) console.warn('🔌 WebSocket disconnected', { code, meaning: meaningForCloseCode(code), reason, remaining: clients.size });
      try { metrics.recordWsDisconnect(wsHealth.connections, wsHealth.disconnections); } catch {}
    });
    ws.on('error', (err) => {
      if (WS_VERBOSE) console.error('[WS] socket error:', err?.message || err);
    });
  });

  wss.on('error', (err) => {
    if (WS_VERBOSE) console.error('[WS] server error:', err?.message || err);
  });

  // Heartbeat every 30s
  wsPingInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        wsHealth.disconnections++;
        wsHealth.culled++;
        if (WS_VERBOSE) console.warn('⚠️  Terminating stale WebSocket client');
        try { ws.terminate(); } catch (err) {
          if (WS_VERBOSE) console.warn('⚠️  Failed to terminate stale client:', err.message);
        }
        try { metrics.recordWsDisconnect(wsHealth.connections, wsHealth.disconnections); } catch {}
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) {
        if (WS_VERBOSE) console.warn('⚠️  Failed to ping client:', e.message);
      }
    }
    vinfo('heartbeat', {
      clients: wss.clients.size,
      health: wsHealth,
    });
  }, 30_000);

  // Graceful shutdown
  const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGUSR2'];
  function gracefulExit() {
    console.log('👋  Graceful shutdown…');
    const { runningProcesses } = require('./services/utils/strategy_utils/activeStrategyTracker');
    for (const meta of Object.values(runningProcesses)) {
      try { meta.proc.kill('SIGINT'); } catch {}
    }
    if (wsPingInterval) { clearInterval(wsPingInterval); wsPingInterval = null; }
    wss.close(() => {
      server.close(() => {
        console.log('✅  HTTP/WS closed – exiting.');
        process.exit(0);
      });
    });
    setTimeout(() => process.exit(1), 3000);
  }
  STOP_SIGNALS.forEach((sig) => process.once(sig, gracefulExit));

  // ───────────────────────── Cron jobs ─────────────────────────
  const safeRunDaily = wrapCronJob('runDaily', runDaily);
  const safeRunMonthly = wrapCronJob('runMonthly', runMonthly);
  const safePruneAndRoll = wrapCronJob('pruneAndRoll', async () => {
    const { pruneAndRoll } = require('./services/utils/analytics/tradeRetention');
    await pruneAndRoll();
  });

  cron.schedule('0 0 * * *', safeRunDaily, { timezone: 'America/Los_Angeles' });
  cron.schedule('5 0 1 * *', safeRunMonthly, { timezone: 'America/Los_Angeles' });
  cron.schedule('5 0 * * *', safePruneAndRoll, { timezone: 'America/Los_Angeles' });

  // ───────────────────────── Start server ──────────────────────
  server.listen(PORT, () => {
    console.log(`🧠 Bot controller API + WS running @ http://localhost:${PORT}${WS_PATH}`);
    vinfo('server ready', { PORT, WS_PATH, ALLOW_ORIGINS: Array.from(ALLOW_ORIGINS), WS_ALLOW_ANY_ORIGIN });
    try {
      console.log('[boot] loading background jobs…');
      const { startBackgroundJobs } = require('./services/backgroundJobs');
      startBackgroundJobs();
      console.log('[boot] background jobs started ✅');
    } catch (e) {
      console.error('[boot] Failed to start background jobs:', e?.stack || e);
    }
    // Restore scheduled jobs and arm watchers
    require('./services/utils/strategy_utils/scheduler/strategyScheduler');
  });
}