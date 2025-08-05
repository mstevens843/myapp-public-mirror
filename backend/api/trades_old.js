/** Trade Router: Handles all trade Related API including:
 * - Fetching Recent Trades 
 * - Full trade history
 * - CSV Report
 * - Per-strategy Logs
 * - Daily PnL recap
 * - Resetting Logs
 */


const express  = require("express");
const fs       = require("fs");
const path     = require("path");
const router   = express.Router();

const {
  convertToCSV,
  convertToTaxCSV,
} = require("../services/utils/analytics/exportToCSV");
const {
  getCurrentWallet,
  getWalletBalance
} = require("../services/utils/wallet/walletManager");
const { logTrade } = require("../services/utils/analytics/logTrade"); 
const { getTokenAccountsAndInfo } = require("../utils/tokenAccounts");
const { getCachedPrice }    = require("../utils/priceCache.static");  // 🆕 central cache
const { getBirdeyeDefiPrice } = require("../utils/birdeye");
const { loadSettings } = require("../telegram/utils/tpSlStorage");
const { pruneAndRoll } = require("../services/utils/analytics/tradeRetention");
const { getTokenName } = require("../services/utils/analytics/getTokenName");
const getTokenPrice = require("../services/strategies/paid_api/getTokenPrice");
const SOL_MINT = "So11111111111111111111111111111111111111112";


/* ── LOG paths ─────────────────────────────────────────────── */
const LOGS_DIR     = path.join(__dirname, "..", "logs");
const CHARTS_DIR   = path.join(LOGS_DIR, "tradeChartData");

const CLOSED_TRADES_FILE = path.join(LOGS_DIR,   "closed-trades.json");         // legacy (60d mirror)
const CURRENT_FILE        = path.join(CHARTS_DIR, "mock-current-closed-trades.json");
const MONTH_FILE          = path.join(CHARTS_DIR, "mock-monthly-trade-summary.json");
const OPEN_TRADES_FILE    = path.join(LOGS_DIR,   "open-trades.json");

// ensure folders
if (!fs.existsSync(LOGS_DIR))    fs.mkdirSync(LOGS_DIR);
if (!fs.existsSync(CHARTS_DIR))  fs.mkdirSync(CHARTS_DIR, { recursive: true });

// ensure files
if (!fs.existsSync(CLOSED_TRADES_FILE)) fs.writeFileSync(CLOSED_TRADES_FILE, "[]");
if (!fs.existsSync(CURRENT_FILE))       fs.writeFileSync(CURRENT_FILE, "[]");
if (!fs.existsSync(MONTH_FILE))         fs.writeFileSync(MONTH_FILE, "[]");
if (!fs.existsSync(OPEN_TRADES_FILE))   fs.writeFileSync(OPEN_TRADES_FILE, "[]");

// ── helper: safe JSON reader ───────────────────────────────────
function readJSONSafe(file) {
  try {
    const txt = fs.readFileSync(file, "utf-8");
    return txt.trim() ? JSON.parse(txt) : [];
  } catch {
    console.warn(`⚠️ Corrupt JSON in ${path.basename(file)} – resetting.`);
    fs.writeFileSync(file, "[]");
    return [];
  }
}




/** Public: GET /api/trades
 * Return last 100 trades, always populated with tokenName.
 */
