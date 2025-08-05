
// const fs = require("fs");
// const path = require("path");

// const CONFIG_DIR = path.join(__dirname, "../../../logs/bot-configs");

// fs.mkdirSync(CONFIG_DIR, { recursive: true });

// const STRATEGY_FILES = {
//   sniper: "sniper-config.json",
//   scalper: "scalper-config.json",
//   trendFollower: "trend-config.json",
//   chadMode: "chad-config.json",
//   breakout: "breakout-config.json",
//   delayedSniper: "delayedSniper-config.json",
//   dipBuyer: "dipBuyer-config.json",
//   paperTrader: "paperTrader-config.json",
//   rotationBot: "rotation-config.json",
// };

// function getFile(strategy) {
//   const file = STRATEGY_FILES[strategy];
//   if (!file) throw new Error("❌ Unknown strategy: " + strategy);
//   return path.join(CONFIG_DIR, file);
// }

// function readConfig(strategy) {
//   const filePath = getFile(strategy);
//   if (!fs.existsSync(filePath)) return null;
//   try {
//     const raw = fs.readFileSync(filePath, "utf8");
//     return JSON.parse(raw);
//   } catch {
//     return null;
//   }
// }

// function saveConfig(strategy, config) {
//   const filePath = getFile(strategy);
//   let arr = [];
//   if (fs.existsSync(filePath)) {
//     try { arr = JSON.parse(fs.readFileSync(filePath, "utf8")) || []; }
//     catch { arr = []; }
//   }
//   if (!Array.isArray(arr)) arr = [arr];
//   arr.push(config);
//   fs.writeFileSync(filePath, JSON.stringify(arr, null, 2));
//  console.log("✅ Saved config for", strategy);
// }

// function deleteConfig(strategy) {
//   const filePath = getFile(strategy);
//   if (fs.existsSync(filePath)) {
//     fs.unlinkSync(filePath);
//     console.log("🗑️ Deleted config for", strategy);
//   }
// }

// function listConfigs() {
//   return Object.keys(STRATEGY_FILES).map((strategy) => ({
//     strategy,
//     config: readConfig(strategy),
//   }));
// }

// module.exports = {
//   readConfig,
//   saveConfig,
//   deleteConfig,
//   listConfigs,
//   getFile,
// };
