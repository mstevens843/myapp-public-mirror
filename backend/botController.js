/** botController.js - CLI entry point for launching trading strategies. 
 * 
 * Features: 
 * - Accepts command-line args for strategy mode and config path. 
 * - Loads and parses the specified JSON config file. 
 * - Injects config into `process.env.BOT_CONFIG` for global access. 
 * - Dynamically imports the correct strategy file from `/strategies`
 * - Executes the strategy via async wrapper (suppeorts await/async ops)
 * 
 * Usage: 
 * node botController.js --mode sniper --config ./configs/sniper.json
 * - Used as the standalone bot launcher from CLI or programmatic shelle execution. 
 */


// botController.js
const fs = require("fs");
const path = require("path");

(async () => {
  const args = process.argv.slice(2);
  const modeArgIndex = args.findIndex(arg => arg === "--mode");

  if (modeArgIndex === -1 || !args[modeArgIndex + 1]) {
    console.error("❌ Missing --mode argument (e.g. --mode rotationBot)");
    process.exit(1);
  }

  const mode = args[modeArgIndex + 1];
  const configPath = path.resolve(__dirname, `./runtime/${mode}-config.json`);

  if (!fs.existsSync(configPath)) {
    console.error("❌ Missing config file:", configPath);
    process.exit(1);
  }

  let botConfig;
  try {
    botConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (err) {
    console.error("❌ Failed to parse strategy config:", err.message);
    process.exit(1);
  }

  console.log(`🚀 Launching ${mode.toUpperCase()} mode...`);
  console.log("📦 Strategy Config:", botConfig);

  try {
    const strategyPath = `./services/strategies/${mode}.js`;
    const strategy = require(strategyPath);
    await strategy(); // run the strategy
  } catch (err) {
    console.error("💥 Failed to run strategy:", err.message);
    process.exit(1);
  }
})();
