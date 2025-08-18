// routes/trades.route.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const express  = require("express");
const router   = express.Router();
const { v4: uuid } = require("uuid");
const prisma   = require("../prisma/prisma");
const requireAuth = require("../middleware/requireAuth");
const requireInternalOrAuth = require("../middleware/requireInternalOrAuth");
const { PublicKey } = require("@solana/web3.js");   // ✅ needed in /positions
//  const loadSettings  = require("../telegram/utils/tpSlStorage").loadSettings; 
const { convertToCSV, convertToTaxCSV } = require("../services/utils/analytics/exportToCSV");
const { getTokenName }  = require("../services/utils/analytics/getTokenName");
const { getCachedPrice } = require("../utils/priceCache.static");
const getTokenPrice     = require("../services/strategies/paid_api/getTokenPrice");
const { closePositionFIFO }  = require("../services/utils/analytics/fifoReducer");
// Import job runner to enforce idempotency on FIFO sells AND POST /open
const { runJob } = require("../services/jobs/jobRunner");
const { getCurrentWallet, getWalletBalance } = require("../services/utils/wallet/walletManager");
const { getTokenAccountsAndInfo, getMintDecimals } = require("../utils/tokenAccounts");
const getTokenMetadata = require("../services/strategies/paid_api/getTokenMetadata")
const SOL_MINT = "So11111111111111111111111111111111111111112";
const { Prisma } = require("@prisma/client");

// ── Pagination helper (idempotent) ───────────────────────────────────────────
function __getPage(req, defaults = { take: 100, skip: 0, cap: 500 }) {
  const cap  = Number(defaults.cap || 500);
  let take   = parseInt(req.query?.take ?? defaults.take, 10);
  let skip   = parseInt(req.query?.skip ?? defaults.skip, 10);
  if (!Number.isFinite(take) || take <= 0) take = defaults.take;
  if (!Number.isFinite(skip) || skip <  0) skip = defaults.skip;
  take = Math.min(Math.max(1, take), cap);
  skip = Math.max(0, skip);
  return { take, skip };
}
// ─────────────────────────────────────────────────────────────────────────────

// Stable-coin mints we ignore in positions
const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",  // USDH
  "7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT"  // UXD
]);

const EXCLUDE_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCER9SADJdTjaiCviCqiSBamEn3DcSjh3rCt", // USDC (legacy)
]);

// Daily recap timezone (kept from original)
const PDT_ZONE = "America/Los_Angeles";
const MIN_IMPORT_USD = 0.25; 

router.use(requireAuth);      // all routes below are now authenticated

// Inject any on-chain tokens that aren’t yet in the trades table
// (or whose balance grew outside the app, e.g. bought on-DEX)
const injectUntracked = async (userId) => {
  let wroteSomething = false;

  /* ── 1. All wallets for this user ────────────────────────────── */
  const wallets = await prisma.wallet.findMany({
    where  : { userId },
    select : { id: true, label: true, publicKey: true }
  });

  for (const w of wallets) {
    /* ── 2. Live token balances on chain ───────────────────────── */
    const balances = await getTokenAccountsAndInfo(new PublicKey(w.publicKey));

    for (const { mint, amount } of balances) {
      /* Skip dust / excluded mints (amount==0 or in EXCLUDE list) */
      if (amount <= 0 || EXCLUDE_MINTS.has(mint)) continue;

      /* ── 2a. Fetch decimals & USD value ─────────────────────── */
      const decimals = await getMintDecimals(mint).catch(() => 0);
      const price    = await getCachedPrice(mint) ??
                       await getTokenPrice(userId, mint);

      const valueUsd = (Number(amount) / 10 ** decimals) * price;

      /* 🚫 Skip if worth ≤ $0.25 */
      if (valueUsd <= MIN_IMPORT_USD) {
        console.log(`⏭️  injectUntracked skipped ${mint} (${w.label}) — $${valueUsd.toFixed(3)}`);
        continue;
      }

      /* ── 3. Raw balance, already-tracked amount, delta ───────── */
      const rawBalance = BigInt(Math.floor(Number(amount) * 10 ** decimals));

      const trackedRows = await prisma.trade.findMany({
        where  : { walletId: w.id, mint, exitedAt: null },
        select : { outAmount: true, closedOutAmount: true }
      });

      const trackedAmt = trackedRows.reduce((sum, row) => {
        const closed = row.closedOutAmount ?? 0n;
        return sum + (row.outAmount - closed);
      }, 0n);

      if (trackedAmt >= rawBalance) continue;            // fully covered

      const delta = rawBalance - trackedAmt;
      if (delta === 0n) continue;

      /* ── 4. Inject missing Δ into trades table ──────────────── */
      await prisma.trade.create({
        data: {
          mint,
          tokenName       : await getTokenName(mint).catch(() => null),
          entryPrice      : null,
          entryPriceUSD   : null,
          inAmount        : 0n,
          outAmount       : delta,
          closedOutAmount : 0n,
          strategy        : "unknown",
          walletLabel     : w.label,
          unit            : "token",
          decimals,
          type            : "import",
          side            : "import",
          botId           : "import",
          walletId        : w.id
        }
      });

      wroteSomething = true;
      console.log(`🆕 Injected → ${mint} (${w.label})  Δ ${delta}`);
    }
  }

  return wroteSomething;
};

