/*
 * backend/middleware/metrics.js
 *
 * Prometheus metrics instrumentation and middleware.
 *
 * This module defines a shared `prom-client` registry along with a set of
 * counters, histograms and gauges used throughout the backend.  It also
 * exposes an Express middleware (`httpMetricsMiddleware`) that measures
 * request latency and status codes for each incoming request.  Utility
 * functions are provided to record circuit breaker events, cache hits/misses,
 * strategy loop durations, queue depths and WebSocket disconnect ratios.
 *
 * Added (non-breaking):
 *  - Trade lifecycle counters: trades_opened_total, trades_closed_total,
 *    trade_exit_reasons_total{reason}.
 *  - Security counters: rate_limit_hits_total, csrf_denials_total,
 *    idempotency_replays_total.
 *  - Helper functions to bump those counters.
 *
 * The `metricsEndpoint` handler implements a secure `/metrics` endpoint.  It
 * respects two environment variables:
 *
 * - `METRICS_API_KEY` – when set, clients must supply a matching
 *   `x-api-key` header to access metrics.
 * - `METRICS_ALLOW_IPS` – optional comma-separated list of CIDR blocks or
 *   bare IP addresses allowed to scrape metrics.  If provided the remote
 *   address must fall within one of the CIDRs.  IPv4 addresses only are
 *   supported; IPv6 will be rejected unless a trivial exact match is used.
 */

const promClient = require('prom-client');

// Create a separate registry rather than using the default global
// registry.  This prevents accidental leakage of metrics from other
// libraries and allows us to control which metrics are exported.
const register = new promClient.Registry();

// Collect default Node.js metrics (heap usage, event loop lag, etc.).  This
// call registers default gauges/counters on our registry.  Set a prefix to
// avoid clashes with user defined metrics.
promClient.collectDefaultMetrics({ register, prefix: 'node_' });

// -------------------------------------------------------------------------
// HTTP server metrics
//
// Count total HTTP requests by route, method and status code.  Use
// `req.path` rather than `req.originalUrl` so that query strings are
// stripped and dynamic segments collapse (e.g. `/api/orders/:id` will
// register as `/api/orders/:id` if defined in Express router).
const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests served',
  labelNames: ['route', 'method', 'status'],
});

// Count non-2xx HTTP responses.  Useful for alerting on error budgets.
const httpErrorsTotal = new promClient.Counter({
  name: 'http_errors_total',
  help: 'Total number of non-2xx HTTP responses',
  labelNames: ['route', 'method', 'status'],
});

// Histogram of request durations in seconds.  Use custom buckets tuned for
// typical API response times.  Very high latency outliers will fall into
// the last bucket.
const httpRequestDurationSeconds = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency histogram (seconds)',
  labelNames: ['route', 'method'],
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});

