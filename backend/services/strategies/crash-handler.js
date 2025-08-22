/* backend/services/strategies/crash-handler.js
 * Preloaded with:  node -r backend/services/strategies/crash-handler.js ...
 * Captures ALL fatal paths and, crucially, intercepts process.exit()
 * to record a stack + last required modules so we can see WHO called exit(1).
 */

const fs   = require("fs");
const path = require("path");
const Module = require("module");

/* ---------- ENV context from launcher ---------- */
const {
  CRASH_BOT_ID = "",
  CRASH_MODE = "",
  CRASH_USER_ID = "",
  CRASH_CFG_PATH = "",
  CRASH_RUNTIME_DIR = "",
  CRASH_LOG_DIR = "",
} = process.env;

const BOT   = CRASH_BOT_ID || "unknown-bot";
const RDIR  = CRASH_RUNTIME_DIR || (CRASH_CFG_PATH ? path.dirname(CRASH_CFG_PATH) : process.cwd());

/* ---------- Dedicated crash log directory (Option 1) ---------- */
const crashDir = (CRASH_LOG_DIR && CRASH_LOG_DIR.trim())
  ? CRASH_LOG_DIR.trim()
  : path.join(__dirname, "../../crashlogs");
try {
  if (!fs.existsSync(crashDir)) fs.mkdirSync(crashDir, { recursive: true });
} catch {}

/* ---------- Keep a trail of recent module loads ---------- */
const moduleTrail = [];
const MAX_TRAIL = 120;
const _origLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  try {
    moduleTrail.push({
      ts: new Date().toISOString(),
      request,
      parent: parent?.id || null,
    });
    if (moduleTrail.length > MAX_TRAIL) moduleTrail.shift();
  } catch {}
  return _origLoad.apply(this, arguments);
};

/* ---------- Helpers ---------- */
let reported = false;

function emitBracket(level, line) {
  try { console.error(`[${level}] ${line}`); } catch {}
}

function tryIPC(payload) {
  if (typeof process.send === "function") {
    try { process.send({ type: "crash", ...payload }); } catch {}
  }
}

function writeArtifact(payload) {
  try {
    let baseName = path.basename(CRASH_CFG_PATH || `${BOT}.json`);
    if (baseName.endsWith(".json")) baseName = baseName.slice(0, -5);
    const out = path.join(crashDir, `${baseName}.${Date.now()}.crash.json`);
    fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  } catch {}
}

function buildPayload(event, data, extra = {}) {
  return {
    botId   : BOT,
    mode    : CRASH_MODE || null,
    userId  : CRASH_USER_ID || null,
    cfgPath : CRASH_CFG_PATH || null,
    event,
    message : data && (data.message || data.reason || String(data)) || null,
    stack   : data && (data.stack || null),
    moduleTrail,                  // <-- include recent requires
    ts      : new Date().toISOString(),
    ...extra,
  };
}

function report(event, data, extra = {}) {
  if (reported && event !== "process.exit") {
    // let process.exit report override the earlier one (more precise)
    return;
  }
  if (event === "process.exit") reported = true;

  const payload = buildPayload(event, data, extra);

  emitBracket("ERROR",
    `BOT CRASH (${event}) — ${payload.message || "no message"}`);

  tryIPC(payload);
  writeArtifact(payload);
}

/* ---------- Intercept process.exit() to capture caller stack ---------- */
const realExit = process.exit.bind(process);
process.exit = function interceptedExit(code) {
  try {
    const err = new Error(`process.exit(${code}) called`);
    // capture caller stack (skip our own frame)
    report("process.exit", { message: err.message, stack: err.stack }, { exitCode: code });
  } catch {}
  // ensure we actually exit
  return realExit(code);
};

/* ---------- Global traps ---------- */
process.on("uncaughtException", (err) => {
  report("uncaughtException", err);
  try { realExit(1); } catch {}
});
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  report("unhandledRejection", err);
  try { realExit(1); } catch {}
});

["SIGINT","SIGTERM","SIGHUP"].forEach(sig => {
  process.on(sig, () => {
    report(`signal:${sig}`, { message: `${sig} received` });
    try { realExit(1); } catch {}
  });
});

process.on("exit", (code) => {
  if (!reported && code !== 0) {
    report("exit", { message: `process exiting with code ${code}` }, { exitCode: code });
  }
});

process.on("beforeExit", (code) => {
  emitBracket("INFO", `beforeExit code=${code}`);
});
