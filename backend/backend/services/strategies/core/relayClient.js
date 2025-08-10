// backend/services/strategies/core/relays/relayClient.js
//
// RelayClient encapsulates submission of bundles or transactions to one or more
// private relay endpoints. The relay configuration is driven entirely by the
// supplied config and will degrade gracefully if no relays are available. All
// submissions are fire‑and‑forget: the fastest acknowledgement wins. Metrics
// instrumentation is injected via the `metrics` argument and should support
// increment() calls with a counter name and optional labels.
//
// Configuration shape:
// {
//   enabled: boolean,
//   urls: string[],      // list of relay endpoint base URLs
//   mode: 'bundle'|'tx'  // how payloads should be marshalled for the relay
// }
//
// Usage:
// const client = new RelayClient(config, metrics);
// const result = await client.send(payload);
//
const crypto = require('crypto');

let fetchImpl;
try {
  // Prefer global fetch if available (Node 18+)
  fetchImpl = global.fetch;
} catch (_) {
  fetchImpl = null;
}
// Fallback to node-fetch if global fetch is unavailable
if (!fetchImpl) {
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies
    fetchImpl = require('node-fetch');
  } catch (_) {
    fetchImpl = null;
  }
}

class RelayClient {
  constructor(config = {}, metrics) {
    this.enabled = !!config.enabled;
    this.urls = Array.isArray(config.urls) ? config.urls : [];
    this.mode = config.mode || 'bundle';
    this.metrics = metrics || {
      increment() {},
    };
  }

  /**
   * Send a payload to all configured relays in parallel. Whichever relay
   * returns a successful response first will be treated as the winner.
   * If the relay integration is disabled or no URLs are present the call
   * will resolve to `{ skipped: true }`.
   *
   * @param {object} payload Arbitrary bundle or transaction data
   * @returns {Promise<object>} The winning relay's response or an error
   */
  async send(payload) {
    // If the feature is disabled or no relays are configured then short‑circuit.
    if (!this.enabled || this.urls.length === 0) {
      return { skipped: true };
    }

    // Ensure fetch is available at runtime.
    const fetchFn = fetchImpl;
    if (!fetchFn) {
      return { error: 'No fetch implementation available for relay client' };
    }

    // Kick off all submissions concurrently. Each submission wraps network
    // failures and response parsing in a try/catch so that Promise.any can be
    // used cleanly. The metrics counter `relay_submit_total` is incremented
    // for each attempted relay submission with the relay URL as a label.
    const tasks = this.urls.map((url) => {
      return (async () => {
        // record submit attempt
        if (this.metrics && typeof this.metrics.increment === 'function') {
          this.metrics.increment('relay_submit_total', 1, { relay: url });
        }
        try {
          const res = await fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: this.mode,
              payload,
            }),
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const data = await res.json();
          return { url, data, ok: true };;
        } catch (err) {
          return { url, error: err, ok: false };
        }
      })();
    });

    // resolve on FIRST success (true fastest-wins)
    let winner;
    try {
      winner = await Promise.any(
        tasks.map(p => p.then(r => {
          if (!r || !r.ok) throw r?.error || new Error('relay failed');
          return r;
        }))
      );
    } catch (_) {
      return { error: 'No relay reachable' };
   }

    // record which relay won
    if (this.metrics && typeof this.metrics.increment === 'function') {
      this.metrics.increment('relay_win_total', 1, { relay: winner.url });
    }

    return winner.data;
  }
}

module.exports = RelayClient;
