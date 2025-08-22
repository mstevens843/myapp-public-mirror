const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const axios = require("axios");
const prisma = require("../../../prisma/prisma");
const { v4: uuid } = require("uuid");
const { validateStrategyConfig } = require("./strategyValidator");
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
process.once("SIGINT", () => (shuttingDown = true));
process.once("SIGTERM", () => (shuttingDown = true));

const runtimeDir = path.join(__dirname, "../runtime");
if (!fs.existsSync(runtimeDir)) fs.mkdirSync(runtimeDir);

// ring buffer of recent lines per bot for artifact dumps
const recentLines = Object.create(null);
const MAX_BUF_LINES = 200;

function rememberLine(botId, line) {
  const arr = (recentLines[botId] = recentLines[botId] || []);
  arr.push({ ts: new Date().toISOString(), line });
  if (arr.length > MAX_BUF_LINES) arr.shift();
}

function writeCrashArtifact(botId, cfgPath, info) {
  try {
    const base = cfgPath || path.join(runtimeDir, `${botId}.json`);
    const out  = `${base}.crash.json`;
    const payload = {
      botId,
      mode: info?.mode || null,
      userId: info?.userId || null,
      exitCode: info?.exitCode ?? null,
      signal: info?.signal ?? null,
      event: info?.event || "exit",
      message: info?.message || null,
      stack: info?.stack || null,
      lastLogs: recentLines[botId] || [],
      ts: new Date().toISOString(),
    };
    fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  } catch {}
}

async function persistCrashToDb(data) {
  // DB row is optional; if table not present, just ignore
  try {
    if (prisma?.strategyCrash?.create) {
      await prisma.strategyCrash.create({
        data: {
          botId: data.botId,
          userId: data.userId || null,
          mode: data.mode || null,
          event: data.event || "exit",
          message: data.message || null,
          stack: data.stack || null,
        },
      });
    }
  } catch (e) {
    console.warn("⚠️ Failed to insert StrategyCrash:", e.message);
  }
}

