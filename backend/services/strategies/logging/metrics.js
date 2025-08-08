// backend/services/strategies/logging/metrics.js
//
// Lightweight metrics collector used throughout the Turbo Sniper strategy.
//
// This module exports simple counter and histogram helpers that can be
// hooked into your existing telemetry pipeline (e.g. Prometheus or
// Datadog). Each metric is stored in memory and exposed via getters
// for scraping or exporting. The intent is to keep the hot path
// extremely lightweight – incrementing a counter or observing a
// histogram adds negligible overhead. Heavy aggregation or remote
// network calls should be performed asynchronously elsewhere.
//
// If you already have a metrics implementation, feel free to proxy
// these helpers to it rather than using the internal maps. For
// strategies without an existing metrics backend this module will
// still collect values which can be logged on exit for debugging.

'use strict';

/**
 * A simple in‑memory counter implementation. Keys are the metric
 * names; values are numbers. Labels are flattened into a string
 * representation so that different label sets are tracked
 * independently. The flattening scheme is simple and stable to
 * discourage dynamic label creation on the hot path.
 */
const counters = new Map();

/**
 * A simple histogram implementation. Each entry stores an array
 * of observed values. In production you might want to keep a
 * rolling window instead of unbounded arrays; here we leave the
 * implementation simple and focus on correctness.
 */
const histograms = new Map();

/**
 * Serialize a labels object into a deterministic string. The
 * resulting string uses ‘|’ as a separator and sorts keys to
 * guarantee consistent ordering. Undefined labels or null values
 * are dropped.
 *
 * @param {Object} labels
 * @returns {string}
 */
function serializeLabels(labels = {}) {
  const entries = Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}:${v}`).join('|');
}

/**
 * Increment a counter by a given amount (default 1).
 *
 * @param {string} name
 * @param {Object} [labels]
 * @param {number} [inc]
 */
function incCounter(name, labels = {}, inc = 1) {
  const key = `${name}${serializeLabels(labels)}`;
  const current = counters.get(key) || 0;
  counters.set(key, current + inc);
}

/**
 * Record a value in a histogram.
 *
 * @param {string} name
 * @param {number} value
 * @param {Object} [labels]
 */
function observeHistogram(name, value, labels = {}) {
  const key = `${name}${serializeLabels(labels)}`;
  const arr = histograms.get(key) || [];
  arr.push(value);
  histograms.set(key, arr);
}

/**
 * Retrieve all counter values. Useful for exposing aggregated
 * metrics at process exit or via an HTTP endpoint. Do not call
 * this on the hot path.
 */
function getCounters() {
  return new Map(counters);
}

/**
 * Retrieve all histogram observations. Useful for debugging or
 * exporting summary statistics. Do not call this on the hot path.
 */
function getHistograms() {
  return new Map(histograms);
}

module.exports = {
  incCounter,
  observeHistogram,
  getCounters,
  getHistograms,
};