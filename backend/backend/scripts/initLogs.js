/** Setup Logs
 * - Initializes the /logs directory and creates empty JSON log for each defined trade strategy. 
 * - Ensures that logs/sniper.json, logs/scalper.json, etc., exist so the logger doesn't fail on write
 */
const fs = require("fs");
const path = require("path");

// List of all trading strategies to create logs for
const strategies = [
  "sniper",
  "scalper",
  "breakout",
  "trendFollower",
  "delayedSniper",
  "chadMode",
  "dipBuyer",
  "rotationBot",
  "rebalancer",
  "paperTrader",
  "stealthBot",
];

const logDir = path.join(__dirname, "..", "logs");

// Ensure /logs folder exists.
function ensureLogsDir() {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
    console.log("📁 Created /logs directory");
  }
}

// Ensure /logs file for the given strategy if it doesn't exist. 
function createLogFile(strategy) {
  const filePath = path.join(logDir, `${strategy}.json`);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "[]"); // Initializes with empty array. 
    console.log(`📄 Created logs/${strategy}.json`);
  }
}

// Entry Point: ensure logs dir and files exist. 
function run() {
  ensureLogsDir();
  strategies.forEach(createLogFile);
  console.log("✅ All log files ready.");
}

run();


// Let me know if you'd like a version that also populates 
// the files with mock data or logs an entry that the log system was initialized. Otherwise, we can move on to the next file.