/* ───────────────────────────── 1. RECENT CLOSED TRADES ─────────────────────────── */
router.get("/", async (req, res) => {
  try {
    // Support pagination via ?take and ?skip query params while enforcing
    // reasonable caps. By default we return the 100 most recent closed
    // trades. Clients may request fewer or more items up to a hard cap of
    // 500 to prevent overly large responses. Negative values are coerced to
    // zero.
    let { take = 100, skip = 0 } = req.query;
    take = Math.min(parseInt(take, 10) || 100, 500);
    skip = Math.max(parseInt(skip, 10) || 0, 0);

    const rows = await prisma.closedTrade.findMany({
      where  : { wallet: { userId: req.user.id } },
      orderBy: { exitedAt: "desc" },
      take,
      skip,
    });

    // Populate missing token names via the metadata helper. Since tokenName
    // may be null in the DB we resolve it on the fly. This runs in
    // parallel for efficiency.
    await Promise.all(rows.map(async (r) => {
      if (!r.tokenName) r.tokenName = await getTokenName(r.mint);
    }));

    const safeRows = rows.map((row) => ({
      ...row,
      inAmount: Number(row.inAmount),
      outAmount: Number(row.outAmount),
      closedOutAmount: Number(row.closedOutAmount),
    }));

    res.json(safeRows);
  } catch (err) {
    console.error("closed / error:", err);
    res.status(500).json({ error: "Failed to fetch trades." });
  }
});

