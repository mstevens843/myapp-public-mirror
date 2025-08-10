// /services/orchestrator.js
const fs = require("fs");
const path = require("path");

console.log("🧠 Starting Bot Orchestrator...");

const configPath = path.resolve(__dirname, "../runtime/multi-strategy-config.json");
if (!fs.existsSync(configPath)) {
  console.error("❌ Config file not found:", configPath);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

if (config.sniper?.enabled) {
  console.log("🎯 Starting Sniper...");
  require("./strategies/sniper")(config.sniper);
}

if (config.scalper?.enabled) {
  console.log("🔁 Starting Scalper...");
  require("./strategies/scalper")(config.scalper);
}

if (config.delayedSniper?.enabled) {
  console.log("⏳ Starting Delayed Sniper...");
  require("./strategies/delayedSniper")(config.delayedSniper);
}

if (config.trendFollower?.enabled) {
  console.log("📈 Starting Trend Follower...");
  require("./strategies/trendFollower")(config.trendFollower);
}

if (config.dipBuyer?.enabled) {
  console.log("🩸 Starting Dip Buyer...");
  require("./strategies/dipBuyer")(config.dipBuyer);
}

if (config.rotationBot?.enabled) {
  console.log("♻️ Starting Rotation Bot...");
  require("./strategies/rotationBot")(config.rotationBot);
}

if (config.rebalancer?.enabled) {
  console.log("📐 Starting Rebalancer...");
  require("./strategies/rebalancer")(config.rebalancer);
}

if (config.breakout?.enabled) {
  console.log("🚀 Starting Breakout Strategy...");
  require("./strategies/breakout")(config.breakout);
}

if (config.chadMode?.enabled) {
  console.log("💪 Starting Chad Mode...");
  require("./strategies/chadMode")(config.chadMode);
}