router.get("/", async (_req, res) => {
  const { getTokenName } = require("../services/utils/analytics/getTokenName");
  const raw = readJSONSafe(CURRENT_FILE)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 100);

  await Promise.all(
    raw.map(async (t) => {
      if (!t.tokenName || t.tokenName === "Unknown") {
        const mint = t.side === "buy" ? t.outputMint : t.inputMint;
        t.tokenName = await getTokenName(mint);
      }
    })
  );
  res.json(raw);
});



  /** Public: GET /api/trades/history
   * Query params
   *   • from  ISO-date (inclusive)  → e.g. 2024-06-01
   *   • to    ISO-date (exclusive)  → defaults to “now”
   *   • limit integer              → caps rows after filtering (default 300)
   *   • offset integer             → for pagination
   *
   * Examples
   *   /history?from=2025-01-01&to=2025-04-01
   *   /history?limit=100&offset=200
   */
  router.get("/history", async (req, res) => {
    const { getTokenName } = require("../services/utils/analytics/getTokenName");
    const { from, to, limit = 300, offset = 0 } = req.query;
  
    const recent  = readJSONSafe(CURRENT_FILE);               // ≤60-day raw rows
    const monthly = readJSONSafe(MONTH_FILE).map(m => ({      // 1-row per month
      ...m,
      monthly  : true,
      timestamp: `${m.month}-01T00:00:00Z`,
    }));
  
    /* ---------- optional date filter ---------- */
    let rows = [...recent, ...monthly];
    if (from || to) {
      const t0 = from ? new Date(from).getTime() : 0;
      const t1 = to   ? new Date(to).getTime()   : Date.now();
      rows = rows.filter(r => {
        const ref = r.exitedAt ?? r.timestamp; // 🧠 prefer exit date
        const ts  = new Date(ref).getTime();
        return ts >= t0 && ts < t1;
      });
    }
  
    /* ---------- newest-first + pagination ---------- */
    rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    rows = rows.slice(Number(offset), Number(offset) + Number(limit));
  
    /* ---------- back-fill token names (only rows we’ll return) ---------- */
    await Promise.all(
      rows.map(async (t) => {
        if (!t.tokenName || t.tokenName === "Unknown") {
          const mint = t.side === "buy" ? t.outputMint : t.inputMint;
          t.tokenName = await getTokenName(mint);
        }
      })
    );
  
    res.json(rows);
  });

  /** Public: GET /api/trades/download
   * - Export all trades to CSV File
   */
 //  ── COMPLETE /api/trades/download ───────────────────────────

 // strip undefined/null/empty strings
const clean = (v) =>
  v === undefined ||
  v === null      ||
  (typeof v === "string" && (v === "undefined" || v === "null" || v.trim() === ""))
    ? undefined
    : v;
router.get("/download", (req, res) => {
  const {
   from: rawFrom,
   to:   rawTo,
    strategy = "all",
    preset   = "raw",
  } = req.query;

  const from = clean(rawFrom);
  const to   = clean(rawTo);

  const recent  = readJSONSafe(CURRENT_FILE); // ≤60 d trades
  const monthly = readJSONSafe(MONTH_FILE);   // 1-row / month

  /* ---------- stitch recent + monthly ---------- */
  let rows = [...recent];

  /* bring in months if the window starts before oldest recent row */
  if (from) {
    const fromMs       = new Date(from).getTime();
    const oldestRecent = Math.min(
      ...recent.map(r => new Date(r.timestamp).getTime())
    );
    if (fromMs < oldestRecent) {
      rows.push(
        ...monthly.filter(m => new Date(m.timestamp).getTime() >= fromMs)
      );
    }
  } else {
    rows.push(...monthly);        // no from → include everything
  }

  /* ---------- date + strategy filters ---------- */
  if (from || to) {
    const t0 = from ? new Date(from).getTime() : 0;
    const t1 = to   ? new Date(to).getTime()   : Date.now();
    rows = rows.filter(r => {
      const ref = r.exitedAt ?? r.timestamp; // 🧠 use exit date if available
      const ts  = new Date(ref).getTime();
      return ts >= t0 && ts < t1;
    });
  }

  if (strategy !== "all") {
    rows = rows.filter(r => (r.strategy ?? "").startsWith(strategy));
  }

  /* ---------- convert → CSV ---------- */
  const csv =
    preset === "tax" ? convertToTaxCSV(rows) : convertToCSV(rows);

  const fmt = (d) =>
  typeof d === "string"
    ? d
    : new Date(d).toISOString().slice(0, 10);

const rangePart =
  from || to
    ? `-${fmt(from || "start")}_to_${fmt(to || "now")}`
    : `-${new Date().toISOString().slice(0, 10)}`;

const fname =
  preset === "tax"
    ? `tax-report${rangePart}.csv`
    : `trades${rangePart}.csv`;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${fname}`);
  res.send(csv);
});


/** Public: GET /api/trades/recap
 * - Generate and return a daily gain/loss summary
 */
router.get("/:strategy/logs", (req, res) => {
  const file = path.join(LOGS_DIR, `${req.params.strategy}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "No log for strategy" });
  res.json(readJSONSafe(file).slice(-20).reverse());
});


 
/** Public: GET /api/trades/recap
 * - Generate and return a daily gain/loss summary
 */