/* ───────────────────────────── 1a. SIMPLE LIST (open trade rows) ───────────────── */
router.get("/list", async (req, res) => {
  try {
    const { take, skip } = __getPage(req);
    const trades = await prisma.trade.findMany({
      where: { wallet: { userId: req.user.id }, exitedAt: null },
      select: { id: true, mint: true, inAmount: true, outAmount: true, createdAt: true, exitedAt: true },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    });
    const safe = trades.map(t => ({
      ...t,
      inAmount: Number(t.inAmount),
      outAmount: Number(t.outAmount),
    }));
    res.json({ trades: safe, take, skip });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ───────────────────────────── 2. HISTORY (with filters) ───────────────────────── */
router.get("/history", async (req, res) => {
  // Accept RFC3339 timestamps or YYYY-MM-DD strings for `from` and `to`.
  // Support pagination via `limit` (take) and `offset` (skip). Cap the
  // limit at 500 and coerce negative values to zero.
  const { from, to, limit = 300, offset = 0 } = req.query;

  const where = { wallet: { userId: req.user.id } };
  if (from || to) {
    where.exitedAt = {};
    if (from) where.exitedAt.gte = new Date(from);
    if (to)   where.exitedAt.lt  = new Date(to);
  }

  let take = parseInt(limit, 10);
  let skip = parseInt(offset, 10);
  take = Math.min(Number.isNaN(take) ? 300 : take, 500);
  skip = Math.max(Number.isNaN(skip) ? 0 : skip, 0);

  try {
    const rows = await prisma.closedTrade.findMany({
      where,
      orderBy: { exitedAt: "desc" },
      skip,
      take,
    });

    await Promise.all(rows.map(async (r) => {
      if (!r.tokenName) r.tokenName = await getTokenName(r.mint);
    }));

    const safeRows = rows.map((row) => ({
      ...row,
      inAmount: Number(row.inAmount),
      outAmount: Number(row.outAmount),
      closedOutAmount: Number(row.closedOutAmount),
    }));

    res.json(safeRows);
  } catch (err) {
    console.error("history / error:", err);
    res.status(500).json({ error: "Failed to fetch trade history." });
  }
});

/* ───────────────────────────── 3. CSV DOWNLOAD ─────────────────────────────────── */
router.get("/download", async (req, res) => {
  const { from, to, strategy = "all", preset = "raw" } = req.query;

  const w = { wallet: { userId: req.user.id } };
  if (from || to) {
    w.exitedAt = {};
    if (from) w.exitedAt.gte = new Date(from);
    if (to)   w.exitedAt.lt  = new Date(to);
  }
  if (strategy !== "all") w.strategy = { startsWith: strategy };

  const rows = await prisma.closedTrade.findMany({ where: w, orderBy:{ exitedAt:"asc" }});

  const csv   = preset === "tax" ? convertToTaxCSV(rows) : convertToCSV(rows);
  const dater = d => (d ? new Date(d).toISOString().slice(0,10) : "");
  const fname = preset === "tax"
      ? `tax-report-${dater(from)||"start"}_to_${dater(to)||"now"}.csv`
      : `trades-${dater(from)||"start"}_to_${dater(to)||"now"}.csv`;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${fname}`);
  res.send(csv);
});

/* ───────────────────────────── 4. DAILY PN-L RECAP ─────────────────────────────── */
router.get("/recap", async (req,res)=>{
  try{
    const start = new Date();
    start.setHours(0,0,0,0);
    const tomorrow = new Date(start); tomorrow.setDate(start.getDate()+1);

    const rows = await prisma.closedTrade.findMany({
      where:{
        wallet:{userId:req.user.id},
        exitedAt:{ gte:start, lt:tomorrow },
        NOT:{ strategy:"paperTrader" }       // 🚫 exclude paper
      }
    });

    let wins=0,losses=0,net=0,best=null,worst=null;
    for(const t of rows){
      const pct=((t.exitPriceUSD-t.entryPriceUSD)/t.entryPriceUSD)*100;
      pct>=0?wins++:losses++; net+=pct;
      if(!best || pct>(best.gainLossPct??-Infinity)) best={...t,gainLossPct:pct};
      if(!worst|| pct<(worst.gainLossPct?? Infinity))worst={...t,gainLossPct:pct};
    }
    res.json({
      date:new Date().toLocaleDateString("en-US",{timeZone:PDT_ZONE}),
      totalTrades:wins+losses,wins,losses,
      netPnL:+net.toFixed(2),bestTrade:best,worstTrade:worst
    });
  }catch(err){
    console.error("recap err:",err);
    res.status(500).json({ error:"Failed to build recap" });
  }
});

/*─────────────────────────── 5. STRATEGY-SPECIFIC LOGS (legacy) ───────────*/
router.get("/:strategy/logs", (req,res)=>{
  const fs = require("fs"); const path=require("path");
  const file = path.join(__dirname,"..","logs",`${req.params.strategy}.json`);
  if(!fs.existsSync(file)) return res.status(404).json({error:"No log for strategy"});
  res.json(JSON.parse(fs.readFileSync(file,"utf8")).slice(-20).reverse());
});

/* ───────────────────────────── 5. OPEN POSITIONS DASHBOARD ─────────────────────── */
router.get("/positions", requireInternalOrAuth, async (req, res) => {
  try {
    /* 0️⃣ Ensure DB has every current on-chain holding */
    const didInject = await injectUntracked(req.user.id);
    /* 1️⃣ Which wallet?  activeWalletId unless ?walletLabel provided */
    
    let active = await prisma.user.findUnique({
      where : { id: req.user.id },
      select: { activeWalletId: true }
    });

    const walletFilter = {};
    if (req.query.walletLabel) {
      walletFilter.label = req.query.walletLabel;
    } else if (active?.activeWalletId) {
      walletFilter.id = active.activeWalletId;
    }

    const wallet = await prisma.wallet.findFirst({
      where : { userId: req.user.id, ...walletFilter },
    });
    if (!wallet)
      return res.status(404).json({ error: "No wallet found for user." });

    /* 2️⃣ On-chain token balances */
    const connWallet = { publicKey: new PublicKey(wallet.publicKey) };
    const tokenAccounts = await getTokenAccountsAndInfo(connWallet.publicKey);

    /* 3️⃣ Open trades (DB) for this wallet */
    const allRows = await prisma.trade.findMany({
      where : { wallet: { userId: req.user.id } },
      orderBy: { timestamp: "asc" },
    });
    
    // keep only rows that still have tokens left
    const openRows = allRows.filter(r =>
      BigInt(r.closedOutAmount ?? 0) < BigInt(r.outAmount ?? 0)
    );

    /* 4️⃣ Prices */
    const solBalance = await getWalletBalance(connWallet);
    const solPrice   = await getCachedPrice(SOL_MINT, { readOnly:true });

    // const settings     = loadSettings();
    // const userSettings = settings[wallet.label] || {}; // tp/sl per wallet
    const tpSlRules = await prisma.tpSlRule.findMany({
      where: { userId: req.user.id, walletId: wallet.id, status: "active" },
    });
    const userSettings = {};
    tpSlRules.forEach(rule => {
      userSettings[rule.mint] = {
        tp: rule.tp,
        sl: rule.sl,
        enabled: rule.enabled,
        entryPrice: rule.entryPrice,
      };
    });
    /* 5️⃣ Assemble positions ------------------------------------ */
    const positions = [];

    for (const { mint, name, amount } of tokenAccounts) {
      const metadata   = await getTokenMetadata(req.user.id, mint);
      const tokenName  = metadata?.name || name?.replace(/[^\x20-\x7E]/g, "") || "Unknown";
      const symbol     = metadata?.symbol || null;
      const birdeyeUrl = `https://birdeye.so/token/${mint}`;
      let logoUri = null;

      const rawUri = metadata.logo_uri;

      if (rawUri.includes("fotofolio.xyz") && rawUri.includes("url=")) {
        logoUri = decodeURIComponent(rawUri.split("url=")[1]);

      } else if (rawUri.startsWith("ipfs://")) {
        const ipfsHash = rawUri.replace("ipfs://", "");
        logoUri = `https://ipfs.io/ipfs/${ipfsHash}`; // ✅ use ipfs.io

      } else if (rawUri.includes("ipfs.io/ipfs/")) {
        logoUri = rawUri; // already correct

      } else if (rawUri.includes("/ipfs/")) {
        const ipfsHash = rawUri.split("/ipfs/")[1];
        logoUri = `https://ipfs.io/ipfs/${ipfsHash}`; // ✅ fallback

      } else {
        logoUri = rawUri; // normal https:// URL
      }
      if (STABLES.has(mint) || amount < 1e-6) continue;

      const matches   = openRows.filter(r => r.mint === mint);
      // --- correct for units -------------------------------
      const totalCostSOL = matches.reduce(
        (s,r)=> s + Number(r.inAmount) / 1e9, 0);       // lamports → SOL
      
      const totalTokReal = matches.reduce(
        (s,r)=> s + Number(r.outAmount) / 10**r.decimals, 0); // raw → tokens
      
      const weightedEntry = totalTokReal
        ? +(totalCostSOL / totalTokReal).toFixed(9)      // SOL per token
        : null;
      
      const totalCostUSD = matches.reduce(
        (s,r)=> s + (Number(r.outAmount) / 10**r.decimals) * r.entryPriceUSD, 0);
      
      const entryPriceUSD = totalTokReal
        ? +(totalCostUSD / totalTokReal).toFixed(6)
        : null;

      const price   = await getTokenPrice(req.user.id, mint);
      const valueUSD= +(amount * price).toFixed(2);
      const tpSl    = userSettings[mint] || null;
      console.log("🖼️ Logo for", tokenName, mint, "→", logoUri);

      positions.push({
        mint,
        name: tokenName,
        symbol,
        logo: logoUri,
        amount,
        price,
        valueUSD,
        valueSOL : +(valueUSD/solPrice).toFixed(4),
        entryPrice      : weightedEntry,
        entryPriceUSD,
        inAmount: +(totalCostSOL).toFixed(6),
        strategy        : matches[0]?.strategy ?? "manual",
        entries         : matches.length,
        timeOpen        : matches[0] ? new Date(matches[0].timestamp).toLocaleString() : null,
        tpSl : tpSl ? { tp:tpSl.tp, sl:tpSl.sl, enabled:tpSl.enabled!==false } : null,
        url: birdeyeUrl,
      });
    }

    /* 6️⃣ Tokens that are SOLD (row exists, balance zero) -------- */
    const seen = new Set(positions.map(p=>p.mint));
    for (const r of openRows) {
      if (seen.has(r.mint) || STABLES.has(r.mint)) continue;
      const price = await getTokenPrice(req.user.id,r.mint);
      positions.push({
        mint : r.mint,
        name : await getTokenName(r.mint) || "Unknown",
        amount:0, price, valueUSD:0, valueSOL:0,
        entryPrice:null, entryPriceUSD:null,
        inAmount:0, strategy:r.strategy,
        entries:0, timeOpen:null,
        tpSl:null,
        url:`https://birdeye.so/token/${r.mint}`
      });
    }

    /* 7️⃣ SOL + USDC summary */
    const usdcAcc = tokenAccounts.find(
      t=>t.mint==="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const usdcVal = usdcAcc ? usdcAcc.amount*1 : 0;
    const solVal  = solBalance*solPrice;

    res.json({
      netWorth: +(solVal + usdcVal + positions.reduce((s,t)=>s+t.valueUSD,0)).toFixed(2),
      sol: { amount: solBalance, price: solPrice, valueUSD: solVal },
      usdc: usdcAcc ? { amount: usdcAcc.amount, valueUSD: usdcVal } : null,
      positions,
      refetchOpenTrades: didInject  // 👈 new field!
    });
  } catch (err) {
    console.error("❌ /positions error:", err);
    res.status(500).json({ error:"Failed to fetch token positions" });
  }
});

/*─────────────────────────── 5. GET CURRENT OPEN TRADES ──────────────────*/
router.get("/open", async (req, res) => {
  try {
    console.log(`➡️ API HIT: GET /trades/open for user ${req.user.id}`);
    const { take, skip } = __getPage(req, { take: 100, cap: 500 });

    // Fetch only OPEN rows from DB and paginate there.
    const rows = await prisma.trade.findMany({
      where: { wallet: { userId: req.user.id }, exitedAt: null },
      orderBy: { timestamp: "asc" },
      take,
      skip
    });

    // Ensure only positions with a remaining amount are returned (defensive)
    const openTrades = rows.filter(trade =>
      BigInt(trade.outAmount || 0) > BigInt(trade.closedOutAmount || 0)
    );

    // Convert BigInt to Number for JSON safety
    const safeTrades = openTrades.map(trade => ({
      ...trade,
      inAmount: Number(trade.inAmount),
      outAmount: Number(trade.outAmount),
      closedOutAmount: Number(trade.closedOutAmount),
    }));

    console.log(`🎯 Found ${safeTrades.length} open trades for user ${req.user.id}`);
    res.json(safeTrades);
  } catch (err) {
    console.error("🚨 GET /open error:", err);
    res.status(500).json({ error: "Failed to fetch open trades." });
  }
});

/* ───────────────────────────── 6. LOG NEW OPEN TRADE (IDEMPOTENT) ──────────────── */
router.post("/open", async (req, res) => {
  const idKey =
    req.get("Idempotency-Key") || req.headers["idempotency-key"] || null;

  const toBig = (v, def = 0n) => {
    try {
      if (v === null || v === undefined || v === "") return def;
      if (typeof v === "bigint") return v;
      if (typeof v === "number") {
        if (!Number.isFinite(v)) return def;
        return BigInt(Math.trunc(v));
      }
      if (typeof v === "string") {
        const s = v.trim();
        if (s === "") return def;
        // strip decimals if someone passed a float string
        return BigInt(s.includes(".") ? s.split(".")[0] : s);
      }
      return def;
    } catch {
      return def;
    }
  };

  const doWork = async () => {
    const {
      mint,
      entryPrice,
      entryPriceUSD,
      inAmount,
      outAmount,
      unit = "sol",
      decimals = 9,
      strategy = "manual",
      slippage = 1,
      walletLabel = "",
      walletId: bodyWalletId, // NEW: allow direct walletId
    } = req.body || {};

    if (!mint || entryPrice == null || inAmount == null) {
      return { status: 400, response: { error: "Missing data" } };
    }

    // Resolve target wallet:
    // 1) explicit walletId, 2) walletLabel, 3) user's activeWalletId
    let wallet = null;

    if (bodyWalletId != null) {
      wallet = await prisma.wallet.findFirst({
        where: { id: Number(bodyWalletId), userId: req.user.id },
      });
    } else if (walletLabel) {
      wallet = await prisma.wallet.findFirst({
        where: { userId: req.user.id, label: walletLabel },
      });
    } else {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { activeWalletId: true },
      });
      if (user?.activeWalletId != null) {
        wallet = await prisma.wallet.findFirst({
          where: { id: user.activeWalletId, userId: req.user.id },
        });
      }
    }

    if (!wallet) {
      return { status: 404, response: { error: "Wallet not found." } };
    }

    const data = {
      mint,
      tokenName: await getTokenName(mint),
      entryPrice: Number(entryPrice),
      entryPriceUSD:
        entryPriceUSD == null ? null : Number(entryPriceUSD),
      inAmount: toBig(inAmount),             // BigInt
      outAmount: toBig(outAmount, 0n),       // BigInt
      closedOutAmount: 0n,                   // BigInt
      unit,
      decimals: Number(decimals) || 9,
      strategy,
      slippage: Number(slippage) || 1,
      walletId: wallet.id,
      walletLabel: wallet.label,             // keep label for convenience
      type: "buy",
      side: "buy",
      botId: strategy,
      userId: req.user.id,                   // ✅ required by schema
      // optional fields left null: exitPrice, exitPriceUSD, usdValue, etc.
    };

    await prisma.trade.create({ data });

    return { status: 200, response: { message: "Open trade logged." } };
  };

  try {
    if (idKey) {
      const jobResult = await runJob(idKey, doWork);
      return res
        .status(jobResult.status || 200)
        .json(jobResult.response || {});
    } else {
      const direct = await doWork();
      return res
        .status(direct.status || 200)
        .json(direct.response || {});
    }
  } catch (err) {
    console.error("❌ POST /open error:", err);
    res
      .status(500)
      .json({ error: err.message || "Failed to log open trade." });
  }
});

