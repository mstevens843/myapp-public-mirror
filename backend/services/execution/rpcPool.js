/**
 * backend/services/execution/rpcPool.js
 *
 * A simple RPC pool abstraction for Solana connections.  Given a set of
 * RPC endpoints the pool will return connections in a round–robin
 * fashion and can broadcast raw transactions to multiple endpoints
 * simultaneously.  The sendRawTransactionQuorum() helper will send
 * the provided raw transaction to a subset of endpoints in parallel
 * (with a small stagger) and resolve as soon as the configured quorum
 * of acknowledgements is reached. If no Connection class is available
 * (for example during tests) the pool falls back to storing plain
 * objects; test code can attach `sendRawTransaction` implementations
 * onto those objects.
 */

'use strict';

// Attempt to load the Solana web3 Connection class.  If the
// dependency is not installed consumers can provide their own
// implementation by monkey patching the `connections` array on the
// returned RpcPool instance.
let SolanaConnection;
try {
  // Dynamically import to avoid bundling when not available.
  // eslint-disable-next-line global-require
  SolanaConnection = require('@solana/web3.js').Connection;
} catch (_) {
  SolanaConnection = null;
}

class RpcPool {
  /**
   * Construct a new RpcPool.  Connections are eagerly created from
   * the supplied endpoints if the `@solana/web3.js` dependency is
   * available.  When the dependency is missing each element in
   * `this.connections` will be a plain object with an `_endpoint`
   * property.  Consumers may assign a custom sendRawTransaction
   * implementation to these objects during tests.
   *
   * @param {string[]} endpoints List of RPC URLs.  An empty array
   *   results in no connections being created.
   */
  constructor(endpoints, metrics) {
    this.endpoints = Array.isArray(endpoints) ? endpoints.slice() : [];
    this.connections = [];
    this._rrIndex = 0;       // round-robin cursor
    this._fanoutIdx = 0;     // start index for pickN
    this.metrics = metrics || { increment(){} };
    // Initialise health stats and circuit breaker tracking. These maps are keyed by
    // endpoint and used to compute health scores and temporarily remove
    // unhealthy endpoints from selection.
    this._stats = {};
    this._breaker = {};
    // Eagerly build Connection instances if the library is available.
    this.connections = this.endpoints.map((ep) => {
      if (SolanaConnection) {
        try {
          // Use default commitment; callers can override per-send.
          const conn = new SolanaConnection(ep);
          // stamp endpoint for logs/metrics
          conn._endpoint = ep;
          return conn;
        } catch (_) {
          // Fall through to a plain object if instantiation fails.
        }
      }
      // Fallback object used primarily for tests.  A custom
      // sendRawTransaction implementation should be attached by tests.
      return { _endpoint: ep };
    });
    // Populate per-endpoint stats and breaker state
    for (const conn of this.connections) {
      const ep = conn._endpoint;
      this._stats[ep] = { durations: [], errors: 0, total: 0 };
      this._breaker[ep] = { openUntil: 0 };
    }
  }

  /**
   * Update stats after a send attempt. Records latency and success/failure
   * counts. If error rate exceeds a threshold the circuit breaker may open.
   *
   * @param {string} endpoint
   * @param {number} durationMs
   * @param {boolean} error
   */
  _updateStats(endpoint, durationMs, error) {
    const s = this._stats[endpoint];
    if (!s) return;
    s.total += 1;
    if (error) {
      s.errors += 1;
      // If error rate exceeds 50% with at least 5 samples, open circuit for 30s
      if (s.total >= 5 && s.errors / s.total > 0.5) {
        const breaker = this._breaker[endpoint] || { openUntil: 0 };
        breaker.openUntil = Date.now() + 30000;
        this._breaker[endpoint] = breaker;
      }
    } else {
      // Only record durations for successes
      s.durations.push(durationMs);
      if (s.durations.length > 50) s.durations.shift();
    }
  }

