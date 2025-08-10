// Instrumented HTTP client wrapper built on top of axios and the
// application circuit breaker.  This version records latency and
// success/failure metrics via the shared Prometheus registry and adds
// the `X-Request-Id` header to outbound requests when available.  It
// retains the original retry and circuit breaker semantics present in
// the uninstrumented implementation.

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const circuitBreaker = require('./circuitBreaker');
const metrics = require('./metrics');
const { getReqId } = require('./requestContext');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform an HTTP request with retry and circuit breaker support.  The
 * options object mirrors the axios configuration with a few additional
 * fields.  Metrics are recorded for each attempt, including latency and
 * success/error counts grouped by hostname and status.
 *
 * @param {object} opts Options describing the request (url, method, params, data, headers, timeout, retries, retryDelay, circuitKey)
 * @returns {Promise<import('axios').AxiosResponse>} The axios response
 */
async function httpClient(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('httpClient options must be an object');
  }
  const {
    url,
    method = 'get',
    params,
    data,
    headers = {},
    timeout,
    retries,
    retryDelay,
    circuitKey,
    ...rest
  } = opts;
  if (!url) {
    throw new Error('httpClient: `url` is required');
  }
  const defaultTimeout = parseInt(process.env.HTTP_CLIENT_TIMEOUT_MS || '6000', 10);
  const maxRetries = parseInt(process.env.HTTP_CLIENT_RETRIES || '2', 10);
  const baseDelay = parseInt(process.env.HTTP_CLIENT_RETRY_DELAY_MS || '200', 10);
  const finalTimeout = timeout != null ? timeout : defaultTimeout;
  const finalRetries = retries != null ? retries : maxRetries;
  const finalRetryDelay = retryDelay != null ? retryDelay : baseDelay;
  let attempt = 0;
  let lastError;
  let ck = circuitKey;
  if (!ck) {
    try {
      const u = new URL(url);
      ck = u.hostname;
    } catch (_) {
      ck = 'default';
    }
  }
  // Determine the service name for metrics (hostname without port)
  let service;
  try {
    service = new URL(url).hostname;
  } catch {
    service = 'unknown';
  }
  while (true) {
    try {
      circuitBreaker.before(ck);
    } catch (err) {
      // Circuit breaker denies the request.  Record as an error with a
      // pseudo status of 'SHORT_CIRCUIT'.
      metrics.recordExternalRequest(service, 'SHORT_CIRCUIT', 0, true);
      throw err;
    }
    const startTime = Date.now();
    try {
      // Propagate the current request ID when present.  Only set the
      // header if not already defined by the caller.  This allows
      // consumers to override the ID when needed.
      const reqId = getReqId();
      const outboundHeaders = { ...headers };
      if (reqId && !outboundHeaders['X-Request-Id']) {
        outboundHeaders['X-Request-Id'] = reqId;
      }
      const response = await axios({
        url,
        method,
        params,
        data,
        headers: outboundHeaders,
        timeout: finalTimeout,
        ...rest,
      });
      const duration = Date.now() - startTime;
      circuitBreaker.success(ck);
      metrics.recordExternalRequest(service, response.status, duration, false);
      return response;
    } catch (err) {
      const duration = Date.now() - startTime;
      lastError = err;
      circuitBreaker.fail(ck);
      // Determine a status code or error code for metrics.  Axios
      // populates `err.response` for non-2xx responses; network errors
      // set `err.code` (e.g. ECONNABORTED).
      const status = err.response?.status || err.code || 'ERROR';
      metrics.recordExternalRequest(service, status, duration, true);
      const isRetriable = !err.response || err.code === 'ECONNABORTED' || err.code === 'ECONNRESET' || err.code === 'ENOTFOUND';
      if (attempt >= finalRetries || !isRetriable) {
        break;
      }
      attempt += 1;
      const jitter = Math.random() * finalRetryDelay;
      const delay = finalRetryDelay * Math.pow(2, attempt - 1) + jitter;
      await sleep(delay);
      continue;
    }
  }
  throw lastError;
}

module.exports = httpClient;