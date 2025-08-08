// backend/services/strategies/core/featureFlags.js
'use strict';
/**
 * Central feature flag registry with a tiny API.
 * Defaults: unknown flags => enabled (true).
 */

const metrics = require('../logging/metrics');

let _flags = Object.create(null);

function init(flags = {}) {
  _flags = { ...flags };
  // emit current state
  for (const [name, val] of Object.entries(_flags)) {
    metrics.recordFeatureToggle(name, !!val);
  }
}

function set(name, value) {
  _flags[name] = !!value;
  metrics.recordFeatureToggle(name, !!value);
}

function isEnabled(name) {
  if (!Object.prototype.hasOwnProperty.call(_flags, name)) return true;
  return !!_flags[name];
}

function all() {
  return { ..._flags };
}

module.exports = { init, set, isEnabled, all };