  /**
   * Compute a health score for an endpoint based on recent latencies and error rate.
   * 1.0 indicates healthy, lower values indicate degraded performance. Scores may
   * be negative when the circuit is open.
   *
   * @param {string} endpoint
   */
  _healthScore(endpoint) {
    const s = this._stats[endpoint];
    if (!s) return 1;
    const total = s.total || 1;
    const errorRate = s.errors / total;
    const durations = s.durations.slice().sort((a, b) => a - b);
    const idx = Math.floor(0.95 * durations.length);
    const p95 = durations[idx] || 0;
    const latencyPenalty = Math.min(p95 / 1000, 1); // degrade up to 1 for ≥1s
    let score = 1 - errorRate - latencyPenalty * 0.5;
    const breaker = this._breaker[endpoint];
    if (breaker && breaker.openUntil > Date.now()) {
      score -= 1;
    }
    return score;
  }

  /**
   * Returns the next connection in round–robin order.  If no
   * connections are configured this function returns null.
   *
   * @returns {Object|null}
   */
  getConnection() {
    const total = this.connections.length;
    if (!total) return null;
    // Filter out connections with open circuit
    const candidates = this.connections.filter((conn) => {
      const b = this._breaker[conn._endpoint];
      return !(b && b.openUntil > Date.now());
    });
    let selected;
    if (candidates.length === 0) {
      // All circuits open; ignore breakers temporarily
      selected = this.connections[this._rrIndex % total];
    } else {
      // Pick the endpoint with the highest health score
      selected = candidates[0];
      let bestScore = this._healthScore(selected._endpoint);
      for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i];
        const score = this._healthScore(c._endpoint);
        if (score > bestScore) {
          selected = c;
          bestScore = score;
        }
      }
    }
    // Advance round-robin index regardless of selection to avoid starvation
    this._rrIndex = (this._rrIndex + 1) % total;
    return selected;
  }

  /**
   * Pick N distinct connections using a rotating start (round-robin).
   * Falls back to all connections if N is omitted or >= pool size.
   * @param {number} n
   * @returns {Object[]}
   */
  _pickN(n) {
    const total = this.connections.length;
    if (!total) return [];
    const take = Math.max(1, Math.min(Number(n) || total, total));
    const start = this._fanoutIdx % total;
    const pick = [];
    for (let i = 0; i < take; i++) {
      pick.push(this.connections[(start + i) % total]);
    }
    this._fanoutIdx = (start + 1) % total; // rotate for next call
    return pick;
  }

  /**
   * Normalize a sendRawTransaction return into a signature string when possible.
   * @param {any} res
   * @returns {string|any}
   */
  _normalizeSig(res) {
    if (typeof res === 'string') return res;
    if (res && typeof res === 'object') {
      if (typeof res.signature === 'string') return res.signature;
      if (typeof res.result === 'string') return res.result;
      if (res.value && typeof res.value === 'string') return res.value;
    }
    return res;
  }

  /**
   * Heuristic: Some RPCs reply with an error that indicates the tx is already
   * known/processed. We treat those as an acknowledgement.
   * @param {Error|any} err
   * @returns {boolean}
   */
  _looksLikeAlreadyProcessed(err) {
    const msg = (err && (err.message || err.toString())) || '';
    const m = String(msg).toLowerCase();
    return (
      m.includes('already processed') ||
      m.includes('transaction already known') ||
      m.includes('already known') ||
      m.includes('already in block') ||
      m.includes('txn already received') ||
      m.includes('transaction signature already')
    );
  }

  /**
   * Sends the provided raw transaction to multiple RPC endpoints in the pool
   * until a quorum of acknowledgements has been achieved.
   *
   * Options:
   *   - quorum (number): how many acks to consider success. Default 1.
   *   - maxFanout (number): send to at most this many endpoints (round-robin).
   *                         Default: all connections.
   *   - staggerMs (number): delay between fanout sends, default 50ms.
   *   - timeoutMs (number): overall timeout, default 10000ms.
   *   - treatAlreadyProcessedAsOk (boolean): default true.
   *   - ...sendOpts: passed to each connection's sendRawTransaction.
   *
   * Resolves to the first successful signature (string) when possible,
   * otherwise the first successful result.
   *
   * @param {Buffer|string} rawTx
   * @param {Object} [opts={}]
   * @returns {Promise<any>}
   */
  async sendRawTransactionQuorum(rawTx, opts = {}) {
    const {
      quorum: _quorum = 1,
      maxFanout,
      staggerMs = 50,
      timeoutMs = 10000,
      treatAlreadyProcessedAsOk = true,
      sigHint,
      ...sendOpts
    } = opts;

    const poolSize = this.connections.length;
    if (!poolSize) throw new Error('RpcPool has no connections');

    const fanout = Math.max(1, Math.min(Number(maxFanout) || poolSize, poolSize));
    const quorum = Math.max(1, Math.min(Number(_quorum) || 1, fanout));

    const targets = this._pickN(fanout);

    let successCount = 0;
    let finished = false;
    let firstSig = null;
    const errors = [];

    // Helper: after each outcome, check if meeting quorum is still possible
    const checkImpossible = () => {
      const remainingPossible = fanout - errors.length; // worst-case remaining successes
      const needed = quorum - successCount;
      return remainingPossible < needed;
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        if (successCount > 0) {
          resolve(firstSig || sigHint || { ok: true });
        } else {
          reject(errors[0] || new Error('sendRawTransactionQuorum timeout'));
        }
      }, Math.max(1, Number(timeoutMs) || 10000));

      targets.forEach((conn, idx) => {
        const jitter = Math.floor(Math.random() * 5);
        const delay = idx * Math.max(0, Number(staggerMs) || 0) + jitter;

        setTimeout(async () => {
          if (finished) return;

          const sendFn = conn && conn.sendRawTransaction;
          if (typeof sendFn !== 'function') {
            errors.push(new Error(`Connection missing sendRawTransaction (${conn?._endpoint || 'unknown'})`));
            if (!finished && checkImpossible()) {
              finished = true;
              clearTimeout(timer);
              reject(errors[errors.length - 1]);
            }
            return;
          }

          let startTime;
          try {
            startTime = Date.now();
            const res = await sendFn.call(conn, rawTx, sendOpts);
            // update health stats on success
            this._updateStats(conn._endpoint || 'unknown', Date.now() - startTime, false);
            if (finished) return;

            successCount += 1;
            try { this.metrics.increment('rpc_quorum_ok_total', 1, { ep: conn._endpoint || 'unknown' }); } catch (_) {}
            const sig = this._normalizeSig(res);
              if (!firstSig && typeof sig === 'string') firstSig = sig;
              if (!firstSig && sigHint) firstSig = sigHint;

            if (successCount >= quorum) {
              finished = true;
              clearTimeout(timer);
              resolve(firstSig || res);
            }
          } catch (err) {
            // update health stats on error
            if (startTime) {
              this._updateStats(conn._endpoint || 'unknown', Date.now() - startTime, true);
            }
            // Treat "already processed/known" as an ack
            if (treatAlreadyProcessedAsOk && this._looksLikeAlreadyProcessed(err)) {
              if (finished) return;
              successCount += 1;

              // try to extract any embedded signature from the error payload
              let sig = null;
              try {
                const maybeObj = err && err.response && err.response.data;
                if (maybeObj && typeof maybeObj.signature === 'string') sig = maybeObj.signature;
              } catch (_) {}

              if (!firstSig && typeof sig === 'string') firstSig = sig;

              if (successCount >= quorum) {
                finished = true;
                clearTimeout(timer);
                resolve(firstSig || sigHint || { ok: true });
              }
              return;
            }

            errors.push(err);
            try { this.metrics.increment('rpc_quorum_err_total', 1, { ep: conn._endpoint || 'unknown' }); } catch (_) {}
            if (!finished && checkImpossible()) {
              finished = true;
              clearTimeout(timer);
              reject(err);
            }
          }
        }, delay);
      });
    });
  }
}

module.exports = RpcPool;