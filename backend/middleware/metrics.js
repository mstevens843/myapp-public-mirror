/*
 * Prometheus metrics instrumentation and middleware.
 *
 * This module defines a shared `prom-client` registry along with a set of
 * counters, histograms and gauges used throughout the backend.  It also
 * exposes an Express middleware (`httpMetricsMiddleware`) that measures
 * request latency and status codes for each incoming request.  Utility
 * functions are provided to record circuit breaker events, cache hits/misses,
 * strategy loop durations, queue depths and WebSocket disconnect ratios.
 *
 * The `metricsEndpoint` handler implements a secure `/metrics` endpoint.  It
 * respects two environment variables:
 *
 * - `METRICS_API_KEY` – when set, clients must supply a matching
 *   `x-api-key` header to access metrics.
 * - `METRICS_ALLOW_IPS` – optional comma‑separated list of CIDR blocks or
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

// Count non‑2xx HTTP responses.  Useful for alerting on error budgets.
const httpErrorsTotal = new promClient.Counter({
  name: 'http_errors_total',
  help: 'Total number of non‑2xx HTTP responses',
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
// Ratio gauge: fraction of calls short‑circuited by the circuit breaker per
// service.  This is updated by the calling code based on counts kept
// elsewhere; the gauge holds a value between 0 and 1.
const breakerOpenRatio = new promClient.Gauge({
  name: 'breaker_open_ratio',
  help: 'Ratio of calls short‑circuited by the circuit breaker',
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
// Queue depth gauge: used for jobs/strategy loops.  Label `name` identifies
// the queue or subsystem being measured.  The gauge should be set to
// reflect the current queue length whenever it changes.
const queueDepth = new promClient.Gauge({
  name: 'queue_depth',
  help: 'Current depth of job or strategy queues',
  labelNames: ['name'],
});

// -------------------------------------------------------------------------
// WebSocket disconnect ratio gauge: records the ratio of disconnected
// clients to total connections seen.  This metric aids in detecting
// connection churn issues.
const wsDisconnectRatio = new promClient.Gauge({
  name: 'ws_disconnect_ratio',
  help: 'Ratio of WebSocket disconnections to connections',
});

// Register all custom metrics on our registry
register.registerMetric(httpRequestsTotal);
register.registerMetric(httpErrorsTotal);
register.registerMetric(httpRequestDurationSeconds);
register.registerMetric(strategyLoopDurationSeconds);
register.registerMetric(circuitOpenTotal);
register.registerMetric(circuitHalfOpenTotal);
register.registerMetric(circuitClosedTotal);
register.registerMetric(breakerOpenRatio);
register.registerMetric(cacheHitsTotal);
register.registerMetric(cacheMissesTotal);
register.registerMetric(cacheHitRatio);
register.registerMetric(queueDepth);
register.registerMetric(wsDisconnectRatio);

// -------------------------------------------------------------------------
// External HTTP client metrics
//
// Histograms and counters for outbound HTTP calls made via the shared
// httpClient wrapper.  These metrics allow monitoring of latency and
// error rates when talking to third party APIs such as Birdeye or
// Jupiter.  Labelled by `service` which maps to the hostname and by
// `status` which is either a numeric HTTP status code or the error
// code thrown by axios (e.g. ECONNABORTED).
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

register.registerMetric(externalRequestDurationSeconds);
register.registerMetric(externalRequestsTotal);
register.registerMetric(externalErrorsTotal);

// -------------------------------------------------------------------------
// Helper: parse client IP from request.  If `X-Forwarded-For` is present
// honour the first entry (client’s original IP).  Fallback to
// `req.connection.remoteAddress`.  IPv6 addresses may be enclosed in
// brackets; strip those for comparison.
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  const ip = Array.isArray(xff) ? xff[0] : xff ? xff.split(',')[0] : req.connection?.remoteAddress || '';
  return ip.replace(/^\[/, '').replace(/\]$/, '');
}

// Helper: determine if a given IPv4 address falls within a CIDR block.
// Supports exact IP matches (e.g. "127.0.0.1") and CIDRs like "192.168.0.0/16".
function ipInCidr(ip, cidr) {
  if (!cidr) return false;
  // Exact match
  if (!cidr.includes('/')) {
    return ip === cidr;
  }
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

/**
 * Express middleware to record metrics for every HTTP request.  This
 * middleware must be registered before any route handlers so that it can
 * observe the status code on `res.finish`.  The route label uses
 * `req.route?.path` when available (Express sets this when the route
 * matches) otherwise falls back to `req.path`.
 */
