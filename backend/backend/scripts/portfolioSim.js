/** Virtual Portfolio Balance Tracker 
 * What it does: 
 * - Starts with balance (ex: 10sol)
 * - Applies each logged trade's `entryPrice -> exit price`
 * - Calculated current simularted value of: 
 *      - Open Positions (if no exitPrice)
 *      - Realized gains/losses
 * - Output a time-series of portfolio value. 
 */


const fs = require("fs");
const path = require("path");

const logsDir = path.join(__dirname, "..", "logs");
const INITIAL_BALANCE = 10; // in SOL

function getAllTrades() {
  const files = fs.readdirSync(logsDir).filter(f => f.endsWith(".json"));
  let all = [];

  for (const file of files) {
    const filePath = path.join(logsDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    all.push(...data);
  }

  return all.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function simulatePortfolio(trades) {
  let balance = INITIAL_BALANCE;
  let unrealized = 0;
  let equityHistory = [];

  for (const trade of trades) {
    if (!trade.success || !trade.entryPrice) continue;

    const entryValue = (trade.inAmount / 1e9) * trade.entryPrice;

    if (trade.exitPrice) {
      // Realized trade
      const gain = ((trade.exitPrice - trade.entryPrice) / trade.entryPrice);
      balance += entryValue * gain;
    } else {
      // Unrealized (still holding)
      unrealized += entryValue;
    }

    equityHistory.push({
      time: new Date(trade.timestamp).toISOString(),
      value: balance.toFixed(4),
    });
  }

  return {
    finalBalance: balance.toFixed(4),
    unrealized: unrealized.toFixed(4),
    equityCurve: equityHistory,
  };
}

const allTrades = getAllTrades();
const result = simulatePortfolio(allTrades);

console.log(`\n📈 Portfolio Simulation Summary`);
console.log(`───────────────────────────────`);
console.log(`🔹 Starting Balance: ${INITIAL_BALANCE} SOL`);
console.log(`🔹 Final Balance: ${result.finalBalance} SOL`);
console.log(`🔹 Unrealized Exposure: ${result.unrealized} SOL`);
console.log(`📊 Equity Points: ${result.equityCurve.length}`);
