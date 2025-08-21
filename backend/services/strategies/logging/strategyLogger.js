
let broadcast = () => {}; // placeholder, will be injected from index.js

function injectBroadcast(fn) {
  broadcast = fn;
}

// simple getter so other files can re-use the socket
function socketBroadcast(obj) {
  broadcast(JSON.stringify(obj));
}

const allowed = ["sniper", "breakout", "chadMode", "delayedSniper", "dipBuyer",
  "paperTrader", "rebalancer", "rotationBot", "scalper", "trendFollower", "stealthbot", "scheduleLauncher", "scheduled",
]; // ✅ allow-list
const allowedNormalized = allowed.map(s => s.toLowerCase());

// optional: filter specific log levels
const allowedLevels = ["info", "warn", "error", "loop", "summary", "debug"]; // ← adjust as needed

// ── ANSI color helpers (no external deps) ───────────────────────────────────
const TTY = !!(process.stdout && process.stdout.isTTY) && process.env.NO_COLOR !== '1';
const ANSI = {
  reset: "\x1b[0m",
  bold:  "\x1b[1m",
  dim:   "\x1b[2m",
  // bright base colors
  green: "\x1b[92m",  // emerald-ish
  yellow:"\x1b[93m",
  red:   "\x1b[91m",
  blue:  "\x1b[94m",
  purple:"\x1b[95m",
  cyan:  "\x1b[96m",
  gray:  "\x1b[90m",
  white: "\x1b[97m",
};
function glow(str, color) {
  if (!TTY) return str;
  const c = ANSI[color] || "";
  return `${ANSI.bold}${c}${str}${ANSI.reset}`;
}
function tint(str, color, bold=false, dim=false) {
  if (!TTY) return str;
  const c = ANSI[color] || "";
  return `${bold?ANSI.bold:""}${dim?ANSI.dim:""}${c}${str}${ANSI.reset}`;
}

// Categorize message content for special coloring
function detectCategory(msg) {
  const m = String(msg || "");
  if (m.includes("[SAFETY]")) return "safety";
  if (m.includes("[HEALTH]")) return "health";
  if (m.includes("[CONFIG]")) return "config";
  return null;
}

/**
 * Create logger function for a given strategy + botId
 * Adds standard [INFO], [WARN], etc. tags and optionally includes DRY/LIVE
 * Terminal output gets ANSI color; socket payload stays plain text.
 */
const strategyLog = (strategy, botId = "main", config = {}) => {
  const isDryRun = config?.dryRun === true;
  const runTag = isDryRun ? "[🧪 DRY]" : "[🔫 LIVE]";
  const strategyLower = String(strategy || "").toLowerCase();

  return (type, message) => {
    const level = String(type || "info").toLowerCase();
    const levelTag = {
      info: "[INFO]",
      warn: "[WARN]",
      error: "[ERROR]",
      loop: "[LOOP]",
      summary: "[SUMMARY]",
      debug: "[DEBUG]",
    }[level] || "[INFO]";

    // — plain text line used for broadcasting —
    const plain = `${levelTag} ${runTag} [${strategy}] ${message}`;

    // — styled terminal line (never sent over socket) —
    const category = detectCategory(message);
    let levelColor = "white";
    if (category === "safety")      levelColor = "purple";
    else if (category === "health") levelColor = "blue";
    else if (category === "config") levelColor = "cyan";
    else {
      levelColor = (level === "error") ? "red"
                 : (level === "warn")  ? "yellow"
                 : (level === "loop")  ? "gray"
                 : (level === "debug") ? "gray"
                 : "green"; // info/summary default emerald
    }

    // Color individual parts for readability
    const styledLevel   = glow(levelTag, levelColor);
    const styledRun     = tint(runTag,  isDryRun ? "cyan" : "green", true);
    const styledStrat   = tint(`[${strategy}]`, "gray", false, true);
    // For message, keep same color as level/category
    const styledMessage = glow(String(message ?? ""), levelColor);

    const styled = `${styledLevel} ${styledRun} ${styledStrat} ${styledMessage}`;

    // Print to terminal
    try { console.log(styled); } catch {}

    // Broadcast plain payload to frontend (no ANSI)
    if (
      allowedNormalized.includes(strategyLower) &&
      allowedLevels.includes(level)
    ) {
      try {
        broadcast(JSON.stringify({ botId, level: levelTag.slice(1,-1), line: plain }));
      } catch {}
    }
  };
};

module.exports = {
  strategyLog,
  injectBroadcast,
  socketBroadcast,
};