function httpMetricsMiddleware(req, res, next) {
  const route = req.route && req.route.path ? req.route.path : req.path || 'unknown';
  // Start a timer with partial labels; we will supply final labels on end
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
 * IP allow‑list checks before returning Prometheus formatted metrics.
 * If the request fails authentication or authorisation a 403 is returned.
 * When metrics collection itself errors a 500 is returned with the
 * error message included in the body for observability.
 */
async function metricsEndpoint(req, res) {
  // Authentication: if an API key is configured require the header
  const expectedKey = process.env.METRICS_API_KEY;
  if (expectedKey && expectedKey.length > 0) {
    const provided = req.headers['x-api-key'];
    if (!provided || String(provided) !== String(expectedKey)) {
      return res.status(403).send('Forbidden');
    }
  }
  // Authorisation: check allow list if present
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
// Metric update helpers used throughout the codebase

/**
 * Record a strategy loop duration.  Accepts milliseconds and converts
 * internally to seconds.  Additional labels can be added in the future.
 *
 * @param {string} strategy The strategy name or identifier
 * @param {number} durationMs The loop duration in milliseconds
 */
function recordStrategyLoop(strategy, durationMs) {
  const seconds = durationMs / 1000;
  strategyLoopDurationSeconds.observe({ strategy }, seconds);
}

/**
 * Record a circuit breaker state transition.  Accepts the event
 * (`open`, `half_open`, `close`) and the service key.  Counters are
 * incremented accordingly.  Note: call sites should also update the
 * breaker open ratio gauge separately based on total call counts.
 *
 * @param {string} event One of "open", "half_open", "close"
 * @param {string} service The service key/host associated with the breaker
 */
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

/**
 * Update the breaker open ratio gauge.  Callers should compute the ratio
 * externally as `openCalls / totalCalls` and supply it here.  The gauge
 * value should be between 0 and 1.  When `totalCalls` is zero the ratio
 * should be set to 0.
 *
 * @param {string} service The service key/host associated with the breaker
 * @param {number} ratio   A number between 0 and 1
 */
function updateBreakerOpenRatio(service, ratio) {
  breakerOpenRatio.set({ service }, ratio);
}

/**
 * Record a cache hit for a given namespace.  Also updates the hit ratio
 * gauge based on current hit and miss counts.  The namespace should
 * uniquely identify the logical cache (e.g. "price", "tokenList").
 *
 * @param {string} cache The cache namespace
 */
function recordCacheHit(cache) {
  cacheHitsTotal.inc({ cache });
  updateCacheHitRatio(cache);
}

/**
 * Record a cache miss for a given namespace.  Also updates the hit ratio
 * gauge based on current hit and miss counts.
 *
 * @param {string} cache The cache namespace
 */
function recordCacheMiss(cache) {
  cacheMissesTotal.inc({ cache });
  updateCacheHitRatio(cache);
}

function updateCacheHitRatio(cache) {
  const hits = cacheHitsTotal.hashMap[`cache:${cache}`] || 0;
  const misses = cacheMissesTotal.hashMap[`cache:${cache}`] || 0;
  const total = hits + misses;
  const ratio = total === 0 ? 0 : hits / total;
  cacheHitRatio.set({ cache }, ratio);
}

/**
 * Set the queue depth for a given queue name.  Should be called
 * whenever the number of pending jobs changes (e.g. on enqueue and
 * dequeue).  Passing `undefined` or `null` for `depth` clears the
 * metric.
 *
 * @param {string} name  Identifier for the queue
 * @param {number} depth Current depth of the queue
 */
function setQueueDepth(name, depth) {
  if (typeof depth === 'number' && depth >= 0) {
    queueDepth.set({ name }, depth);
  }
}

/**
 * Record the ratio of WebSocket disconnections to total connections.
 * The caller should supply the counts; this function calculates the
 * ratio and sets the gauge.  When `totalConnections` is zero the
 * ratio will be set to 0 to avoid division by zero.
 *
 * @param {number} totalConnections   Total number of connections ever seen
 * @param {number} totalDisconnections Total number of disconnections seen
 */
function recordWsDisconnect(totalConnections, totalDisconnections) {
  const ratio = totalConnections > 0 ? totalDisconnections / totalConnections : 0;
  wsDisconnectRatio.set(ratio);
}

/**
 * Record an external HTTP request.  Accepts the service (hostname),
 * the resulting status (HTTP status code or error code) and the
 * duration in milliseconds.  Increments request and error counters
 * accordingly and observes the latency histogram.
 *
 * @param {string} service Hostname or service name
 * @param {string|number} status HTTP status code or error code string
 * @param {number} durationMs Duration in milliseconds
 * @param {boolean} [error] Flag indicating if the request failed
 */
function recordExternalRequest(service, status, durationMs, error = false) {
  const seconds = durationMs / 1000;
  externalRequestDurationSeconds.observe({ service }, seconds);
  externalRequestsTotal.inc({ service, status: String(status) });
  if (error) {
    externalErrorsTotal.inc({ service, status: String(status) });
  }
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
};