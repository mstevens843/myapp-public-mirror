// services/utils/analytics/tradeRetention.js
// ───────────────────────────────────────────────────────────────
// Daily prune + monthly roll-up for closed-trade JSON logs
// Exports: runDaily, runMonthly
//-----------------------------------------------------------------
const fs   = require("fs");
const path = require("path");


/* ── paths ─────────────────────────────────────────────────────── */
const LOGS_DIR   = path.join(__dirname, "..", "..", "..", "logs");
const CHART_DIR  = path.join(LOGS_DIR, "tradeChartData");

// auto-create new folder
if (!fs.existsSync(CHART_DIR)) fs.mkdirSync(CHART_DIR, { recursive: true });

const CLOSED_TRADES_FILE = path.join(LOGS_DIR,  "closed-trades.json");          // legacy file
// const SNAP_FILE          = path.join(CHART_DIR, "current-closed-trades.json");  // ≤60 d rolling
// const MONTH_FILE         = path.join(CHART_DIR, "monthly-trade-summary.json");  // ∞ archive
const SNAP_FILE          = path.join(CHART_DIR, "mock-current-closed-trades.json");  // ≤60 d rolling
const MONTH_FILE         = path.join(CHART_DIR, "mock-monthly-trade-summary.json");  // ∞ archive

const DAYS_KEEP = +process.env.TRADES_KEEP_DAYS || 60;

/* ── helpers ──────────────────────────────────────────────────── */
const read   = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : []);
const write  = (f, data) => fs.writeFileSync(f, JSON.stringify(data, null, 2));
const append = (f, row)  => write(f, [...read(f), row]);

const avg = (arr) => (arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0);
const pnl = (t) =>
  typeof t.gainLossPct === "number"
    ? t.gainLossPct
    : t.entryPriceUSD && t.exitPriceUSD
      ? ((t.exitPriceUSD - t.entryPriceUSD) / t.entryPriceUSD) * 100
      : 0;

const netUsd = r =>
  (r.exitPriceUSD - r.entryPriceUSD) *
  (Number(r.outAmount) / 10 ** (r.decimals ?? 9));

  // how much was deployed (entry side, in USD)
const entryUsd = r =>
  (r.entryPriceUSD ?? 0) *
  (Number(r.inAmount) / 10 ** (r.decimals ?? 9))

const solSize = r =>
  r.spentSOL != null
    ? r.spentSOL
    : Number(r.inAmount) / 1e9;

/* ────────────────────── DAILY PRUNE ─────────────────────────── */
function runDaily() {
  const all     = read(CLOSED_TRADES_FILE);
  const cutoff  = Date.now() - DAYS_KEEP * 86_400_000;

  const recent  = all.filter((t) => new Date(t.timestamp).getTime() >= cutoff);
  const trimmed = all.length - recent.length;

  write(SNAP_FILE,          recent); // keep rolling file
  write(CLOSED_TRADES_FILE, recent); // keep legacy path in sync

  if (trimmed)
    console.log(`🗑️ tradeRetention: pruned ${trimmed} trades older than ${DAYS_KEEP} d`);
}

/* ──────────────────── MONTHLY ROLL-UP ───────────────────────── */
 function runMonthly() {
  /* only roll up on the 1st of the month (UTC) */
  const today = new Date();
  if (today.getUTCDate() !== 1) return;   // any other day → bail
 
   const recents      = read(SNAP_FILE);
   const prevMonth    = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
   const monthStr     = prevMonth.toISOString().slice(0, 7);    // YYYY-MM of the finished mont

  const rows = recents.filter(r => (r.timestamp || "").startsWith(monthStr));
  if (!rows.length) return;

  /* ── per-strategy aggregation ───────────────────────────── */
  const stratMap = {};

  for (const r of rows) {
    const s = (r.strategy || "unknown").toLowerCase();
    const obj = stratMap[s] ||= {
      totalTrades : 0,
      tradeSizeUSD: 0,
      netUsd      : 0,
      pnlPctArr   : [],
    };

    obj.totalTrades  += 1;
    obj.tradeSizeUSD += entryUsd(r);
    obj.netUsd       += netUsd(r);
    obj.pnlPctArr.push(pnl(r));
  }

  const strategies = {};
  for (const [k, v] of Object.entries(stratMap)) {
    strategies[k] = {
      totalTrades : v.totalTrades,
      tradeSizeUSD: +v.tradeSizeUSD.toFixed(2),
      netUsd      : +v.netUsd.toFixed(2),
      pnlPct      : +avg(v.pnlPctArr).toFixed(2),
    };
  }

  /* ── month-level row ────────────────────────────────────── */
  const aggregate = {
    month        : monthStr,
    timestamp    : `${monthStr}-01T00:00:00Z`,

    totalTrades  : rows.length,
    tradeSizeUSD : +rows.reduce((s, r) => s + entryUsd(r), 0).toFixed(2),
    netUsd       : +rows.reduce((s, r) => s + netUsd(r),  0).toFixed(2),
    pnlPct       : +avg(rows.map(pnl)).toFixed(2),

    strategies,
  };

    /* up-sert so each YYYY-MM appears only once */
  const months   = read(MONTH_FILE);
  const idx      = months.findIndex(m => m.month === monthStr);
  if (idx >= 0)  months[idx] = aggregate;      // replace existing
  else           months.push(aggregate);       // or add new one
  write(MONTH_FILE, months);
  console.log(`📦 tradeRetention: monthly snapshot stored for ${monthStr}`);
}


function pruneAndRoll() {
  runDaily();    // trim + refresh 60-day snapshot
  runMonthly();  // once per month it rolls up
}

module.exports = { runDaily, runMonthly, pruneAndRoll };
