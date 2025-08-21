// backend/services/strategies/_bootstrap.js
/**
 * Universal bootstrap wrapper for strategy scripts.
 * Guarantees bracketed fatal logs even if the target module fails to require().
 * Usage (by launcher):
 *   node services/strategies/_bootstrap.js /abs/path/to/sniper.js /abs/path/to/config.json
 */

const fs = require("fs");
const path = require("path");

const FATAL_DELAY_MS = 120;
const BOOTSTRAP_DEBUG = false;

function emit(level, line) {
  // one human line the UI already understands, plus JSON for future tooling
  try { console.error(`[${level}] ${line}`); } catch {}
  try {
    console.log(JSON.stringify({
      level: String(level).toLowerCase(),
      line,
      ts: new Date().toISOString(),
    }));
  } catch {}
}

function fatal(reason, err) {
  const detail = err ? (err.stack || err.message || String(err)) : "";
  emit("ERROR", `${reason}${detail ? ` — ${detail}` : ""}`);
  setTimeout(() => process.exit(1), FATAL_DELAY_MS);
}

// Global last-ditch safety nets
process.on("uncaughtException",  (e) => fatal("uncaughtException",  e));
process.on("unhandledRejection", (e) => fatal("unhandledRejection", e));

// Args: [node, bootstrap, scriptPath, cfgPath]
const scriptPath = process.argv[2];
const cfgPath    = process.argv[3];

if (!scriptPath) fatal("missing scriptPath arg");
if (!cfgPath)    fatal("missing configPath arg");

// Resolve to absolute paths to avoid cwd surprises
const absScript = path.isAbsolute(scriptPath) ? scriptPath : path.resolve(process.cwd(), scriptPath);
const absCfg    = path.isAbsolute(cfgPath)    ? cfgPath    : path.resolve(process.cwd(), cfgPath);

// Preflight
if (!fs.existsSync(absScript)) fatal(`strategy script not found at ${absScript}`);
if (!fs.existsSync(absCfg))    fatal(`config JSON not found at ${absCfg}`);

if (BOOTSTRAP_DEBUG) emit("INFO", `Loading ${path.basename(absScript)} with cfg ${path.basename(absCfg)}`);

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(absCfg, "utf8"));
} catch (e) {
  fatal("failed to parse config JSON", e);
}

let mod;
try {
  mod = require(absScript);
} catch (e) {
  fatal(`require() failed for ${absScript}`, e);
}

// Support CommonJS export function or default
const entry = (typeof mod === "function") ? mod
            : (mod && typeof mod.default === "function") ? mod.default
            : null;

if (!entry) fatal(`strategy entry not a function in ${absScript}`);

Promise.resolve()
  .then(() => entry(cfg))
  .catch((e) => fatal("strategy startup failed", e));