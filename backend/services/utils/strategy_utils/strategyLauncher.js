const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const axios = require("axios");
const prisma       = require("../../../prisma/prisma");    
const { v4: uuid } = require("uuid");
const { validateStrategyConfig,  } = require("./strategyValidator");
const {
  registerStrategyStatus,
  clearStrategyStatus,
  getStrategyStatus,
  markPaused,
  markResumed,
} = require("./strategyStatus");
const {
  runningProcesses,
  lastConfigPaths,
  lastTickTimestamps,
} = require("./activeStrategyTracker");
const { socketBroadcast } = require("../../strategies/logging/strategyLogger");


const mintRequiredModes = new Set([
  "stealthbot",
  "rotationbot",
  "rebalancer",
  "chadmode",
]);


const pausedBots = new Set();
let shuttingDown = false;
process.once("SIGINT",  () => shuttingDown = true);
process.once("SIGTERM", () => shuttingDown = true);

const runtimeDir = path.join(__dirname, "../runtime");
if (!fs.existsSync(runtimeDir)) fs.mkdirSync(runtimeDir);






async function startStrategy(mode, config, autoRestart = false) {
  
  const errors = validateStrategyConfig(mode, config);
  if (errors.length) {
    throw { message: `Invalid config for ${mode}`, details: errors };
  }


    if (typeof config.botId === "string" && runningProcesses[config.botId]) {
    console.warn(`🚫 Bot with ID ${config.botId} is already running – skipping duplicate launch`);
    return { botId: config.botId, mode, configPath: lastConfigPaths[config.botId] };
  }


  // const timestamp   = Date.now();
  // const botId       = `${mode}-${timestamp}`;
  const timestamp   = Date.now();
  const botId       = typeof config.botId === "string" ? config.botId : `${mode}-${timestamp}`;
  config.botId      = botId; 
  const cfgFilename = `${botId}.json`;
  const cfgPath     = path.join(runtimeDir, cfgFilename);

const isMintMode = mintRequiredModes.has(mode.toLowerCase());

const sanitizedConfig = {
  ...config,

  botId,
  mode,
  dryRun: config.dryRun === true,

  // 💥 ALWAYS keep tokenMint for the four special modes
  tokenMint: isMintMode
    ? config.tokenMint
    : (config.useTargetToken ? config.tokenMint : undefined),

  // 💥 Those modes do NOT need tokenFeed at all
  tokenFeed: isMintMode ? undefined : (config.tokenFeed || "new"),

  wallets: (config.wallets || []).map((w) =>
    w.trim().replace(/^"+|"+$/g, "")
  ),
};

//   fs.writeFileSync(cfgPath, JSON.stringify(sanitizedConfig, null, 2));
//   console.log("✅ Wrote strategy config to:", cfgPath);


//   if (fs.existsSync(cfgPath)) {
//   console.warn("⚠️ Config file already exists before write:", cfgPath);
// }

if (fs.existsSync(cfgPath)) {
  console.warn("⚠️ Config file already exists before write:", cfgPath);
}

fs.writeFileSync(cfgPath, JSON.stringify(sanitizedConfig, null, 2));
console.log("✅ Wrote strategy config to:", cfgPath); 



console.log("🚨 STRATEGY INSERT:", {
  botId,
  userId: config.userId,
  fullConfig: config,
});
  /* ──────────────────────────  DB row  ────────────────────────── */
  try {
    await prisma.strategyRunStatus.create({
      data: {
        botId:    botId,
        userId:   config.userId || "system",     // pass it in if you have it
        mode:     mode,
        configId: config.configId || null,       // if you saved StrategyConfig earlier
        pid:      null,    
        config: sanitizedConfig,                       // will update below once we have proc.pid
      },
    });
  } catch (err) {
    console.warn("⚠️  Failed to insert StrategyRunStatus:", err.message);
  }

  const proc = spawn("node", [`services/strategies/${mode}.js`, cfgPath], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
  });

  // now we know the PID → patch the row
  prisma.strategyRunStatus.update({
    where: { botId },
    data : { pid: proc.pid }
  }).catch(()=>{});