async function startStrategy(mode, config, autoRestart = false) {
  const errors = validateStrategyConfig(mode, config);
  if (errors.length) {
    throw { message: `Invalid config for ${mode}`, details: errors };
  }

  if (typeof config.botId === "string" && runningProcesses[config.botId]) {
    console.warn(`🚫 Bot with ID ${config.botId} is already running – skipping duplicate launch`);
    return { botId: config.botId, mode, configPath: lastConfigPaths[config.botId] };
  }

  const timestamp = Date.now();
  const botId = typeof config.botId === "string" ? config.botId : `${mode}-${timestamp}`;
  config.botId = botId;
  const cfgFilename = `${botId}.json`;
  const cfgPath = path.join(runtimeDir, cfgFilename);

  const isMintMode = mintRequiredModes.has(mode.toLowerCase());
  const sanitizedConfig = {
    ...config,
    botId,
    mode,
    dryRun: config.dryRun === true,
    tokenMint: isMintMode
      ? config.tokenMint
      : (config.useTargetToken ? config.tokenMint : undefined),
    tokenFeed: isMintMode ? undefined : (config.tokenFeed || "new"),
    wallets: (config.wallets || []).map((w) => w.trim().replace(/^"+|"+$/g, "")),
  };

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

  /* DB row (best-effort) */
  try {
    await prisma.strategyRunStatus.create({
      data: {
        botId: botId,
        userId: config.userId || "system",
        mode: mode,
        configId: config.configId || null,
        pid: null,
        config: sanitizedConfig,
      },
    });
  } catch (err) {
    console.warn("⚠️  Failed to insert StrategyRunStatus:", err.message);
  }

  // Resolve absolute paths for strategy + bootstrap + crash handler
  const strategiesDir   = path.resolve(__dirname, "..", "..", "strategies");
  const scriptPath      = path.join(strategiesDir, `${mode}.js`);
  const bootstrapPath   = path.join(strategiesDir, "_bootstrap.js");
  const crashHandlerPath= path.join(strategiesDir, "crash-handler.js");
  const nodeBin         = process.execPath;

  // Spawn with preloaded crash handler so we *always* capture fatals
  console.log(`▶️ Spawning: ${nodeBin} -r ${crashHandlerPath} ${bootstrapPath} ${scriptPath} ${cfgPath}`);

  const proc = spawn(
    nodeBin,
    ["-r", crashHandlerPath, bootstrapPath, scriptPath, cfgPath],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"], // <-- IPC to receive crash payloads
      cwd: process.cwd(),
      env: {
        ...process.env,
        CRASH_BOT_ID: botId,
        CRASH_MODE: mode,
        CRASH_USER_ID: config.userId || "",
        CRASH_CFG_PATH: cfgPath,
        CRASH_RUNTIME_DIR: runtimeDir,
      
      CRASH_LOG_DIR: process.env.CRASH_LOG_DIR || require("path").join(__dirname, "../crashlogs")
    },
    }
  );

  // now we know the PID → patch the row
  prisma.strategyRunStatus.update({
    where: { botId },
    data: { pid: proc.pid },
  }).catch(() => {});

  const STRIP_ANSI_RE = /\x1B\[[0-9;]*m/g;

  function forwardLines(chunk) {
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => {
        const cleanLine = line.replace(STRIP_ANSI_RE, "");
        rememberLine(botId, cleanLine);

        let lvl = "INFO";
        const tag = cleanLine.match(/^\[([A-Za-z]+)\]/);
        if (tag) {
          lvl = String(tag[1]).toUpperCase();
        } else if (/(error|exception|cannot find module|unhandled|fatal)/i.test(cleanLine)) {
          lvl = "ERROR";
        } else if (/warn/i.test(cleanLine)) {
          lvl = "WARN";
        }

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

        socketBroadcast({ botId, level: lvl, line: cleanLine, ts: new Date().toISOString() });
        lastTickTimestamps[botId] = Date.now();
      });
  }

  proc.stdout.on("data", forwardLines);
  proc.stderr.on("data", forwardLines);

  // Listen for crash payloads from crash-handler (IPC)
  proc.on("message", async (payload) => {
    if (!payload || payload.type !== "crash") return;
    const { event, message, stack, mode: m, userId } = payload;

    const line = `[CRASH] ${botId} (${event}) — ${message || "no message"}`;
    console.error(line);
    socketBroadcast({ botId, level: "ERROR", line, ts: new Date().toISOString() });

    writeCrashArtifact(botId, cfgPath, {
      mode: m || mode,
      userId: userId || config.userId,
      event,
      message,
      stack,
    });

    await persistCrashToDb({
      botId,
      userId: userId || config.userId,
      mode: m || mode,
      event,
      message,
      stack,
    });
  });

  proc.on("error", (err) => {
    const line = `[SPAWN ERROR] ${err.message}`;
    console.error(line);
    socketBroadcast({ botId, level: "ERROR", line });
    writeCrashArtifact(botId, cfgPath, { event: "spawnError", message: err.message });
    persistCrashToDb({ botId, mode, userId: config.userId, event: "spawnError", message: err.message }).catch(() => {});
  });

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
            data: { stoppedAt: new Date(), isPaused: false },
          });
        }
      } catch (err) {
        console.warn("⚠️ Failed to update DB on exit:", err.message);
      }
    })();

    // If we got non-zero exit *and* no crash IPC arrived, dump what we have
    if (code && code !== 0) {
      writeCrashArtifact(botId, cfgPath, {
        mode,
        userId: config.userId,
        exitCode: code,
        signal,
        event: "exit",
        message: `exited with code ${code}${signal ? `, signal ${signal}` : ""}`,
      });
      persistCrashToDb({
        botId,
        userId: config.userId,
        mode,
        event: "exit",
        message: `exited with code ${code}${signal ? `, signal ${signal}` : ""}`,
      }).catch(() => {});
    }

    if (pausedBots.has(botId)) {
      pausedBots.delete(botId);
      delete runningProcesses[botId];
      return;
    }

    const prev = runningProcesses[botId];
    cleanupDeadBot(prev);

    if (prev?.autoRestart && prev.configPath) {
      const strategiesDir2   = path.resolve(__dirname, "..", "..", "strategies");
      const scriptPath2      = path.join(strategiesDir2, `${mode}.js`);
      const bootstrapPath2   = path.join(strategiesDir2, "_bootstrap.js");
      const crashHandlerPath2= path.join(strategiesDir2, "crash-handler.js");
      const nodeBin2         = process.execPath;

      const retryProc = spawn(
        nodeBin2,
        ["-r", crashHandlerPath2, bootstrapPath2, scriptPath2, prev.configPath],
        {
          stdio: ["ignore", "pipe", "pipe", "ipc"],
          cwd: process.cwd(),
          env: {
            ...process.env,
            CRASH_BOT_ID: botId,
            CRASH_MODE: mode,
            CRASH_USER_ID: config.userId || "",
            CRASH_CFG_PATH: prev.configPath,
            CRASH_RUNTIME_DIR: runtimeDir,
          },
        }
      );

      runningProcesses[botId] = {
        proc: retryProc,
        mode,
        configPath: prev.configPath,
        autoRestart: true,
      };
      lastTickTimestamps[botId] = Date.now();

      retryProc.stdout.on("data", forwardLines);
      retryProc.stderr.on("data", forwardLines);
      retryProc.on("message", async (payload) => {
        if (!payload || payload.type !== "crash") return;
        const { event, message, stack } = payload;
        writeCrashArtifact(botId, prev.configPath, { mode, userId: config.userId, event, message, stack });
        await persistCrashToDb({ botId, userId: config.userId, mode, event, message, stack }).catch(()=>{});
      });
    }
  });

  return { botId, mode, configPath: cfgPath };
}

