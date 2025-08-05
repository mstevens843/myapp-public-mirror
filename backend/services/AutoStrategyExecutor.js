// /* ========================================================================
//  * AutoStrategyExecutor.js
//  * ------------------------------------------------------------------------
//  * Central supervisor for automated strategies (Sniper, Scalper, etc.).
//  * • Lets you invoke a single strategy OR an array of strategies in-process
//  * • Handles wallet-label bootstrapping, dotenv, basic alerting, and errors
//  * • Provides a CLI entry for quick one-shot or looping test runs
//  *
//  * Usage (programmatic):
//  *   const { runAutoStrategy } = require("@/services/AutoStrategyExecutor");
//  *   await runAutoStrategy({
//  *     type        : "sniper",
//  *     walletLabels: ["main"],
//  *     tokenMint   : "MINT_HERE",
//  *     snipeAmount : 0.05,
//  *     slippage    : 1.0,
//  *     loop        : false
//  *   });
//  *
//  * Usage (CLI):
//  *   node backend/services/AutoStrategyExecutor.js ./configs/sniper.json
//  * ====================================================================== */

// require("dotenv").config({
//   path: require("path").resolve(__dirname, "../../.env"),
// });

// const fs   = require("fs");
// const path = require("path");
// const { fork } = require("child_process");
// /* ---------- shared utils (won’t crash if absent) ---------------------- */
// const { loadWalletsFromLabels } =
//   safeRequire("./utils/wallet/walletManager") ?? { loadWalletsFromLabels: () => {} };
// const { sendAlert } =
//   safeRequire("../telegram/alerts")            ?? { sendAlert: () => {} };

// /* ---------- individual strategy imports --------------------------------
//  * Use safeRequire so missing strategies don’t crash the executor outright.
//  * --------------------------------------------------------------------- */
// const STRATEGIES = {
//   sniper        : require("./strategies/sniper"),
//   scalper       : safeRequire("./strategies/scalper"),
//   trend         : safeRequire("./strategies/trendFollower"),
//   trendfollower : safeRequire("./strategies/trendFollower"), // alias
// };

// /* =======================================================================
//  * safeRequire  –  return the module or null if not found
//  * ==================================================================== */
// function safeRequire(modPath) {
//   try { return require(modPath); }
//   catch { return null; }
// }

// /* =======================================================================
//  * runSingleStrategy(config)
//  * • Boots wallets (if labels supplied)
//  * • Executes the selected strategy
//  * • Catches & surface-reports fatal errors
//  * ==================================================================== */
// async function runSingleStrategy(config, options = {}) {
//   const { autoRestart = false } = options;
//   const type = (config.type || "").toLowerCase();
//   const fn   = STRATEGIES[type];

//   if (!type || !fn || typeof fn !== "function") {
//     throw new Error(`Unsupported or missing strategy: "${config.type}"`);
//   }

//   /* 🔥 NEW — write runtime JSON so Watchdog & modal can see this
//      (same logic you already use in startStrategy) */
//   const runtimeDir = path.join(__dirname, "../runtime");
//   fs.mkdirSync(runtimeDir, { recursive: true });
//   const botId   = `${type}-${Date.now()}`;
//   const cfgPath = path.join(runtimeDir, `${botId}.json`);
//   fs.writeFileSync(cfgPath, JSON.stringify({ ...config, botId, mode: type }, null, 2));
//   process.env.RUNTIME_CFG_FILE = cfgPath;   // (for optional cleanup)


//   /* wallet label → load matching keypairs once, if provided */
//   if (Array.isArray(config.walletLabels) && config.walletLabels.length) {
//   try {
//     loadWalletsFromLabels(config.walletLabels);
//   } catch (err) {
//     const { strategyLog } = require("./strategies/logging/strategyLogger");
//     const log = strategyLog(config.type ?? "unknown", config.botId ?? "main");
//     log("error", `Wallet load failed: ${err.message}`);
//     throw err; // still kill the bot
//   }
// }


//   console.log(`🚀  [${new Date().toLocaleTimeString()}]  Running strategy "${type}"…`);