// accept ANSI colour prefixes, optional whitespace, lower/upper-case,
// and fall back to “INFO” if no tag is found so *every* line is forwarded
// const BRACKET_RE = /\x1b\[[0-9;]*m?\s*\[(INFO|WARN|ERROR|LOOP|SUMMARY|DEBUG)]/i;
  // function forwardLines(chunk) {
  //   chunk.toString().split(/\r?\n/).filter(Boolean).forEach((line) => {
  //     if (!BRACKET_RE.test(line)) return;
  //     const lvl = line.slice(1, line.indexOf("]"));
  //     socketBroadcast({ botId, level: lvl, line });
  //   });
  // }
const STRIP_ANSI_RE = /\x1B\[[0-9;]*m/g;

function forwardLines(chunk) {
  chunk
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => {
      const cleanLine = line.replace(STRIP_ANSI_RE, "");
      if (!cleanLine.startsWith("[")) return;

      const lvl = cleanLine.slice(1, cleanLine.indexOf("]")).toUpperCase();

    const hit = cleanLine.match(/Trade.*?(\d+)\/(\d+).*?executed/i);
      if (hit) {
        const done = Number(hit[1]);
        const total = Number(hit[2]);
        const { getStrategyStatus } = require("./strategyStatus");
        const meta = getStrategyStatus(botId);
        if (meta) {
          meta.tradesExecuted = done;
          meta.maxTrades = total;
        }
      }

      socketBroadcast({ botId, level: lvl, line: cleanLine });
     /* --- NEW: heartbeat for Watchdog --- */
      lastTickTimestamps[botId] = Date.now();
    });
}
  proc.stdout.on("data", forwardLines);
  proc.stderr.on("data", forwardLines);

  // ✅ Track bot process
  runningProcesses[botId] = { proc, mode, configPath: cfgPath, autoRestart };
  if (mode === "scheduleLauncher") runningProcesses[botId].mode = "scheduled";
  lastConfigPaths[botId] = cfgPath;
  lastTickTimestamps[botId] = Date.now();

  registerStrategyStatus(botId, mode, cfgPath);

  function cleanupDeadBot(meta) {
    const shouldDelete =
      !shuttingDown &&
      !meta?.autoRestart &&
      !pausedBots.has(botId);

    if (shouldDelete && fs.existsSync(cfgPath)) {
        console.warn("🧹 Cleaning up config for", botId);
      try { fs.unlinkSync(cfgPath); } catch {}
      clearStrategyStatus(botId);
    }

    delete runningProcesses[botId];
    delete lastConfigPaths[botId];
    delete lastTickTimestamps[botId];
  }

proc.on("exit", (code, signal) => {
  console.warn(`⚠️ ${botId} exited (code ${code}, sig ${signal})`);

  (async () => {
    try {
      if (!pausedBots.has(botId)) {
        await prisma.strategyRunStatus.updateMany({
          where: { botId },
          data : { stoppedAt: new Date(), isPaused: false },
        });
      }
    } catch (err) {
      console.warn("⚠️ Failed to update DB on exit:", err.message);
    }
  })();

  if (pausedBots.has(botId)) {
    pausedBots.delete(botId);
    delete runningProcesses[botId];
    return;
  }

  const prev = runningProcesses[botId];
  cleanupDeadBot(prev);

  if (prev?.autoRestart && prev.configPath) {
    const retryProc = spawn(
      "node",
      [`services/strategies/${mode}.js`, prev.configPath],
      { stdio: "inherit", cwd: process.cwd() }
    );

    runningProcesses[botId] = {
      proc: retryProc,
      mode,
      configPath: prev.configPath,
      autoRestart: true,
    };
    lastTickTimestamps[botId] = Date.now();
  }
});

  return { botId, mode, configPath: cfgPath };
}






