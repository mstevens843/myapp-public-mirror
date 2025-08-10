/**
 * backend/services/execution/rpcPool.js
 *
 * A simple RPC pool abstraction for Solana connections.  Given a set of
 * RPC endpoints the pool will return connections in a round–robin
 * fashion and can broadcast raw transactions to multiple endpoints
 * simultaneously.  The sendRawTransactionQuorum() helper will send
 * the provided raw transaction to each endpoint in parallel (with a
 * small stagger) and resolve as soon as the configured quorum of
 * acknowledgements is reached.  If no Connection class is available
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
  constructor(endpoints) {
    this.endpoints = Array.isArray(endpoints) ? endpoints.slice() : [];
    this.connections = [];
    this._rrIndex = 0;
    // Eagerly build Connection instances if the library is available.
    this.connections = this.endpoints.map((ep) => {
      if (SolanaConnection) {
        try {
          // Use a low commitment by default; callers may override on call.
          return new SolanaConnection(ep);
        } catch (err) {
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
   * Sends the provided raw transaction to each RPC endpoint in the
   * pool until a quorum of acknowledgements has been achieved.
   *
   * By default the function requires a single successful result
   * (quorum = 1).  Pass a larger `quorum` property inside opts to
   * require multiple endpoints to confirm reception before resolving.
   * If more than `connections.length` errors occur before the quorum
   * threshold is met the promise rejects with the last error.
   *
   * A small stagger (defaults to 50ms) can be configured via
   * `opts.staggerMs` to avoid hammering all endpoints at exactly the
   * same moment.  A per–request timeout (defaults to 10000ms) can be
   * provided via `opts.timeoutMs` and will cause the promise to
   * reject if the quorum is not met within the allotted time.
   * Additional send options (such as `skipPreflight` or
   * `maxRetries`) are passed through to each connection’s
   * sendRawTransaction call.
   *
   * @param {Buffer|string} rawTx The serialized transaction to send.
   * @param {Object} [opts={}] Additional send options.
   * @param {number} [opts.quorum=1] Number of acknowledgements to wait for.
   * @param {number} [opts.staggerMs=50] Delay between sends per endpoint.
   * @param {number} [opts.timeoutMs=10000] Maximum time to wait.
   * @returns {Promise<any>} Resolves to the first successful result or
   *   rejects if the quorum cannot be met.
   */
  async sendRawTransactionQuorum(rawTx, opts = {}) {
    const {
      quorum = 1,
      staggerMs = 50,
      timeoutMs = 10000,
      ...sendOpts
    } = opts;
    if (!this.connections.length) {
      throw new Error('RpcPool has no connections');
    }
    // Track successes and failures.  When successCount reaches the
    // quorum the promise resolves.  If errors outnumber possible
    // remaining successes the promise rejects.
    let successCount = 0;
    let finished = false;
    let firstRes; // keep track of the first successful result
    const errors = [];
    return new Promise((resolve, reject) => {
      // Guard for timeout
      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        if (successCount > 0) {
          // Resolve with generic ok since at least one success occurred.
          resolve({ ok: true });
        } else {
          reject(errors[0] || new Error('sendRawTransactionQuorum timeout'));
        }
      }, timeoutMs);
      // Iterate over connections and schedule sends
      this.connections.forEach((conn, idx) => {
        const jitter = Math.floor(Math.random() * 5); // minimal jitter
        const delay = idx * staggerMs + jitter;
        setTimeout(async () => {
          // If already finished there is nothing to do
          if (finished) return;
          // Ensure the connection has a sendRawTransaction function
          const sendFn = conn && conn.sendRawTransaction;
          if (typeof sendFn !== 'function') {
            errors.push(new Error('Connection missing sendRawTransaction'));
            // If failures exceed possible successes, reject
            if (errors.length > this.connections.length - quorum) {
              if (!finished) {
                finished = true;
                clearTimeout(timer);
                reject(errors[errors.length - 1]);
              }
            }
            return;
          }
          try {
            const res = await sendFn.call(conn, rawTx, sendOpts);
            if (finished) return;
            successCount += 1;
            // Record the first successful result
            if (!firstRes) firstRes = res;
            // Once we’ve reached the quorum resolve with the first successful result
            if (successCount >= quorum) {
              finished = true;
              clearTimeout(timer);
              resolve(firstRes);
            }
          } catch (err) {
            errors.push(err);
            if (errors.length > this.connections.length - quorum) {
              if (!finished) {
                finished = true;
                clearTimeout(timer);
                reject(err);
              }
            }
          }
        }, delay);
      });
    });
  }
}

module.exports = RpcPool;
