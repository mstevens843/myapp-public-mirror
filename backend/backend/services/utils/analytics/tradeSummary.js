/** This module handles:
 * - Reading strategy-specific trade logs 
 * - Calculating analytics from completed trades. 
 * - Posting summaries to Telegram. 
 * 
 * - Used for PnL sand performance summaries for strategy. 
 */

const fs = require("fs");
const path = require("path");
const { sendAlert } = require("../../../telegram/alerts");


/** 
 * @private
 * - Reads trade logs for a specific strategy from /logs{strategy}.json
 */
function readLogs(strategy) {
  const logPath = path.join(__dirname, "..", "logs", `${strategy}.json`);
  if (!fs.existsSync(logPath)) {
    console.warn(`⚠️ No log file found for ${strategy}`);
    return [];
  }

  try {
    const data = fs.readFileSync(logPath, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    console.error(`❌ Failed to parse ${strategy}.json:`, err.message);
    return [];
  }
}

/** 
 * @private 
 * Analtzes trade outcomes for a strategy
 * Filters for completed trades and computes: 
 * - AVG Gain %
 * - Win/Loss count
 * - Simulated vs. Real Trade counts
 */
function calculateAnalytics(trades) {
  if (!trades.length) return null;

  const completed = trades.filter(t => t.success && t.entryPrice && t.exitPrice);
  const simulated = trades.filter(t => t.simulated);
  const real = trades.filter(t => !t.simulated);

  let wins = 0, losses = 0, gainTotal = 0;

  for (const t of completed) {
    const gain = ((t.exitPrice - t.entryPrice) / t.entryPrice) * 100;
    gainTotal += gain;
    if (gain > 0) wins++; else losses++;
  }
  let totalSolPnl = 0;
  let totalUsdPnl = 0;

  for (const t of completed) {
    const solIn = t.inAmount / 1e9;
    const solOut = t.outAmount / 1e6 * t.exitPrice;
    totalSolPnl += solOut - solIn;

    if (typeof t.entryPrice === "number" && typeof t.usdValue === "number") {
      totalUsdPnl += t.usdValue - (solIn * t.entryPrice);
    }
  }


  return {
    total: trades.length,
    completed: completed.length,
    wins,
    losses,
    avgGain: (gainTotal / completed.length).toFixed(2),
    winRate: ((wins / completed.length) * 100).toFixed(2),
    simulated: simulated.length,
    real: real.length,
    totalSolPnl: totalSolPnl.toFixed(4),
    totalUsdPnl: totalUsdPnl.toFixed(2),
  };
}

/** 
 * @public
 * - Generates a summary for a specific strategy and sends it to Telegram. 
 */
async function summarizeStrategy(strategy) {
  const trades = readLogs(strategy);
  const stats = calculateAnalytics(trades);

  if (!stats) {
    console.log(`📭 No trades for ${strategy}`);
    return;
  }

  const emoji = stats.totalSolPnl >= 0 ? "🟢" : "🔴";
const pnlLine = `${emoji} ${stats.totalSolPnl >= 0 ? "+" : ""}${stats.totalSolPnl} SOL | ${stats.totalUsdPnl >= 0 ? "+" : ""}$${stats.totalUsdPnl}`;

const message = `
📊 *${strategy} Summary*
────────────────────────
${pnlLine}
Total Trades: ${stats.total}
Simulated: ${stats.simulated} | Real: ${stats.real}
Completed: ${stats.completed}
✅ Wins: ${stats.wins} | ❌ Losses: ${stats.losses}
📈 Avg Gain: ${stats.avgGain}%
🎯 Win Rate: ${stats.winRate}%
`;

  console.log(message);
  await sendAlert(chatId || "ui", message, "Sell"); // or "TP" / "Summary" if you want to split categories
}

module.exports = { summarizeStrategy };