function stopStrategy(botId) {
  const meta = runningProcesses[botId];

  const configPath = meta?.configPath || lastConfigPaths[botId];

  if (meta?.proc) {
    try {
      meta.proc.kill("SIGTERM");
    } catch (e) {
      console.warn(`⚠️ Failed to kill bot ${botId}:`, e.message);
    }
  }

  if (configPath && fs.existsSync(configPath)) {
    try {
      fs.unlinkSync(configPath);
      console.log(`🧹 Deleted config file for ${botId}`);
    } catch (e) {
      console.warn(`⚠️ Failed to delete config file for ${botId}:`, e.message);
    }
  }

  delete runningProcesses[botId];
  delete lastConfigPaths[botId];
  delete lastTickTimestamps[botId];

  clearStrategyStatus(botId);

  prisma.strategyRunStatus.updateMany({
    where: { botId },
    data: { stoppedAt: new Date(), isPaused: false },
  }).catch(() => {});

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

  markPaused(botId);
  pausedBots.add(botId);

  try {
    meta.proc.kill("SIGINT");
  } catch {}
  prisma.strategyRunStatus.updateMany({
    where: { botId },
    data: { pausedAt: new Date(), isPaused: true },
  }).catch(() => {});
  return true;
}

async function pauseBotsByWallet(userId, walletId) {
  const wid = Number(walletId);
  const rows = await prisma.strategyRunStatus.findMany({
    where: {
      userId,
      isPaused: false,
      stoppedAt: null,
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

  const strategiesDir   = path.resolve(__dirname, "..", "..", "strategies");
  const scriptPath      = path.join(strategiesDir, `${mode}.js`);
  const bootstrapPath   = path.join(strategiesDir, "_bootstrap.js");
  const crashHandlerPath= path.join(strategiesDir, "crash-handler.js");
  const nodeBin         = process.execPath;

  const proc = spawn(
    nodeBin,
    ["-r", crashHandlerPath, bootstrapPath, scriptPath, cfgPath],
    {
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      cwd: process.cwd(),
      env: {
        ...process.env,
        CRASH_BOT_ID: botId,
        CRASH_MODE: mode,
        CRASH_USER_ID: cfg.userId || "",
        CRASH_CFG_PATH: cfgPath,
        CRASH_RUNTIME_DIR: runtimeDir,
      },
    }
  );

  function forwardLines(chunk) {
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line) => {
        const cleanLine = line.replace(/\x1B\[[0-9;]*m/g, "");
        rememberLine(botId, cleanLine);

        let lvl = "INFO";
        const tag = cleanLine.match(/^\[([A-Za-z]+)\]/);
        if (tag) lvl = String(tag[1]).toUpperCase();
        else if (/(error|exception|cannot find module|unhandled|fatal)/i.test(cleanLine)) lvl = "ERROR";
        else if (/warn/i.test(cleanLine)) lvl = "WARN";

        socketBroadcast({ botId, level: lvl, line: cleanLine, ts: new Date().toISOString() });
        lastTickTimestamps[botId] = Date.now();
      });
  }
  proc.stdout.on("data", forwardLines);
  proc.stderr.on("data", forwardLines);

  proc.on("message", async (payload) => {
    if (!payload || payload.type !== "crash") return;
    const { event, message, stack } = payload;
    writeCrashArtifact(botId, cfgPath, { mode, userId: cfg.userId, event, message, stack });
    await persistCrashToDb({ botId, userId: cfg.userId, mode, event, message, stack }).catch(()=>{});
  });

  runningProcesses[botId] = { proc, mode, configPath: cfgPath, autoRestart: false };
  lastTickTimestamps[botId] = Date.now();
  pausedBots.delete(botId);

  markResumed(botId);
  prisma.strategyRunStatus.updateMany({
    where: { botId },
    data: { isPaused: false },
  }).catch(() => {});
  return true;
}

module.exports = {
  startStrategy,
  stopStrategy,
  pauseStrategy,
  resumeStrategy,
};