/** GET /api/trades/recap  → daily performance summary */
/** GET /api/trades/recap  → daily performance summary */
router.get("/recap", (_req, res) => {
  try {
   const all      = readJSONSafe(CURRENT_FILE);
   const todayPt  = new Date().toLocaleDateString("en-US", { timeZone: "America/Los_Angeles" });

   let wins = 0, losses = 0, netPct = 0, best = null, worst = null;

   for (const t of all) {
     /* ── pick the *exit* day when possible ── */
     const ref = t.exitedAt ?? t.timestamp;
     if (!ref) continue;

     const day = new Date(ref).toLocaleDateString("en-US", {
       timeZone: "America/Los_Angeles",
     });
     if (day !== todayPt) continue;

     /* ── robust PnL pct ── */
     const pct =
       typeof t.gainLossPct === "number"
         ? t.gainLossPct
         : t.entryPriceUSD && t.exitPriceUSD
           ? ((t.exitPriceUSD - t.entryPriceUSD) / t.entryPriceUSD) * 100
           : 0;

     pct >= 0 ? wins++ : losses++;
     netPct += pct;

     if (!best || pct > (best?.gainLossPct ?? -Infinity))
      best = { ...t, gainLossPct: pct };
     if (!worst || pct < (worst?.gainLossPct ?? Infinity))
       worst = { ...t, gainLossPct: pct };
   }

   res.json({
     date: todayPt,
     totalTrades: wins + losses,
     wins,
     losses,
     netPnL: +netPct.toFixed(2),
     bestTrade: best,
     worstTrade: worst,
   });
  } catch (err) {
    console.error("❌ Recap error:", err);
    res.status(500).json({ error: "Failed to generate recap." });
  }
});






/** Private: POST /api/trades/reset
 * Reset all strategy logs (clear all log files)
 *  */ 
/** POST /api/trades/reset  → clear ALL strategy + closed logs */
router.post("/reset", (_req, res) => {
  try {
    fs.readdirSync(LOGS_DIR)
      .filter((f) => f.endsWith(".json"))
      .forEach((f) => fs.writeFileSync(path.join(LOGS_DIR, f), "[]"));
    fs.writeFileSync(CURRENT_FILE, "[]");
    fs.writeFileSync(MONTH_FILE,   "[]");
    res.json({ message: "Logs reset." });
  } catch (err) {
    console.error("❌ Reset error:", err);
    res.status(500).json({ error: "Failed to reset logs." });
  }
});














/////////////////////////////////////////////////////////////////////////
// OPEN TRADE ROUTES 



/** 🔐 Open Trades — Track currently held positions in memory or file */

// Ensure open-trades.json exists
if (!fs.existsSync(OPEN_TRADES_FILE)) {
  fs.writeFileSync(OPEN_TRADES_FILE, "[]");
}




