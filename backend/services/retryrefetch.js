/**
 * retryFetch – Resilient HTTP client with retries, backoff and timeout
 *
 * This utility wraps the native fetch API (or node-fetch if running on
 * versions of Node.js without fetch) to add:
 *
 *  - A configurable timeout per request using AbortController.
 *  - Exponential backoff between retries with optional jitter.
 *  - A maximum number of retry attempts.  When exceeded the last error
 *    is rethrown to the caller.
 *
 * Usage:
 *   const resp = await retryFetch(url, options, { retries: 3, timeout: 5000 });
 *
 * Config defaults can be overridden via the third argument.
 */

// Resolve the fetch implementation.  In modern Node versions (v18+) `fetch`
// is available globally.  When absent we attempt to require `node-fetch`.
let fetchImpl;
if (typeof fetch === 'function') {
  fetchImpl = fetch;
} else {
  try {
    fetchImpl = require('node-fetch');
  } catch (err) {
    throw new Error('No compatible fetch implementation found. Please install node-fetch or upgrade Node.js');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform a fetch with automatic retries, exponential backoff and timeout.
 *
 * @param {string} url The URL to fetch
 * @param {object} options Fetch options (method, headers, body, etc)
 * @param {object} config Optional config: { retries, timeout, backoff, jitter }
 */
async function retryFetch(url, options = {}, config = {}) {
  const {
    retries = 3,
    timeout = 5000,
    backoff = 300,
    jitter = 100,
  } = config;
  let attempt = 0;
  let lastError;
  while (attempt <= retries) {
    try {
      // Setup abort controller for timeout handling
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const resp = await fetchImpl(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return resp;
    } catch (err) {
      lastError = err;
      attempt++;
      // Exhausted retries → rethrow
      if (attempt > retries) {
        throw lastError;
      }
      // Compute exponential backoff delay with jitter
      const delay = backoff * 2 ** (attempt - 1);
      const jitterMs = Math.floor(Math.random() * jitter);
      await sleep(delay + jitterMs);
    }
  }
  // Should never reach here but throw if for some reason the loop exits
  throw lastError;
}

module.exports = retryFetch;