// backend/services/helpers/txTracker.js
const { Connection } = require("@solana/web3.js");
const { strategyLog } = require("../logging/strategyLogger");

const connection = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
const log = strategyLog("txTracker", "tx-confirm");

const pendingTrades = new Map(); // txid → { mint, label, timestamp }
let confirmedTrades = 0;

function trackPendingTrade(txid, mint, label = "Unknown") {
  pendingTrades.set(txid, {
    mint,
    label,
    timestamp: Date.now(),
  });
}

function initTxWatcher(strategy = "Unknown") {
  setInterval(async () => {
    for (const [txid, { mint, timestamp, label }] of pendingTrades.entries()) {
      try {
      const tx = await connection.getTransaction(txid, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });        
      if (tx) {
          const success = tx.meta && !tx.meta.err;
          const status = success ? "✅ Confirmed" : "❌ Failed";

          log("info", `[${label}] ${status} TX: ${txid} – ${mint}`);
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