// -------------------------------------------------------------------------
// Strategy loop metrics
const strategyLoopDurationSeconds = new promClient.Histogram({
  name: 'strategy_loop_duration_seconds',
  help: 'Duration of strategy loop iterations (seconds)',
  labelNames: ['strategy'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});

// -------------------------------------------------------------------------
// Circuit breaker metrics
const circuitOpenTotal = new promClient.Counter({
  name: 'circuit_open_total',
  help: 'Number of times a circuit transitioned to OPEN state',
  labelNames: ['service'],
});
const circuitHalfOpenTotal = new promClient.Counter({
  name: 'circuit_half_open_total',
  help: 'Number of times a circuit transitioned to HALF_OPEN state',
  labelNames: ['service'],
});
const circuitClosedTotal = new promClient.Counter({
  name: 'circuit_closed_total',
  help: 'Number of times a circuit transitioned to CLOSED state',
  labelNames: ['service'],
});
// Ratio gauge: fraction of calls short-circuited by the circuit breaker per
// service.  This is updated by the calling code based on counts kept
// elsewhere; the gauge holds a value between 0 and 1.
const breakerOpenRatio = new promClient.Gauge({
  name: 'breaker_open_ratio',
  help: 'Ratio of calls short-circuited by the circuit breaker',
  labelNames: ['service'],
});

// -------------------------------------------------------------------------
// Cache metrics
const cacheHitsTotal = new promClient.Counter({
  name: 'cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['cache'],
});
const cacheMissesTotal = new promClient.Counter({
  name: 'cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['cache'],
});
const cacheHitRatio = new promClient.Gauge({
  name: 'cache_hit_ratio',
  help: 'Cache hit ratio (hits / (hits + misses))',
  labelNames: ['cache'],
});

// -------------------------------------------------------------------------
// Queue depth gauge
const queueDepth = new promClient.Gauge({
  name: 'queue_depth',
  help: 'Current depth of job or strategy queues',
  labelNames: ['name'],
});

// -------------------------------------------------------------------------
// WebSocket disconnect ratio gauge
const wsDisconnectRatio = new promClient.Gauge({
  name: 'ws_disconnect_ratio',
  help: 'Ratio of WebSocket disconnections to connections',
});

// -------------------------------------------------------------------------
// External HTTP client metrics
const externalRequestDurationSeconds = new promClient.Histogram({
  name: 'external_request_duration_seconds',
  help: 'Duration of external HTTP requests (seconds)',
  labelNames: ['service'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});
const externalRequestsTotal = new promClient.Counter({
  name: 'external_requests_total',
  help: 'Total number of external HTTP requests',
  labelNames: ['service', 'status'],
});
const externalErrorsTotal = new promClient.Counter({
  name: 'external_errors_total',
  help: 'Total number of failed external HTTP requests',
  labelNames: ['service', 'status'],
});

// -------------------------------------------------------------------------
// Trade lifecycle metrics (added, non-breaking)
const tradesOpenedTotal = new promClient.Counter({
  name: 'trades_opened_total',
  help: 'Total number of trades opened',
});
const tradesClosedTotal = new promClient.Counter({
  name: 'trades_closed_total',
  help: 'Total number of trades closed',
});
const exitsTotal = new promClient.Counter({
  name: 'trade_exit_reasons_total',
  help: 'Total number of trade exits by reason',
  labelNames: ['reason'],
});

// -------------------------------------------------------------------------
// Security metrics (added, non-breaking)
const rateLimitHitsTotal = new promClient.Counter({
  name: 'rate_limit_hits_total',
  help: 'Total number of HTTP requests rejected by rate limiting',
});
const csrfDenialsTotal = new promClient.Counter({
  name: 'csrf_denials_total',
  help: 'Total number of requests denied due to CSRF token mismatch',
});
const idempotencyReplaysTotal = new promClient.Counter({
  name: 'idempotency_replays_total',
  help: 'Total number of idempotent requests replayed from cache',
});

// Register all custom metrics on our registry
[
  httpRequestsTotal,
  httpErrorsTotal,
  httpRequestDurationSeconds,
  strategyLoopDurationSeconds,
  circuitOpenTotal,
  circuitHalfOpenTotal,
  circuitClosedTotal,
  breakerOpenRatio,
  cacheHitsTotal,
  cacheMissesTotal,
  cacheHitRatio,
  queueDepth,
  wsDisconnectRatio,
  externalRequestDurationSeconds,
  externalRequestsTotal,
  externalErrorsTotal,
  tradesOpenedTotal,
  tradesClosedTotal,
  exitsTotal,
  rateLimitHitsTotal,
  csrfDenialsTotal,
  idempotencyReplaysTotal,
].forEach((m) => register.registerMetric(m));

/**
 * Express middleware to record metrics for every HTTP request.  This
 * middleware must be registered before any route handlers so that it can
 * observe the status code on `res.finish`.  The route label uses
 * `req.route?.path` when available (Express sets this when the route
 * matches) otherwise falls back to `req.path`.
 */
function httpMetricsMiddleware(req, res, next) {
  const route = req.route && req.route.path ? req.route.path : req.path || 'unknown';
  const end = httpRequestDurationSeconds.startTimer({ route, method: req.method });
  res.on('finish', () => {
    const status = res.statusCode;
    httpRequestsTotal.inc({ route, method: req.method, status });
    if (status < 200 || status >= 300) {
      httpErrorsTotal.inc({ route, method: req.method, status });
    }
    end({ route, method: req.method });
  });
  next();
}

/**
 * Handler for the `/metrics` endpoint.  Performs optional API key and
 * IP allow-list checks before returning Prometheus formatted metrics.
 */
async function metricsEndpoint(req, res) {
  const expectedKey = process.env.METRICS_API_KEY;
  if (expectedKey && expectedKey.length > 0) {
    const provided = req.headers['x-api-key'];
    if (!provided || String(provided) !== String(expectedKey)) {
      return res.status(403).send('Forbidden');
    }
  }
  const allowList = (process.env.METRICS_ALLOW_IPS || '').split(',').map((cidr) => cidr.trim()).filter(Boolean);
  if (allowList.length) {
    const ip = getClientIp(req);
    const ok = allowList.some((cidr) => ipInCidr(ip, cidr));
    if (!ok) {
      return res.status(403).send('Forbidden');
    }
  }
  try {
    res.set('Content-Type', register.contentType);
    const payload = await register.metrics();
    res.status(200).end(payload);
  } catch (err) {
    res.status(500).end(`# Metrics collection failed: ${err.message}\n`);
  }
}

// -------------------------------------------------------------------------
// Helper: parse client IP from request.
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  const ip = Array.isArray(xff) ? xff[0] : xff ? xff.split(',')[0] : req.connection?.remoteAddress || '';
  return ip.replace(/^\[/, '').replace(/\]$/, '');
}

// Helper: determine if a given IPv4 address falls within a CIDR block.
// Supports exact IP matches (e.g. "127.0.0.1") and CIDRs like "192.168.0.0/16".
function ipInCidr(ip, cidr) {
  if (!cidr) return false;
  if (!cidr.includes('/')) return ip === cidr; // exact match
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const ipNum = ipToNumber(ip);
  const rangeNum = ipToNumber(range);
  const mask = bits === 0 ? 0 : (~0 >>> (32 - bits)) << (32 - bits);
  return (ipNum & mask) === (rangeNum & mask);
}

function ipToNumber(ip) {
  return ip.split('.').reduce((acc, oct) => ((acc << 8) + parseInt(oct, 10)) >>> 0, 0);
}

// -------------------------------------------------------------------------
// Metric update helpers used throughout the codebase

function recordStrategyLoop(strategy, durationMs) {
  const seconds = durationMs / 1000;
  strategyLoopDurationSeconds.observe({ strategy }, seconds);
}

function recordCircuitBreakerEvent(event, service) {
  switch (event) {
    case 'open':
      circuitOpenTotal.inc({ service });
      break;
    case 'half_open':
      circuitHalfOpenTotal.inc({ service });
      break;
    case 'close':
      circuitClosedTotal.inc({ service });
      break;
    default:
      break;
  }
}

function updateBreakerOpenRatio(service, ratio) {
  breakerOpenRatio.set({ service }, ratio);
}

function recordCacheHit(cache) {
  cacheHitsTotal.inc({ cache });
  updateCacheHitRatio(cache);
}

function recordCacheMiss(cache) {
  cacheMissesTotal.inc({ cache });
  updateCacheHitRatio(cache);
}

function updateCacheHitRatio(cache) {
  // Best-effort ratio using internal prom-client counters; if structure changes,
  // callers can set cacheHitRatio directly.
  const hits = cacheHitsTotal.hashMap?.[`cache:${cache}`]?.value || 0;
  const misses = cacheMissesTotal.hashMap?.[`cache:${cache}`]?.value || 0;
  const total = hits + misses;
  const ratio = total === 0 ? 0 : hits / total;
  cacheHitRatio.set({ cache }, ratio);
}

function setQueueDepth(name, depth) {
  if (typeof depth === 'number' && depth >= 0) {
    queueDepth.set({ name }, depth);
  }
}

function recordWsDisconnect(totalConnections, totalDisconnections) {
  const ratio = totalConnections > 0 ? totalDisconnections / totalConnections : 0;
  wsDisconnectRatio.set(ratio);
}

function recordExternalRequest(service, status, durationMs, error = false) {
  const seconds = durationMs / 1000;
  externalRequestDurationSeconds.observe({ service }, seconds);
  externalRequestsTotal.inc({ service, status: String(status) });
  if (error) {
    externalErrorsTotal.inc({ service, status: String(status) });
  }
}

// ---- Added helpers (non-breaking) ----------------------------------------

function recordTradeOpen() {
  tradesOpenedTotal.inc();
}

function recordTradeClosed() {
  tradesClosedTotal.inc();
}

/**
 * Record a trade exit.  Reason should be one of: smart-time, smart-volume,
 * smart-liquidity, lp-pull, authority-flip, or other.
 */
function recordExitReason(reason) {
  exitsTotal.inc({ reason });
}

function recordRateLimitHit() {
  rateLimitHitsTotal.inc();
}

function recordCsrfDenial() {
  csrfDenialsTotal.inc();
}

function recordIdempotencyReplay() {
  idempotencyReplaysTotal.inc();
}

module.exports = {
  register,
  httpMetricsMiddleware,
  metricsEndpoint,
  recordStrategyLoop,
  recordCircuitBreakerEvent,
  updateBreakerOpenRatio,
  recordCacheHit,
  recordCacheMiss,
  setQueueDepth,
  recordWsDisconnect,
  recordExternalRequest,

  // new exports (safe additions)
  recordTradeOpen,
  recordTradeClosed,
  recordExitReason,
  recordRateLimitHit,
  recordCsrfDenial,
  recordIdempotencyReplay,
};
