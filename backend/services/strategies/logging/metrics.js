// backend/services/strategies/logging/metrics.js
/*
 * metrics.js – Lightweight metrics recorder for strategy events.
 *
 * This module exposes a set of functions for recording timing and
 * outcome information within the Turbo Sniper strategy.  The data is
 * stored in memory for inspection by other modules or exported to
 * external monitoring systems.  Each call simply appends to arrays or
 * increments counters; no aggregation is performed here.  A consumer
 * can snapshot the current state via the `snapshot()` method.
 */

// Internal state.  Times are stored in milliseconds; inclusion slots
// are stored as integers.
const state = {
  timings: {
    detectToQuote: [],
    quoteToBuild: [],
    buildToSubmit: [],
  },
  inclusionSlots: [],
  retries: 0,
  fails: {},
  successes: 0,
};

/**
 * Record a timing measurement.
 *
 * @param {string} phase One of 'detectToQuote', 'quoteToBuild', 'buildToSubmit'
 * @param {number} ms Duration in milliseconds
 */
function recordTiming(phase, ms) {
  if (state.timings[phase]) {
    state.timings[phase].push(ms);
  }
}

/**
 * Record the difference in slots between submission and inclusion.
 *
 * @param {number} slots Difference in slots
 */
function recordInclusion(slots) {
  if (Number.isFinite(slots)) {
    state.inclusionSlots.push(slots);
  }
}

/**
 * Increment the retry counter.
 */
function recordRetry() {
  state.retries += 1;
}

/**
 * Record a failure reason.  Reasons are aggregated in a dictionary.
 *
 * @param {string} reason Descriptive failure label
 */
function recordFail(reason) {
  const key = String(reason || 'unknown');
  state.fails[key] = (state.fails[key] || 0) + 1;
}

/**
 * Increment the success counter.
 */
function recordSuccess() {
  state.successes += 1;
}

/**
 * Return a shallow copy of the current metrics state.  Consumers
 * should treat the returned object as read‑only.
 */
function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

module.exports = {
  recordTiming,
  recordInclusion,
  recordRetry,
  recordFail,
  recordSuccess,
  snapshot,
};