/* ───────────────────────────── 7. CLOSE / REDUCE POSITION ──────────────────────── */
// Legacy FIFO close endpoint. Use the idempotent version defined below.
router.patch("/open-old/:mint", requireAuth, async (req,res)=>{
  try {
    const { user } = req;               // requireAuth injects user
    const mint = req.params.mint;
    const result = await closePositionFIFO({
      userId : user.id,
      mint,
      ...req.body
    });
    res.json({ message:"FIFO sell complete", ...result });
  } catch(err){
    console.error("❌ FIFO sell error:", err);
    res.status(400).json({ error: err.message });
  }
});

// Idempotent FIFO close endpoint.
router.patch("/open/:mint", requireAuth, async (req, res) => {
  const idKey = req.get('Idempotency-Key') || req.headers['idempotency-key'] || null;
  try {
    const jobResult = await runJob(idKey, async () => {
      try {
        const { user } = req;
        const mint = req.params.mint;
        const result = await closePositionFIFO({
          userId : user.id,
          mint,
          ...req.body
        });
        return { status: 200, response: { message: "FIFO sell complete", ...result } };
      } catch (err) {
        // Pass through domain errors as 400
        return { status: 400, response: { error: err.message } };
      }
    });
    res.status(jobResult.status || 200).json(jobResult.response || {});
  } catch (err) {
    console.error("❌ FIFO sell error:", err);
    res.status(500).json({ error: err.message || "FIFO sell failed." });
  }
});

