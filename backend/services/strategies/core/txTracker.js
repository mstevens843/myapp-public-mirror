// backend/services/helpers/txTracker.js
const { Connection } = require("@solana/web3.js");
const { strategyLog } = require("../logging/strategyLogger");

const connection = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
const log = strategyLog("txTracker", "tx-confirm");

// Track pending trades keyed by signature.  Each entry stores
// metadata about the trade including the mint, a human‑readable
// label, a timestamp and optional extra metrics for this attempt.
const pendingTrades = new Map(); // txid → { mint, label, timestamp, meta }
let confirmedTrades = 0;

/**
 * Record a pending transaction and its associated metadata.  Call
 * this when you submit a transaction to the cluster.  The meta
 * object may contain per‑attempt metrics such as cuUsed, cuPrice,
 * tip, route, success, slippage, fillPct, leadTime_ms, etc.  These
 * will be logged once the transaction is confirmed.
 *
 * @param {string} txid The transaction signature
 * @param {string} mint The mint being traded
 * @param {string} [label] Human readable label
 * @param {Object} [meta] Additional metrics to associate with this trade
 */
function trackPendingTrade(txid, mint, label = "Unknown", meta = {}) {
  pendingTrades.set(txid, {
    mint,
    label,
    timestamp: Date.now(),
    meta: meta || {},
  });
}

function initTxWatcher(strategy = "Unknown") {
  setInterval(async () => {
    for (const [txid, entry] of pendingTrades.entries()) {
      const { mint, timestamp, label, meta } = entry;
      try {
        const tx = await connection.getTransaction(txid, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (tx) {
          const success = tx.meta && !tx.meta.err;
          const status = success ? "✅ Confirmed" : "❌ Failed";
          // Include extra metrics in the log if present
          const extraParts = [];
          if (meta) {
            if (typeof meta.slot === 'number') extraParts.push(`slot=${meta.slot}`);
            if (typeof meta.cuUsed === 'number') extraParts.push(`cuUsed=${meta.cuUsed}`);
            if (typeof meta.cuPrice === 'number') extraParts.push(`cuPrice=${meta.cuPrice}`);
            if (typeof meta.tip === 'number') extraParts.push(`tip=${meta.tip}`);
            if (meta.route) extraParts.push(`route=${meta.route}`);
            if (typeof meta.slippage === 'number') extraParts.push(`slip=${meta.slippage}`);
            if (typeof meta.fillPct === 'number') extraParts.push(`fill=${meta.fillPct}%`);
            if (typeof meta.leadTime_ms === 'number') extraParts.push(`lead=${meta.leadTime_ms}ms`);
          }
          const extraStr = extraParts.length ? ` [${extraParts.join(', ')}]` : '';
          log("info", `[${label}] ${status} TX: ${txid} – ${mint}${extraStr}`);
          if (success) confirmedTrades++;
          pendingTrades.delete(txid);
        } else if (Date.now() - timestamp > 10000) {
          log("warn", `[${label}] ⏳ Still pending: ${txid}`);
        }
      } catch (err) {
        log("error", `[${label}] Error confirming tx ${txid}: ${err.message}`);
      }
    }
  }, 2000);
}

function getTxTrackerStats() {
  return {
    pending: pendingTrades.size,
    confirmed: confirmedTrades,
  };
}

module.exports = {
  trackPendingTrade,
  initTxWatcher,
  getTxTrackerStats,
};