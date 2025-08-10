/**
 * rpcManager.js
 *
 * A lightweight helper class to manage multiple RPC endpoints, track
 * connection errors and automatically fail over to the next endpoint when
 * a threshold of failures is reached. This enables rudimentary high
 * availability for bots running in production, reducing downtime caused by
 * unstable or congested public RPCs. The manager exposes a `getConnection()`
 * method that returns a new `Connection` instance bound to the current
 * endpoint. On each error encountered during RPC calls, you should call
 * `recordError()` to increment the internal error counter. When the counter
 * exceeds the configured `maxErrors`, the manager rotates to the next
 * endpoint in its list and resets the counter.  If no custom endpoints are
 * provided, the manager falls back to the environment's `SOLANA_RPC_URL`.
 *
 * This approach is inspired by best practices for maintaining multiple RPC
 * providers and monitoring network health【516021514376070†L610-L623】.  It is
 * intentionally simple and could be extended to support latency sampling,
 * health checks, or weighted rotation schemes in the future.
 */

const { Connection } = require("@solana/web3.js");

class RpcManager {
  /**
   * Create a new RpcManager.
   *
   * @param {string[]} endpoints A list of RPC URLs in order of preference.
   * @param {number} maxErrors Maximum consecutive errors before failing over.
   */
  constructor(endpoints = [], maxErrors = 3) {
    this.endpoints = Array.isArray(endpoints)
      ? endpoints.filter((e) => typeof e === "string" && e.trim().startsWith("http"))
      : [];
    this.maxErrors = Math.max(1, +maxErrors || 3);
    this.currentIndex = 0;
    this.errorCount = 0;
  }

  /**
   * Return the current RPC endpoint. Falls back to process.env.SOLANA_RPC_URL if none configured.
   */
  getCurrentEndpoint() {
    return (
      this.endpoints[this.currentIndex] ||
      process.env.SOLANA_RPC_URL ||
      "https://api.mainnet-beta.solana.com"
    );
  }

  /**
   * Return a new Connection instance to the current RPC endpoint.
   */
  getConnection() {
    const url = this.getCurrentEndpoint();
    return new Connection(url, "confirmed");
  }

  /**
   * Record an RPC error. If the number of consecutive errors reaches the
   * configured threshold, rotate to the next endpoint and reset the counter.
   */
  recordError() {
    this.errorCount += 1;
    if (this.errorCount >= this.maxErrors && this.endpoints.length > 1) {
      this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
      this.errorCount = 0;
      console.warn(
        `⚠️ RPC failover triggered. Switching to endpoint index ${this.currentIndex}: ${this.getCurrentEndpoint()}`
      );
    }
  }

  /**
   * Reset the error counter. Call this after a successful RPC call to avoid
   * unnecessary failovers.
   */
  resetErrors() {
    this.errorCount = 0;
  }
}

module.exports = RpcManager;