/*─────────────────────────── 9. DELETE ALL OPEN FOR MINT ─────────────────*/
router.delete("/open/:mint", async (req,res)=>{
  const { mint }=req.params; const { walletLabel="" }=req.body||{};
  const wallet = await prisma.wallet.findFirst({
    where:{ userId:req.user.id, label:walletLabel }
  });
  if(!wallet) return res.status(404).json({ error:"Wallet not found." });

  await prisma.trade.deleteMany({
    where:{
      walletId:wallet.id,
      mint,
      closedOutAmount:{ lt: Prisma.field("outAmount") }
    }
  });
  res.json({ message:`Open rows for ${mint} removed.` });
});

// ──────────────────────────────────────────────────────────────
//  POST /api/trades/clear-dust
//  • Marks every open trade whose **USD value ≤ 0.25** OR whose
//    remaining token amount is 0   as exited (triggerType = “dust”)
// ──────────────────────────────────────────────────────────────
router.post("/clear-dust", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const { walletId, hardDelete = true, minDustUsd = 0.25 } = req.body ?? {};

  // only OPEN trades are considered dust-candidates
  const where = { exitedAt: null, wallet: { userId } };
  if (walletId) {
    where.walletId = walletId;
    delete where.wallet;
  }

  const openTrades = await prisma.trade.findMany({ where });
  let deleted = 0, closed = 0;

  // batch ops for speed/atomicity
  const tx = [];

  for (const t of openTrades) {
    const remaining = t.outAmount - t.closedOutAmount; // BigInt
    if (remaining <= 0n) continue;

    const priceUsdRaw =
      (await getCachedPrice(t.mint)) ?? (await getTokenPrice(userId, t.mint));
    const priceUsd = Number(priceUsdRaw ?? 0); // if price unknown, treat as 0 (pure dust)

    const remTokens = Number(remaining) / 10 ** (t.decimals ?? 0);
    const remUsd = remTokens * priceUsd;

    if (remUsd <= minDustUsd) {
      if (hardDelete) {
        // try to hard-delete first
        tx.push(
          prisma.trade.delete({ where: { id: t.id } })
            .then(() => { deleted++; })
            .catch(() => {
              // FK blocked → soft-close instead
              return prisma.trade.update({
                where: { id: t.id },
                data: {
                  closedOutAmount: t.outAmount,
                  exitPrice: priceUsd || undefined,
                  exitPriceUSD: priceUsd || undefined,
                  triggerType: "dust",
                  exitedAt: new Date(),
                },
              }).then(() => { closed++; });
            })
        );
      } else {
        // legacy behavior: just mark closed
        tx.push(
          prisma.trade.update({
            where: { id: t.id },
            data: {
              closedOutAmount: t.outAmount,
              exitPrice: priceUsd || undefined,
              exitPriceUSD: priceUsd || undefined,
              triggerType: "dust",
              exitedAt: new Date(),
            },
          }).then(() => { closed++; })
        );
      }
    }
  }

  if (tx.length) await prisma.$transaction(tx);

  res.json({ message: "Dust trades cleared.", deleted, closed });
});

/*─────────────────────────── 9-b. BULK DELETE SELECTED MINTS ─────────────────*/
router.delete("/open", requireAuth, async (req, res) => {
  const { mints = [], walletId, forceDelete = false } = req.body || {};

  if (!Array.isArray(mints) || mints.length === 0) {
    return res.status(400).json({ error: "mints[] array required" });
  }
  if (!walletId) {
    return res.status(400).json({ error: "walletId required" });
  }

  const wallet = await prisma.wallet.findFirst({
    where: { id: walletId, userId: req.user.id }
  });

  if (!wallet) {
    return res.status(404).json({ error: "Wallet not found." });
  }

  for (const mint of mints) {
    if (forceDelete) {
      await prisma.trade.deleteMany({
        where: { walletId: wallet.id, mint, exitedAt: null }
      });
    } else {
      await prisma.trade.updateMany({
        where: { walletId: wallet.id, mint, exitedAt: null },
        data: {
          closedOutAmount: Prisma.field("outAmount"),
          triggerType: "manualDelete",
          exitedAt: new Date()
        }
      });
    }
  }

  res.json({ message: `${mints.length} mint(s) cleared from open trades.` });
});

/* ------------------------------------------------------------------------------ */
module.exports = router;
