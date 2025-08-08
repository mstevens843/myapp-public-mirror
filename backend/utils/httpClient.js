// copied from backend/utils/httpClient.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const axios = require('axios');
const circuitBreaker = require('./circuitBreaker');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpClient(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('httpClient options must be an object');
  }
  const {
    url,
    method = 'get',
    params,
    data,
    headers,
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
  while (true) {
    try {
      circuitBreaker.before(ck);
    } catch (err) {
      throw err;
    }
    try {
      const response = await axios({
        url,
        method,
        params,
        data,
        headers,
        timeout: finalTimeout,
        ...rest,
      });
      circuitBreaker.success(ck);
      return response;
    } catch (err) {
      lastError = err;
      circuitBreaker.fail(ck);
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