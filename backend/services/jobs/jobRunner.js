// Idempotent job runner with metrics instrumentation.  This module
// wraps the execution of long running jobs, ensuring only one job
// executes per idempotency key and emitting Prometheus gauge updates to
// reflect the current number of running jobs.

const { v4: uuid } = require('uuid');
const idempotencyStore = require('../../utils/idempotencyStore.js');
const metrics = require('../utils/');

// Track in‑flight jobs keyed by their idempotency key.  This ensures
// concurrent callers with the same key wait on the same promise rather
// than spawning duplicate executions.
const runningJobs = new Map();

/**
 * Update the queue depth gauge.  Called whenever the number of
 * in‑flight jobs changes.
 */
function updateGauge() {
  metrics.setQueueDepth('jobRunner', runningJobs.size);
}

/**
 * Execute a potentially long‑running job exactly once given an idempotency
 * key. Duplicate calls with the same key within the TTL window will
 * receive the cached result. When no key is supplied the job runs
 * immediately and isn’t cached.
 *
 * The job is executed with a retry mechanism: when the job throws an
 * error (aside from manual abort via timeout) it will retry up to
 * `maxRetries` times with exponential backoff and jitter. A timeout
 * is applied to each attempt. If all attempts fail the error is
 * propagated to the caller and cached so subsequent duplicate calls
 * also return the error.
 *
 * @param {string|null} idKey A unique idempotency identifier provided by the client
 * @param {function(): Promise<{status:number,response:any}>} jobFn The async
 *   function encapsulating the business logic. It should return an object
 *   with `status` and `response` fields. Throwing will trigger a retry.
 * @param {object} opts Optional settings: { timeoutMs, maxRetries }
 */
async function runJob(idKey, jobFn, opts = {}) {
  const key = idKey || null;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 30000;
  const maxRetries = typeof opts.maxRetries === 'number' ? opts.maxRetries : 2;

  // If a valid idKey is provided and a cached result exists, return it.
  if (key) {
    const cached = idempotencyStore.get(key);
    if (cached) return cached;
    // If the job is already running for this key return the existing promise.
    if (runningJobs.has(key)) {
      return runningJobs.get(key);
    }
  }

  // Helper to run the job with a timeout.
  const attemptJob = async () => {
    return await Promise.race([
      jobFn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Job timed out')), timeoutMs)),
    ]);
  };

  // The core execution wrapper that handles retries.
  const executeWithRetries = async () => {
    let attempt = 0;
    while (true) {
      try {
        const result = await attemptJob();
        // Cache successful result for key when provided
        if (key) idempotencyStore.set(key, result);
        return result;
      } catch (err) {
        // When the job fails and we have retries left, back off and retry
        attempt++;
        if (attempt > maxRetries) {
          if (key) idempotencyStore.set(key, { status: 500, response: { error: err.message || String(err) } });
          throw err;
        }
        const backoff = Math.pow(2, attempt) * 100; // exponential backoff in ms
        const jitter = Math.random() * 100;
        await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
        continue;
      }
    }
  };

  // Create a promise for the running job and store it to dedupe concurrent calls
  const jobPromise = executeWithRetries()
    .catch((err) => {
      // Remove failed job from running map so future calls can retry
      if (key) runningJobs.delete(key);
      updateGauge();
      throw err;
    })
    .finally(() => {
      if (key) runningJobs.delete(key);
      updateGauge();
    });
  if (key) {
    runningJobs.set(key, jobPromise);
    updateGauge();
  }
  return jobPromise;
}

module.exports = { runJob };