router.get("/positions", async (req, res) => {
  try {
    const wallet = getCurrentWallet();
    const tokenAccounts = await getTokenAccountsAndInfo(wallet.publicKey);
    const solBalance = await getWalletBalance(wallet);
    const solPrice = await getCachedPrice(SOL_MINT, { readOnly: true });

    const settings = loadSettings();
    const userSettings = settings["default"] || {};


    const openTrades = fs.existsSync(OPEN_TRADES_FILE)
  ? JSON.parse(fs.readFileSync(OPEN_TRADES_FILE, "utf-8"))
  : [];

    const stableMints = new Set([
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
      "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
      "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX", // USDH
      "7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT"  // UXD
    ]);

    const positions = [];

    for (const { mint, name, amount } of tokenAccounts) {
      const openMatches = openTrades.filter(t => t.mint === mint);
      const totalIn = openMatches.reduce((sum, t) => sum + Number(t.inAmount), 0);
      const totalOut = openMatches.reduce((sum, t) => sum + Number(t.outAmount), 0);

      // 🧠 Weighted average entry price
      const weightedEntry = totalIn && totalOut ? totalIn / totalOut : null;
      const weightedUSD = openMatches.reduce((sum, t) => sum + (t.entryPriceUSD * Number(t.inAmount)), 0);
      const entryPriceUSD = totalIn ? +(weightedUSD / totalIn).toFixed(6) : null;
      if (stableMints.has(mint)) continue;
      if (!amount || amount < 0.000001) continue;
    
     let price  = await getTokenPrice(req.user.id, mint);     // number
    //  const meta = await getBirdeyeDefiPrice(mint); 

     /* 1️⃣ One Birdeye hit for meta, 2️⃣ cached price for cost-basis */
      // const stats = await getTokenPrice(mint);        // 30 s cache inside
      // const price = stats?.price ?? await getCachedPrice(mint, { readOnly: true })

    
      const valueUSD = +(amount * price).toFixed(2);
      const tpSl = userSettings[mint] || null;
    
      positions.push({
        mint,
        name: name?.replace(/[^\x20-\x7E]/g, "") || "Unknown",
        amount,
        price,
        valueUSD,
        valueSOL: +(amount * price / solPrice).toFixed(4),
        entryPrice: weightedEntry,
        entryPriceUSD,
        inAmount: totalIn,
        strategy: openMatches[0]?.strategy ?? "manual",
        entries: openMatches.length, // ✅ add here
        timeOpen: openMatches[0] ? new Date(openMatches[0].timestamp).toLocaleString() : null,
        // pnl24h: typeof stats?.priceChange24h === "number" ? stats.priceChange24h : null,
        // mcap: stats?.marketCap || null,
        movement: {
          // "5m": stats?.change5m ?? null,
          // "1h": stats?.change1h ?? null,
          // "6h": stats?.change6h ?? null,
          // "24h": stats?.change24h ?? null
        },
        tpSl: tpSl ? { tp: tpSl.tp, sl: tpSl.sl, enabled: tpSl.enabled !== false } : null,
        url: `https://birdeye.so/token/${mint}`
      });
    }

    /* ───────────────────────────────────────────────
       ➋  Include mints that still have open-trade rows
          but zero balance in the wallet (fully sold or
          dust-burned).  This guarantees the front-end
          always receives a live price for every row.
    ─────────────────────────────────────────────── */
    const seen = new Set(positions.map(p => p.mint));   // what we already added

    for (const t of openTrades) {
      if (seen.has(t.mint) || stableMints.has(t.mint)) continue;

      /* live price – Birdeye first, Jupiter fallback */
      // const stats = await getBirdeyeDefiPrice(t.mint);
      const price = await getTokenPrice(req.user.id, t.mint);   // ← returns a number



      positions.push({
        mint        : t.mint,
        name        : (await getTokenName(t.mint)) || "Unknown",
        amount      : 0,                  // nothing on-chain
        price,
        valueUSD    : 0,
        valueSOL    : 0,

        /* everything below is “best effort” so the UI
           can still colour strategy pills, etc.       */
        entryPrice      : null,
        entryPriceUSD   : null,
        inAmount        : 0,
        strategy        : t.strategy,
        entries         : 0,
        timeOpen        : null,

        // /* Birdeye meta (optional) */
        // pnl24h          : stats?.priceChange24h ?? null,
        // mcap            : stats?.marketCap      ?? null,
        // movement        : {},

        tpSl            : null,
        url             : `https://birdeye.so/token/${t.mint}`,
      });
    }
    
    // ✅ OUTSIDE the loop
    // const usdc = tokenAccounts.find(t => t.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    // const usdcValue = usdc ? usdc.amount * (await getTokenPrice(usdc.mint)) : 0;
    /* USDC is a USD-pegged stable → no remote fetch needed */
    const usdc = tokenAccounts.find(
      (t) => t.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );
    const usdcValue = usdc ? usdc.amount * 1 : 0;   // 1 USDC ≈ 1 USD
    const solValue = solBalance * solPrice;
    
    return res.json({
      netWorth: +(solValue + usdcValue + positions.reduce((sum, t) => sum + t.valueUSD, 0)).toFixed(2),
      sol: { amount: solBalance, price: solPrice, valueUSD: solValue },
      usdc: usdc ? { amount: usdc.amount, valueUSD: usdcValue } : null,
      positions
    });
  } catch (err) {
    console.error("❌ Failed to fetch /positions:", err.message);
    res.status(500).json({ error: "Failed to fetch token positions" });
  }
});

router.get("/open", (_req, res) => {
  try {
    const data = readJSONSafe(OPEN_TRADES_FILE);
    return res.json(data);
  } catch (err) {
    console.error("❌ Failed to read open trades:", err);
    return res.status(500).json({ error: "Failed to load open trades." });
  }
});


router.delete("/open/:mint", (req, res) => {
  try {
    const { mint }  = req.params;
    const filtered  = readJSONSafe(OPEN_TRADES_FILE).filter(t => t.mint !== mint);

    fs.writeFileSync(OPEN_TRADES_FILE, JSON.stringify(filtered, null, 2));
    return res.json({ message: `Open trade for ${mint} removed.` });
  } catch (err) {
    console.error("❌ Failed to delete open trade:", err);
    return res.status(500).json({ error: "Failed to update open trades." });
  }
});