// while (true) {
//   try {
//     await fn(config);
//     console.log(`✅  ${type} finished successfully.`);
//     break; // exit if it ends normally
//   } catch (err) {
//     console.error(`💥  ${type} crashed:`, err.message);
//     try { await sendAlert("ui", `⚠️ *${type} Error*\n${err.message}`, "Executor"); } catch {}

//     if (!autoRestart) break;

//     console.log(`🔁 Restarting ${type} in 3s...`);
//     await new Promise((r) => setTimeout(r, 3000));
//   }
// }
// }

// /* =======================================================================
//  * runAutoStrategy(config | [configs])
//  * • Accepts a single config object OR an array for multi-strat mode
//  * • Strategies run **sequentially** in-process; for parallel use cluster/fork
//  * ==================================================================== */
// async function runAutoStrategy(cfgInput) {
//   const configs = Array.isArray(cfgInput) ? cfgInput : [cfgInput];

//   for (const cfg of configs) {
//     try {
//       await runSingleStrategy(cfg, { autoRestart: cfg.autoRestart });
//     } catch (err) {
//       console.error(`💥  Strategy "${cfg.type}" crashed:`, err.message);
//       try { await sendAlert("ui", `⚠️ *${cfg.type} Error*\n${err.message}`, "Executor"); }
//       catch (_) {}
//     }
//   }
// }

// module.exports = { runAutoStrategy };

// /* =======================================================================
//  * CLI runner  (node AutoStrategyExecutor.js ./path/to/config.json)
//  * ==================================================================== */
// if (require.main === module) {
//   (async () => {
//     const cfgPath = process.argv[2];
//     if (!cfgPath) {
//       console.error("❌  Provide a JSON config path.");
//       process.exit(1);
//     }

//     const abs = path.resolve(cfgPath);
//     if (!fs.existsSync(abs)) {
//       console.error(`❌  No config found at: ${abs}`);
//       process.exit(1);
//     }

//     /* If the JSON contains { strategies: [ … ] } treat it as multi-mode */
//     const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
//     const toRun = Array.isArray(raw.strategies) ? raw.strategies : raw;

    
// const isParallel = process.argv.includes("--parallel");

// if (!isParallel) {
//   await runAutoStrategy(toRun)
//     .then(() => console.log("✅  Executor finished (or strategy now looping)…"))
//     .catch((e) => {
//       console.error("💥  Executor fatal:", e.message);
//       process.exit(1);
//     });
// } else {
//   const tasks = Array.isArray(toRun) ? toRun : [toRun];

//   console.log(`🧵 Launching ${tasks.length} strategy(ies) in parallel…`);

//   for (const [i, task] of tasks.entries()) {
//     const tempPath = path.join(__dirname, `../../runtime/parallel-${task.type}-${i}.json`);
//     fs.writeFileSync(tempPath, JSON.stringify(task, null, 2), "utf8");

//     const child = fork(
//       path.join(__dirname, `strategies/${task.type}.js`),
//       [tempPath],
//       { stdio: "inherit" }
//     );

//     console.log(`🟢 Forked: ${task.type} → PID ${child.pid}`);
//   }
// }
//   })();
// }



// // ✅ Breakdown:
// // 🔁 AutoStrategyExecutor.js:
// // Used when you want to run multiple strategies from the same Node.js process.

// // Doesn't spawn separate child processes.

// // Works great in local scripts, CLI commands, or advanced setups like clustered threads.

// // Handles:

// // Wallet bootstrapping

// // Auto-restarts internally

// // Optional looping

// // Running multiple strategies sequentially (or you could parallelize it)

// // 🧨 startStrategy():
// // Wraps everything needed to spawn the actual strategy file as a new Node.js process.

// // Used by your backend server to run each strategy in isolation.

// // Writes config to disk and launches:

// // bash
// // Copy
// // Edit
// // node services/strategies/sniper.js runtime/sniper-*.json
// // 🔄 So are they redundant?
// // No. They're complementary.

// // Use Case	Use This
// // Frontend hits /start or /start-multi	startStrategy() (via route)
// // Local CLI (node AutoStrategyExecutor.js myconfig.json)	AutoStrategyExecutor.js
// // Running strategies inside the same process/thread	runAutoStrategy()
// // Long-term modular bot server	startStrategy() (better scaling & process isolation)

