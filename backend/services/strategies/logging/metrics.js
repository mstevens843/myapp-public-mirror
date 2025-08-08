// backend/services/strategies/logging/metrics.js
/*
 * metrics.js – Lightweight metrics recorder for strategy events.
 * Stores timings, counters, and histograms in-memory.
 * Expose helpers for reliability features (flags, A/B, quorum RPC).
 */
'use strict';

// ── Internal state ──────────────────────────────────────────────────────────
const state = {
  // phase timings (ms)
  timings: {
    detectToQuote: [],
    quoteToBuild: [],
    buildToSubmit: [],
  },
  // inclusion distance (slots)
  inclusionSlots: [],
  // legacy tallies
  retries: 0,
  fails: {},
  successes: 0,

  // generic instruments
  counters: Object.create(null),   // "name|k:v|k2:v2" -> number
  histograms: Object.create(null), // "name|k:v|..." -> number[]
};

// ── helpers ─────────────────────────────────────────────────────────────────
function _labelsKey(labels = {}) {
  const parts = Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${String(v)}`);
  return parts.length ? `|${parts.join('|')}` : '';
}
function _ctrKey(name, labels) { return `${name}${_labelsKey(labels)}`; }

function increment(name, by = 1, labels = {}) {
  const k = _ctrKey(name, labels);
  state.counters[k] = (state.counters[k] || 0) + Number(by || 1);
}
function observe(name, value, labels = {}) {
  const k = _ctrKey(name, labels);
  if (!state.histograms[k]) state.histograms[k] = [];
  state.histograms[k].push(Number(value) || 0);
}

// ── legacy API (kept) ───────────────────────────────────────────────────────
function recordTiming(name, ms, labels = {}) {
  const n = String(name);
  const v = Number(ms) || 0;
  if (state.timings[n]) state.timings[n].push(v);   // keep legacy buckets: detectToQuote, quoteToBuild, buildToSubmit
  observe(n, v, labels);                            // ALSO record arbitrary timings as a histogram
}
function recordInclusion(slots, labels = {}) {
  if (Number.isFinite(slots)) state.inclusionSlots.push(slots);
  observe('tx_inclusion_slots', Number(slots) || 0, labels);
}
function recordRetry(labels = {}) {
  state.retries += 1;
  increment('tx_retry_total', 1, labels);
}
function recordFail(reason, labels = {}) {
  const key = String(reason || 'unknown');
  state.fails[key] = (state.fails[key] || 0) + 1;
  increment('tx_fail_total', 1, { ...labels, code: key });
}
function recordSuccess(labels = {}) {
  state.successes += 1;
  increment('tx_success_total', 1, labels);
}

// ── new API for Prompt 3 ────────────────────────────────────────────────────
// Feature flags + A/B
function recordFeatureToggle(name, enabled) {
  increment('feature_enabled_total', 1, { name, enabled: !!enabled });
}
function recordABRun(name) {
  increment('ab_run_total', 1, { name });
}
function recordABDelta(name, deltaMs) {
  observe('ab_delta_ms', Number(deltaMs) || 0, { name });
}

// RPC quorum + blockhash refresh
function recordRpcQuorumSent(endpoint) {
  increment('rpc_quorum_sent_total', 1, { endpoint: endpoint || 'unknown' });
}
function recordRpcQuorumWin(endpoint) {
  increment('rpc_quorum_win_total', 1, { endpoint: endpoint || 'unknown' });
}
function recordBlockhashRefresh(endpoint) {
  increment('blockhash_refresh_total', 1, { endpoint: endpoint || 'primary' });
}

// ── snapshot/export ─────────────────────────────────────────────────────────
function snapshot() {
  // shallow clone enough for inspection/export
  return JSON.parse(JSON.stringify(state));
}
function getCounters() { return { ...state.counters }; }
function getHistograms() { return JSON.parse(JSON.stringify(state.histograms)); }

module.exports = {
  // legacy
  recordTiming,
  recordInclusion,
  recordRetry,
  recordFail,
  recordSuccess,
  snapshot,

  // generic instruments (opt-in)
  increment,
  observe,
  getCounters,
  getHistograms,

  // new metrics for reliability + measurement
  recordFeatureToggle,
  recordABRun,
  recordABDelta,
  recordRpcQuorumSent,
  recordRpcQuorumWin,
  recordBlockhashRefresh,
};