/** Private: POST /api/trades/open
 * - Log a new open trade (called after successful buy)
 */
router.post("/open", (req, res) => {
    /* ─── pull the full payload (old route only kept 5 fields) ─── */
    const {
      mint,
      entryPrice,          // lamports-per-token
      entryPriceUSD,       // usd-per-token
      inAmount,            // lamports or usdc-micros        (how much you SPENT)
      outAmount,           // token units *10^decimals*      (how many TOKENS you RECEIVED)
      unit       = "sol",  // "sol" | "usdc"
      decimals   = 9,      // token decimals
      strategy   = "manual",
      slippage   = 1,
      walletLabel = "default",
      timestamp   = new Date().toISOString(),
      tokenName   = "Unknown",
    } = req.body;

  if (!mint || !entryPrice || !inAmount || !strategy || !timestamp) {
    return res.status(400).json({ error: "Missing trade data." });
  }

  const existing = JSON.parse(fs.readFileSync(OPEN_TRADES_FILE, "utf-8"));

  existing.push({
    mint,
    entryPrice,
    entryPriceUSD,
    inAmount,
    outAmount,
    unit,
    decimals,
    strategy,
    slippage,
    walletLabel,
    timestamp,
    tokenName,
    closedOutAmount: 0,
  });


  fs.writeFileSync(OPEN_TRADES_FILE, JSON.stringify(existing, null, 2));
  res.json({ message: "Open trade logged." });
});

/** Public: GET /api/trades/open
 * - Return all currently open trades
 */
