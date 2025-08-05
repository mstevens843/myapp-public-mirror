/**
 * @file tradeStats.js
 * @description
 * CLI utility to print a clean summary of all trades.
 * 
 * Features:
 * - Total Trades
 * - Wins / Losses
 * - Average gain/loss %
 * - Best and worst trade
 * - Per-strategy filtering via CLI
 * - Support for both real and simulated trades
 * 
 * Usage:
 *   node scripts/tradeStats.js               # show all strategies
 *   node scripts/tradeStats.js --mode sniper # show sniper trades only
 */



const fs = require("fs");
const path = require("path");
const args = require("minimist")(process.argv.slice(2));

const logsDir = path.join(__dirname, "..", "logs");
const strategy = args.mode || null;


/** 
 * Loads all straategy logs from the /logs folder.
 * - If a strategy filter is active, only loads that file. 
 */
function readLogs() {
  const files = fs.readdirSync(logsDir).filter(f => f.endsWith(".json"));
  let all = [];

  for (const file of files) {
    if (strategy && file.replace(".json", "") !== strategy) continue;
    const raw = fs.readFileSync(path.join(logsDir, file), "utf-8");
    const parsed = JSON.parse(raw);

    // Add a strategy name to each trafe
    all.push(...parsed.map(t => ({ ...t, strategy: file.replace(".json", "") })));
  }

  return all;
}


/**
 * Calculates win/loss stats, average PnL, and finds best/worst trades. 
 * Only considers trades with both entryPrice and exitPrice. 
 */
function summarize(trades) {
  const completed = trades.filter(t => t.success && t.entryPrice && t.exitPrice);
  if (!completed.length) return console.log("No completed trades.");

  const total = completed.length;
  const wins = completed.filter(t => t.exitPrice > t.entryPrice).length;
  const losses = total - wins;
  const avgGain = (
    completed.reduce((sum, t) => sum + ((t.exitPrice - t.entryPrice) / t.entryPrice), 0) /
    total *
    100
  ).toFixed(2);

  const best = [...completed].sort((a, b) => b.exitPrice / b.entryPrice - a.exitPrice / a.entryPrice)[0];
  const worst = [...completed].sort((a, b) => a.exitPrice / a.entryPrice - b.exitPrice / b.entryPrice)[0];

  console.log(`
📊 Trade Summary${strategy ? ` (${strategy})` : ""}:
────────────────────────────────
🧾 Total Trades: ${total}
✅ Wins: ${wins}   ❌ Losses: ${losses}
📈 Avg Gain/Loss: ${avgGain}%
🏆 Best Trade: +${(((best.exitPrice - best.entryPrice) / best.entryPrice) * 100).toFixed(2)}% (${best.outputMint.slice(0, 4)}…)
💀 Worst Trade: ${(((worst.exitPrice - worst.entryPrice) / worst.entryPrice) * 100).toFixed(2)}% (${worst.outputMint.slice(0, 4)}…)
🧠 Win Rate: ${((wins / total) * 100).toFixed(2)}%
`);
}

// execute.
const logs = readLogs();
summarize(logs);
