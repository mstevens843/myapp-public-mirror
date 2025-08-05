/** CLI TOOL: Daily Trade Recap
 * - Summarizes today's trades across all strategies.
 *  - Total Trades, win/loss count
 *  - Average gain/loss
 *  - Best & Worst trade by %
 *  - Win Rate
 */


const fs = require("fs");
const path = require("path");

const logsDir = path.join(__dirname, "..", "logs");

// Loads all trades from strategy log files.
function loadTrades() {
  const files = fs.readdirSync(logsDir).filter(f => f.endsWith(".json"));
  let all = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(logsDir, file), "utf-8");
    try {
      const data = JSON.parse(raw);
      all.push(...data);
    } catch (e) {
      console.warn(`⚠️ Skipped invalid JSON in ${file}`);
    }
  }

  return all;
}

// Calculates win rate, avg gain/loss, and extreme. 
function filterToday(trades) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return trades.filter(t => new Date(t.timestamp) >= startOfDay && t.success && t.entryPrice && t.exitPrice);
}

function summarizeDaily(trades) {
  const total = trades.length;
  const wins = trades.filter(t => t.exitPrice > t.entryPrice).length;
  const losses = total - wins;


  // Sum of all PnL percentages
  const pnlSum = trades.reduce((acc, t) => {
    const diff = t.exitPrice - t.entryPrice;
    return acc + (diff / t.entryPrice);
  }, 0);

  const avgGain = ((pnlSum / total) * 100).toFixed(2);
  const best = trades.reduce((best, t) => {
    const gain = (t.exitPrice - t.entryPrice) / t.entryPrice;
    return !best || gain > best.gain ? { ...t, gain } : best;
  }, null);

  const worst = trades.reduce((worst, t) => {
    const loss = (t.exitPrice - t.entryPrice) / t.entryPrice;
    return !worst || loss < worst.gain ? { ...t, gain: loss } : worst;
  }, null);

  // Print nicely formatted summary
  console.log(`
📆 Daily Recap (${new Date().toLocaleDateString()}):
──────────────────────────────────────
📌 Trades Today: ${total}
✅ Wins: ${wins}   ❌ Losses: ${losses}
💸 Avg Gain/Loss: ${avgGain}%
🏆 Best: +${(best.gain * 100).toFixed(2)}% (${best.outputMint.slice(0, 4)}…)
💀 Worst: ${(worst.gain * 100).toFixed(2)}% (${worst.outputMint.slice(0, 4)}…)
🧠 Win Rate: ${((wins / total) * 100).toFixed(2)}%
  `);
}

// Entry
const all = loadTrades();
const today = filterToday(all);
summarizeDaily(today);


/** HOW TO RUN IT 
 * node scripts/dailyRecap.js
 */