router.patch("/open/:mint", async (req, res) => {
  try {
    const mint = req.params.mint;

    const {
      percent,
      amountSold,
      strategy,       // e.g. "manual", "dca"
      removedAmount,
      triggerType,    // "tp" | "sl" | undefined
      exitPrice,
      exitPriceUSD,
      txHash,
      slippage,
      decimals,
      usdValue,       // ← will be ignored; we recalc
      walletLabel = "default",
    } = req.body;

    /* ---------- helpers ---------- */
    const titleCase = (s) => (!s ? s : s.charAt(0).toUpperCase() + s.slice(1));
    const dustRaw   = Math.round(10 ** (decimals ?? 9) * 0.01); // 0.01 token

    /* ---------- load & match rows ---------- */
    const data    = readJSONSafe(OPEN_TRADES_FILE);
    const matched = data.filter(
      (t) =>
        t.mint === mint &&
        (!strategy || t.strategy === strategy) &&
        t.walletLabel === walletLabel
    );

    if (!matched.length)
      return res.status(404).json({ error: "No matching open trades found." });

    /* FIFO order */
    matched.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const totalTok = matched.reduce((s, t) => s + Number(t.outAmount), 0);
    const pctNum   =
      percent != null ? (percent > 1 ? percent / 100 : percent) : null;

    const toSell = removedAmount ??
                   amountSold   ??
                   (pctNum != null ? Math.floor(totalTok * pctNum) : 0);

    if (toSell <= 0)
      return res.status(400).json({ error: "Invalid sell amount." });

    /* ---------- slice rows FIFO ---------- */
    let removed = 0;
    const toLog   = [];
    const updated = [];

    for (const t of matched) {
      let outAmt = Number(t.outAmount); // tokens held
      let inAmt  = Number(t.inAmount);  // cost basis (lamports or µUSDC)

      if (removed >= toSell) { updated.push(t); continue; }

      const remaining = toSell - removed;        // tokens still to close
      const fullTrim  = outAmt <= remaining;     // whole row?

      /* tokens & cost being closed in this slice */
      const closeTok  = fullTrim ? outAmt : remaining;
      const ratio     = closeTok / outAmt;       // share of row
      const costTrim  = Math.round(inAmt * ratio);

      /* exit value in USD for this slice */
      const exitUSD   = (closeTok / 10 ** (t.decimals ?? 9)) * exitPriceUSD;

      /* -------------- closed slice -------------- */
      toLog.push({
        ...t,
        outAmount       : closeTok,
        inAmount        : costTrim,
        closedOutAmount : costTrim,   // cost closed – *not* tokens
        exitPrice,
        exitPriceUSD,
        usdValue        : exitUSD,    // proceeds in USD
        slippage,
        decimals,
        txHash,
        triggerType,
        side            : "sell",
      });

      removed += closeTok;

      /* -------------- residual (if any) --------- */
      let remainTok = outAmt - closeTok;

      const entryPriceUSD = t.entryPriceUSD ?? 0;
      const remainValueUSD = (remainTok / 10 ** (t.decimals ?? 9)) * entryPriceUSD;

      // nukes if either token dust or USD value dust
      if (remainTok < dustRaw || remainValueUSD < 0.01) {
        remainTok = 0;
      }

      if (remainTok > 0) {
        updated.push({
          ...t,
          outAmount: remainTok,
          inAmount: inAmt - costTrim,
          closedOutAmount: (t.closedOutAmount || 0) + costTrim,
        });
      }
    }

    /* ---------- write new open-trades ---------- */
    const untouched  = data.filter(
      (t) =>
        !(t.mint === mint &&
          (!strategy || t.strategy === strategy) &&
          t.walletLabel === walletLabel)
    );
    fs.writeFileSync(
      OPEN_TRADES_FILE,
      JSON.stringify([...untouched, ...updated], null, 2)
    );

    /* ---------- collapse slices → 1 row -------- */
    const aggregate = (rows) => {
      if (!rows.length) return null;
      const acc = { ...rows[0] };

      for (let i = 1; i < rows.length; i++) {
        const cur = rows[i];

        /* simple sums */
        acc.outAmount       += cur.outAmount;
        acc.inAmount        += cur.inAmount;
        acc.closedOutAmount += cur.closedOutAmount;
        acc.usdValue        += cur.usdValue;

        /* weighted exit / entry prices */
        const totalTok = acc.outAmount;
        const wPrev    = totalTok - cur.outAmount;
        const wCur     = cur.outAmount;
        const wAvg     = (p, n) => ((p * wPrev) + (n * wCur)) / totalTok;

        acc.entryPrice     = wAvg(acc.entryPrice,     cur.entryPrice);
        acc.entryPriceUSD  = wAvg(acc.entryPriceUSD,  cur.entryPriceUSD);
        acc.exitPrice      = wAvg(acc.exitPrice,      cur.exitPrice);
        acc.exitPriceUSD   = wAvg(acc.exitPriceUSD,   cur.exitPriceUSD);

        acc.partial = acc.partial || cur.partial;
      }
      return acc;
    };

    const closedRow = aggregate(toLog);
if (!closedRow)
  return res.status(500).json({ error: "Nothing to close." });

/* ---------------- TP / SL handling ----------------
 * Only apply relabeling if triggerType was provided.
 * If not, leave as manual — no recalculation.
 */
{
  if (triggerType) {
    const pct = ((closedRow.exitPriceUSD - closedRow.entryPriceUSD) /
                closedRow.entryPriceUSD) * 100;

    const relabel =
      pct >  1   ? "tp" :
      pct < -1   ? "sl" :
      undefined;

    const label = relabel === triggerType ? triggerType : relabel;

    closedRow.triggerType = label;

    const rawStrat  = closedRow.strategy || strategy || "manual";
    const baseStrat = rawStrat.replace(/-?(tp|sl)$/i, "");

    closedRow.strategy = label
      ? `${baseStrat}-${label.toUpperCase()}`
      : baseStrat;
  } else {
    closedRow.triggerType = undefined;

    const rawStrat  = closedRow.strategy || strategy || "manual";
    const baseStrat = rawStrat.replace(/-?(tp|sl)$/i, "");

    closedRow.strategy = baseStrat;
  }
}
    /* strategy & metadata */
    closedRow.exitedAt  = new Date().toISOString();
    closedRow.walletLabel = walletLabel;

    /* ---------- persist closed-trades ---------- */
    const existingClosed = readJSONSafe(CLOSED_TRADES_FILE);
    fs.writeFileSync(
      CLOSED_TRADES_FILE,
      JSON.stringify([...existingClosed, closedRow], null, 2)
    );

    /* analytics log */
    await logTrade(closedRow);

     // keep snapshots fresh ⏱️
    pruneAndRoll()

    /* ---------- response ---------- */
    res.json({
      message   : "FIFO sell complete",
      removed   : toLog.length,
      fullySold : toLog.filter((r) => !r.partial).length,
      partials  : toLog.filter((r) =>  r.partial).length,
    });
  } catch (err) {
    console.error("❌ FIFO sell error:", err);
    res.status(500).json({ error: "Failed to reduce open trades." });
  }
});




module.exports = router;
