// backend/services/strategies/core/rpcQuorumClient.js
'use strict';
/**
 * RpcQuorumClient
 * - Sends raw tx through N endpoints and treats it as "sent" when M acks succeed.
 * - Periodically refreshes recent blockhash (per endpoint) on TTL to reduce "expired" errors.
 * - Emits metrics: rpc_quorum_sent_total, rpc_quorum_win_total, blockhash_refresh_total
 *
 * Note: This is drop-in safe. It does not change your existing send path unless you call sendRawTransaction here.
 * You can use it strictly for blockhash refresh (refreshIfExpired) alongside your current swap sender.
 */

const { Connection } = require('@solana/web3.js');
const metrics = require('../logging/metrics');

class RpcQuorumClient {
  /**
   * @param {Object} opts
   * @param {string[]} opts.endpoints
   * @param {{size:number, require:number}} opts.quorum
   * @param {number} opts.blockhashTtlMs
   * @param {'confirmed'|'finalized'|'processed'} [opts.commitment]
   */
  constructor({ endpoints = [], quorum = { size: 1, require: 1 }, blockhashTtlMs = 2500, commitment = 'confirmed' } = {}) {
    this.endpoints = Array.from(new Set(endpoints.filter(Boolean)));
    this.quorum = { size: Math.max(1, +quorum.size || this.endpoints.length || 1), require: Math.max(1, +quorum.require || 1) };
    this.blockhashTtlMs = Math.max(500, +blockhashTtlMs || 2500);
    this.commitment = commitment;

    this._conns = this.endpoints.map((url) => new Connection(url, this.commitment));
    this._lastRef = new Map(); // url -> {blockhash, lastValidBlockHeight, ts}
  }

  getConnections() { return this._conns; }

  async _refreshOne(conn) {
    const url = conn._rpcEndpoint || 'unknown';
    const bh = await conn.getLatestBlockhash(this.commitment);
    this._lastRef.set(url, { ...bh, ts: Date.now() });
    metrics.recordBlockhashRefresh(url);
    return bh;
  }

  /**
   * Refresh a connection’s recent blockhash if TTL exceeded.
   * Returns the most recent (possibly refreshed) record.
   */
  async refreshIfExpired(conn) {
    const url = conn._rpcEndpoint || 'unknown';
    const rec = this._lastRef.get(url);
    if (!rec || (Date.now() - rec.ts) >= this.blockhashTtlMs) {
      return this._refreshOne(conn);
    }
    return rec;
  }

  /**
   * Send a serialized transaction to all endpoints (or first N per quorum.size)
   * and resolve when quorum.require acks succeed. Returns the first signature
   * that succeeded.
   */
  async sendRawTransaction(serialized, opts = { skipPreflight: true }) {
    if (this._conns.length === 0) throw new Error('No RPC endpoints configured');
    const list = this._conns.slice(0, this.quorum.size);
    let wins = 0;
    let firstSig = null;

    await Promise.allSettled(list.map(async (conn) => {
      const url = conn._rpcEndpoint || 'unknown';
      try {
        metrics.recordRpcQuorumSent(url);
        // Make sure recent blockhash is warm
        await this.refreshIfExpired(conn);
        const sig = await conn.sendRawTransaction(serialized, opts);
        wins += 1;
        if (!firstSig) firstSig = sig;
        metrics.recordRpcQuorumWin(url);
      } catch (_) {
        // ignore
      }
    }));

    if (wins >= this.quorum.require && firstSig) return firstSig;
    throw new Error(`rpc-quorum-not-reached: require=${this.quorum.require}, got=${wins}`);
  }
}

module.exports = RpcQuorumClient;