function stopStrategy(botId) {
  const meta = runningProcesses[botId];

  // If nothing running, still try to clean up config + status
  const configPath = meta?.configPath || lastConfigPaths[botId];

  // 🔥 Kill process if active
  if (meta?.proc) {
    try {
      meta.proc.kill("SIGTERM");
    } catch (e) {
      console.warn(`⚠️ Failed to kill bot ${botId}:`, e.message);
    }
  }

  // 🔥 Delete config file
  if (configPath && fs.existsSync(configPath)) {
    try {
      fs.unlinkSync(configPath);
      console.log(`🧹 Deleted config file for ${botId}`);
    } catch (e) {
      console.warn(`⚠️ Failed to delete config file for ${botId}:`, e.message);
    }
  }

  // 🔥 Clear runtime maps
  delete runningProcesses[botId];
  delete lastConfigPaths[botId];
  delete lastTickTimestamps[botId];

  // 🔥 Clear status
  clearStrategyStatus(botId);

  // 🔥 Update strategyRunStatus
  prisma.strategyRunStatus.updateMany({
    where: { botId },
    data: { stoppedAt: new Date(), isPaused: false },
  }).catch(() => {}); // fail silently if not found

  // 🔥 NEW: mark linked ScheduledStrategy as stopped
  if (meta?.mode === "scheduleLauncher" && meta?.scheduleJobId) {
    prisma.scheduledStrategy.update({
      where: { jobId: meta.scheduleJobId },
      data: { status: "stopped" },
    }).catch((e) => {
      console.warn(`⚠️ Failed to update ScheduledStrategy for ${botId}:`, e.message);
    });
  }

  console.log(`✅ Fully stopped and cleaned bot ${botId}`);
  return true;
}




function pauseStrategy(botId) {
  const meta = runningProcesses[botId];
  if (!meta) return false;

  markPaused(botId); // Freeze uptime
  pausedBots.add(botId);

  try {
    meta.proc.kill("SIGINT");
  } catch {}
  prisma.strategyRunStatus.updateMany({
    where:{ botId },
    data :{ pausedAt:new Date(), isPaused:true }
  }).catch(()=>{});
  return true;
}


/**
 * Pause all RUNNING (isPaused=false, not stopped) bots for a given user+wallet.
 * Returns the list of botIds that were actually paused.
 */
async function pauseBotsByWallet(userId, walletId) {
  const wid = Number(walletId);
  // Find running (not paused, not stopped) rows whose config.walletId == walletId
  const rows = await prisma.strategyRunStatus.findMany({
    where: {
      userId,
      isPaused: false,
      stoppedAt: null,
      // We rely on StrategyRunStatus.config JSON to hold walletId
      // (exactly how startStrategy writes it).
      config: { path: ["walletId"], equals: wid },
    },
    select: { botId: true },
  });
  const paused = [];
  for (const { botId } of rows) {
    if (pauseStrategy(botId)) paused.push(botId);
  }
  if (paused.length) {
    await prisma.strategyRunStatus.updateMany({
      where: { botId: { in: paused } },
      data: { isPaused: true, pausedAt: new Date() },
    });
  }
  return paused;
}




async function resumeStrategy(botId) {
  const cfgPath = lastConfigPaths[botId];
  if (!cfgPath) return false;

  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const mode = cfg.mode;

  const proc = spawn("node", [`services/strategies/${mode}.js`, cfgPath], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
  });

  runningProcesses[botId] = { proc, mode, configPath: cfgPath, autoRestart: false };
  lastTickTimestamps[botId] = Date.now();
  pausedBots.delete(botId);

  markResumed(botId); // Unfreeze uptime
  prisma.strategyRunStatus.updateMany({
    where:{ botId },
    data :{ isPaused:false }
  }).catch(()=>{});
  return true;
}





module.exports = {
  startStrategy,
  stopStrategy,
  pauseStrategy,
  resumeStrategy,
};
