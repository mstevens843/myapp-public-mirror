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
  }

  /**
   * Returns the next connection in round–robin order.  If no
   * connections are configured this function returns null.
   *
   * @returns {Object|null}
   */
  getConnection() {
    if (!this.connections.length) return null;
    const conn = this.connections[this._rrIndex % this.connections.length];
    this._rrIndex = (this._rrIndex + 1) % this.connections.length;
    return conn;
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

          try {
            const res = await sendFn.call(conn, rawTx, sendOpts);
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
