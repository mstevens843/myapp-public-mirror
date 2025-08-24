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


// ── Metadata cache (name/symbol/logo) ──────────────────────────────────────────
const META_TTL_MS = 168 * 60 * 60 * 1000; // 24h; metadata only (prices NOT cached)
const _metaCache = new Map(); // mint -> { ts, name, symbol, logo }

// Thresholds aligned with getFullNetWorth.js (dust/liquidity/staleness)
const DUST_USD = 0.05;               // same as Net Worth app mode
const LIQ_FLOOR_USD = 1000;          // same as Net Worth guardrail
const MAX_PRICE_STALENESS_SEC = 6 * 3600; // same as Net Worth guardrail

function normalizeLogo(uri) {
  if (!uri || typeof uri !== "string") return null;
  try {
    // fotofolio passthrough support
    if (uri.includes("fotofolio") && uri.includes("url=")) {
      const u = new URL(uri);
      const real = u.searchParams.get("url");
      if (real) return decodeURIComponent(real);
    }
    // ipfs://… → https://ipfs.io/ipfs/…
    if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
    if (uri.includes("/ipfs/") && !uri.includes("ipfs.io/ipfs/")) {
      const after = uri.split("/ipfs/")[1];
      if (after) return `https://ipfs.io/ipfs/${after}`;
    }
    return uri;
  } catch {
    return uri;
  }
}

async function fetchMetaForMints(userId, mints = []) {
  const out = {};
  const now = Date.now();
  const need = [];

  for (const mint of new Set(mints.filter(Boolean))) {
    const hit = _metaCache.get(mint);
    if (hit && now - hit.ts < META_TTL_MS) {
      out[mint] = { name: hit.name, symbol: hit.symbol, logo: hit.logo };
    } else {
      need.push(mint);
    }
  }

  // Fetch missing ones; NOTE: we do NOT cache prices here—metadata only.
  for (const mint of need) {
    try {
      const meta = await getTokenMetadata(userId, mint).catch(() => null);
      const rec = {
        ts: now,
        name: (meta?.name || "").replace(/[^\x20-\x7E]/g, "") || "Unknown",
        symbol: meta?.symbol || "",
        logo: normalizeLogo(meta?.logo_uri || meta?.logoURI || meta?.logo || ""),
      };
      _metaCache.set(mint, rec);
      out[mint] = { name: rec.name, symbol: rec.symbol, logo: rec.logo };
    } catch {
      // Keep unknown; don't poison cache permanently.
    }
  }
  return out;
}



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
const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD || 1000);


router.use(requireAuth);      // all routes below are now authenticated

// Inject any on-chain tokens that aren’t yet in the trades table
// (or whose balance grew outside the app, e.g. bought on-DEX)
const priceMod_TRADES = require("../services/strategies/paid_api/getTokenPrice");
const getTokenPrice_TRADES =
  typeof priceMod_TRADES === "function" ? priceMod_TRADES : priceMod_TRADES.getTokenPrice;
const getPricesWithLiquidityBatch_TRADES =
  priceMod_TRADES.getPricesWithLiquidityBatch || (async (userId, mints)=>{
    // fallback: per-mint (should not happen if file updated)
    const out = {};
    for (const m of mints) out[m] = { price: await getTokenPrice_TRADES(userId, m), liquidity: 0, updateUnixTime: 0 };
    return out;
  });



async function injectUntracked(userId) {
  let wroteSomething = false;

  // 1) All wallets for this user
  const wallets = await prisma.wallet.findMany({
    where  : { userId },
    select : { id: true, label: true, publicKey: true }
  });

  for (const w of wallets) {
    // 2) Live token balances on chain
    const balances = await getTokenAccountsAndInfo(new PublicKey(w.publicKey));
    const entries = balances
      .filter(({ mint, amount }) => amount > 0 && !EXCLUDE_MINTS.has(mint));

    if (entries.length === 0) continue;

    // 2a) Batch quote all mints with liquidity
    const mints = entries.map(e => e.mint);
    const quotes = await getPricesWithLiquidityBatch_TRADES(userId, mints);

    for (const { mint, amount } of entries) {
      const q = quotes[mint] || {};
      const price = Number(q.price || 0);
      const liquidity = Number(q.liquidity || 0);
      const updateUnixTime = Number(q.updateUnixTime || 0);
      const fresh = updateUnixTime && ((Date.now()/1e3) - updateUnixTime) <= MAX_PRICE_STALENESS_SEC;

      // Dust/quality gates
      const uiAmount = Number(amount); // already UI units
      const valueUsd = uiAmount * price;
      if (valueUsd <= MIN_IMPORT_USD) continue;               // skip dust
      if (!fresh || liquidity < MIN_LIQUIDITY_USD) continue;  // skip illiquid/stale

      // 3) Raw balance, already-tracked amount, delta
      const decimals = await getMintDecimals(mint).catch(() => 0);
      const rawBalance = BigInt(Math.floor(uiAmount * 10 ** decimals));

      const trackedRows = await prisma.trade.findMany({
        where  : { walletId: w.id, mint, exitedAt: null },
        select : { outAmount: true, closedOutAmount: true }
      });

      const trackedAmt = trackedRows.reduce((sum, row) => {
        const closed = row.closedOutAmount ?? 0n;
        return sum + (row.outAmount - closed);
      }, 0n);

      if (trackedAmt >= rawBalance) continue;
      const delta = rawBalance - trackedAmt;
      if (delta === 0n) continue;

      // 4) Inject missing Δ into trades table
      await prisma.trade.create({
        data: {
          userId: userId,
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
      console.log(`🆕 Injected → ${mint} (${w.label})  Δ ${delta}  $${valueUsd.toFixed(2)}  liq=${liquidity}`);
    }
  }

  return wroteSomething;
}


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
        // 🚫 exclude Paper in daily recap
        NOT:{ strategy: { equals: "Paper Trader", mode: "insensitive" } }
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
    const active = await prisma.user.findUnique({
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
    if (!wallet) return res.status(404).json({ error: "No wallet found for user." });

    /* 2️⃣ On-chain token balances (authoritative source of “new mints”) */
    const connWallet = { publicKey: new PublicKey(wallet.publicKey) };
    const tokenAccounts = await getTokenAccountsAndInfo(connWallet.publicKey);

    /* 3️⃣ Open trades (DB) for this wallet */
    const allRows = await prisma.trade.findMany({
      where : { wallet: { userId: req.user.id } },
      orderBy: { timestamp: "asc" },
    });

    // keep only rows that still have tokens left
    const openRows = allRows.filter(
      (r) => BigInt(r.closedOutAmount ?? 0) < BigInt(r.outAmount ?? 0)
    );

    /* 4️⃣ Prices (ONE batched multi_price call) */
    const solBalance = await getWalletBalance(connWallet);
    const solPrice   = await getCachedPrice(SOL_MINT, { readOnly: true });

    const nowSec = Math.floor(Date.now() / 1e3);

    // Mints currently on-chain (non-stable, non-dust)
    const onchainMints = tokenAccounts
      .filter((t) => !STABLES.has(t.mint) && t.amount >= 1e-6)
      .map((t) => t.mint);

    // “Sold but logged” mints (in DB with remaining rows; not on-chain now)
    const soldMints = Array.from(
      new Set(openRows.map((r) => r.mint))
    ).filter((m) => !STABLES.has(m) && !onchainMints.includes(m));

    // Unique list to quote
    const mintsToQuote = Array.from(new Set([...onchainMints, ...soldMints]));

    // ONE batched hit to Birdeye multi_price?include_liquidity=true
    const quotes = mintsToQuote.length
      ? await getPricesWithLiquidityBatch_TRADES(req.user.id, mintsToQuote)
      : {};

    // Gate helper (liquidity + staleness)
    function priceFor(mint) {
      const q = quotes[mint] || {};
      const price = Number(q.price || 0);
      const liq   = Number(q.liquidity || 0);
      const ut    = Number(q.updateUnixTime || 0);
      const fresh = ut && nowSec - ut <= MAX_PRICE_STALENESS_SEC;
      return fresh && liq >= MIN_LIQUIDITY_USD ? price : 0;
    }

    /* 4b️⃣ Metadata (ONE batched wallet token_list scan + cache; NO per-mint fallback) */
    // Build the set of mints we need metadata for (includes “sold but logged”)
    const metaNeed = Array.from(new Set([...onchainMints, ...soldMints]));

    const metaByMint = {};                 // mint -> { name, symbol, logo }
    const nowMs      = Date.now();
    const cold       = [];                 // misses to look up

    // 1) Serve fresh cache hits immediately
    for (const mint of metaNeed) {
      const hit = _metaCache.get(mint);
      if (hit && nowMs - hit.ts < META_TTL_MS) {
        metaByMint[mint] = { name: hit.name, symbol: hit.symbol, logo: hit.logo };
      } else {
        cold.push(mint);
      }
    }

    // 2) ONE wallet token_list scan to satisfy many mints at once (if available)
    let stillMissing = cold.slice();
    try {
      if (cold.length && typeof scanWalletTokenList === "function" && wallet.publicKey) {
        const scan = await scanWalletTokenList(req.user.id, wallet.publicKey); // Map<mint, {name,symbol,logoURI,decimals}>
        if (scan && scan.size) {
          const nextMissing = [];
          for (const mint of cold) {
            const row = scan.get(mint);
            if (row) {
              const rec = {
                ts    : nowMs,
                name  : (row.name || "").replace(/[^\x20-\x7E]/g, "") || "Unknown",
                symbol: row.symbol || "",
                logo  : normalizeLogo(row.logoURI || row.logo_uri || row.logo || ""),
              };
              _metaCache.set(mint, rec);
              metaByMint[mint] = { name: rec.name, symbol: rec.symbol, logo: rec.logo };
            } else {
              nextMissing.push(mint);
            }
          }
          stillMissing = nextMissing;
        }
      }
    } catch (_) {
      // swallow; if scan fails, we'll leave unknowns and NOT do per-mint lookups
    }

    // 3) NO single-mint metadata fallback (avoid per-mint calls).
    //    Leave any remaining mints as Unknown and fill in over time via cache on future scans.
    for (const mint of stillMissing) {
      if (!metaByMint[mint]) {
        metaByMint[mint] = { name: "Unknown", symbol: "", logo: "" };
      }
    }

    /* 5️⃣ TP/SL rules (unchanged) */
    const tpSlRules = await prisma.tpSlRule.findMany({
      where: { userId: req.user.id, walletId: wallet.id, status: "active" },
    });
    const userSettings = {};
    tpSlRules.forEach((rule) => {
      userSettings[rule.mint] = {
        tp: rule.tp,
        sl: rule.sl,
        enabled: rule.enabled,
        entryPrice: rule.entryPrice,
      };
    });

    /* 6️⃣ Assemble positions ------------------------------------ */
    const positions = [];

    for (const { mint, name, amount } of tokenAccounts) {
      if (STABLES.has(mint) || amount < 1e-6) continue;

      // 🔁 use batched+cached metadata
      const m = metaByMint[mint] || {};
      const tokenName  = m.name || name?.replace(/[^\x20-\x7E]/g, "") || "Unknown";
      const symbol     = m.symbol || null;
      const logoUri    = m.logo || null;
      const birdeyeUrl = `https://birdeye.so/token/${mint}`;

      // Link DB rows for entry calc
      const matches = openRows.filter((r) => r.mint === mint);

      // Units
      const totalCostSOL = matches.reduce((s, r) => s + Number(r.inAmount) / 1e9, 0); // lamports → SOL
      const totalTokReal = matches.reduce((s, r) => s + Number(r.outAmount) / 10 ** r.decimals, 0);
      const weightedEntry = totalTokReal ? +(totalCostSOL / totalTokReal).toFixed(9) : null;

      const totalCostUSD  = matches.reduce(
        (s, r) => s + (Number(r.outAmount) / 10 ** r.decimals) * r.entryPriceUSD,
        0
      );
      const entryPriceUSD = totalTokReal ? +(totalCostUSD / totalTokReal).toFixed(6) : null;

      const price    = priceFor(mint);               // from the ONE batched call
      const valueUSD = +(amount * price).toFixed(2);
      const tpSl     = userSettings[mint] || null;

      positions.push({
        mint,
        name: tokenName,
        symbol,
        logo: logoUri,
        amount,
        price,
        valueUSD,
        valueSOL: +(valueUSD / solPrice).toFixed(4),
        entryPrice: weightedEntry,
        entryPriceUSD,
        inAmount: +totalCostSOL.toFixed(6),
        strategy: matches[0]?.strategy ?? "manual",
        entries: matches.length,
        timeOpen: matches[0] ? new Date(matches[0].timestamp).toLocaleString() : null,
        tpSl: tpSl ? { tp: tpSl.tp, sl: tpSl.sl, enabled: tpSl.enabled !== false } : null,
        url: birdeyeUrl,
      });
    }

    /* 7️⃣ Tokens that are SOLD (row exists, balance zero) -------- */
    const seen = new Set(positions.map((p) => p.mint));
    for (const r of openRows) {
      if (seen.has(r.mint) || STABLES.has(r.mint)) continue;
      const m = metaByMint[r.mint] || {}; // prefer batched meta
      const price = priceFor(r.mint);
      positions.push({
        mint: r.mint,
        name: m.name || "Unknown",   // ⚠️ no per-mint getTokenName
        symbol: m.symbol || null,
        logo: m.logo || null,
        amount: 0,
        price,
        valueUSD: 0,
        valueSOL: 0,
        entryPrice: null,
        entryPriceUSD: null,
        inAmount: 0,
        strategy: r.strategy,
        entries: 0,
        timeOpen: null,
        tpSl: null,
        url: `https://birdeye.so/token/${r.mint}`,
      });
    }

    /* 8️⃣ SOL + USDC summary */
    const usdcAcc = tokenAccounts.find(
      (t) => t.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    );
    const usdcVal = usdcAcc ? usdcAcc.amount * 1 : 0;
    const solVal  = solBalance * solPrice;

    res.json({
      netWorth: +(solVal + usdcVal + positions.reduce((s, t) => s + t.valueUSD, 0)).toFixed(2),
      sol: { amount: solBalance, price: solPrice, valueUSD: solVal },
      usdc: usdcAcc ? { amount: usdcAcc.amount, valueUSD: usdcVal } : null,
      positions,
      refetchOpenTrades: didInject, // 👈 tells UI to refresh trades if we injected new rows
    });
  } catch (err) {
    console.error("❌ /positions error:", err);
    res.status(500).json({ error: "Failed to fetch token positions" });
  }
});


/*─────────────────────────── 5. GET CURRENT OPEN TRADES ──────────────────*/
/*─────────────────────────── helpers ───────────────────────────*/
// ───────────────── helpers ─────────────────
function toPlain(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === "bigint") return v.toString();

  // ✅ Preserve Date values for the UI (used by countdown)
  if (v instanceof Date) return v.toISOString();

  // Prisma Decimal (defensive): convert to number
  if (typeof v === "object" && v?.constructor?.name === "Decimal") {
    try { return Number(v); } catch { return v?.toString?.() ?? String(v); }
  }

  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = toPlain(val);
    return out;
  }
  return v;
}

// ───────────────────────────── 5. OPEN TRADES (single source of truth) ─────────────────────────────
router.get("/open", async (req, res) => {
  try {
    const userId = req.user?.id;
    console.log(`➡️ API HIT: GET /trades/open for user ${userId}`);

    // 0) Make sure DB has any on-chain tokens not yet in trades (imported/untracked)
    //    (same behavior Positions had)
    let didInject = false;
    try {
      didInject = await injectUntracked(userId);
    } catch (e) {
      console.warn("injectUntracked() failed (continuing):", e?.message || e);
    }

    const { take, skip } = __getPage(req, { take: 100, cap: 500 });

    // optional filters
    const walletIdParam = req.query.walletId;
    const walletLabel   = (req.query.walletLabel || "").toString().trim() || undefined;

    let walletId;
    if (walletIdParam != null) {
      walletId = Number(walletIdParam);
      if (!Number.isFinite(walletId)) {
        return res.status(400).json({ error: "walletId must be a number" });
      }
    }

    // By default, INCLUDE imported/unknown so that injected positions appear in UI.
    // You can opt-out with ?includeImports=0
    const includeImports = String(req.query.includeImports ?? "1") !== "0";

    // Build Prisma where clause
    const where = {
      userId,
      exitedAt: null,
      ...(walletId ? { walletId } : {}),
      ...(walletLabel ? { walletLabel } : {}),
    };

    // Preserve old behavior *optionally*: when includeImports=0, narrow to true buy rows and drop unknown/import
    if (!includeImports) {
      where.type = "buy";
      where.strategy = { notIn: ["unknown", "import"] };
    }

    // 1) Grab open rows (newest first)
    const rows = await prisma.trade.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
    });

    // 2) keep rows with remaining amount
    const openTrades = rows.filter(
      (t) => BigInt(t.outAmount ?? 0n) > BigInt(t.closedOutAmount ?? 0n)
    );

    // 3) Collect mints + remaining amounts (UI units)
    const mintsAll = [];
    const remainingUiByMint = new Map(); // mint -> total UI remaining
    for (const t of openTrades) {
      const mint = t.mint;
      if (!mint) continue;
      mintsAll.push(mint);

      const decimals = Number(t.decimals || 0);
      const outRaw   = BigInt(t.outAmount ?? 0n);
      const closedRaw= BigInt(t.closedOutAmount ?? 0n);
      const remRaw   = outRaw - closedRaw;
      const remUi    = Number(remRaw) / Math.pow(10, decimals);
      if (Number.isFinite(remUi)) {
        remainingUiByMint.set(mint, (remainingUiByMint.get(mint) || 0) + remUi);
      }
    }
    const uniqMints = [...new Set(mintsAll.filter(Boolean))];

    // 4) One batched price+liquidity request (same helper Positions uses)
    const quotes = await getPricesWithLiquidityBatch_TRADES(userId, uniqMints); // { mint: {price,liquidity,updateUnixTime} }

    // thresholds consistent with Positions/net worth
    const nowSec = Math.floor(Date.now() / 1e3);
    const allowPrice = (mint) => {
      const q = quotes[mint] || {};
      const fresh = q.updateUnixTime && nowSec - Number(q.updateUnixTime) <= MAX_PRICE_STALENESS_SEC;
      const okLiq = Number(q.liquidity || 0) >= LIQ_FLOOR_USD;
      return fresh && okLiq ? Number(q.price || 0) : 0;
    };

    // 5) One metadata batch (cached); no per-mint fallbacks on hot path
    const meta = await fetchMetaForMints(userId, uniqMints); // cached + wallet token_list scan

    // 6) Build enriched rows
    const enriched = openTrades.map((t) => {
      const mint    = t.mint;
      const price   = allowPrice(mint); // 0 if fails liquidity/staleness guard
      const remain  = remainingUiByMint.get(mint) || 0;
      const entry   = Number(t.entryPriceUSD ?? t.entryPrice ?? 0);
      const spent   = (Number(t.inAmount ?? 0) / Math.pow(10, Number(t.decimals || 0))) * entry;

      const mm = meta[mint] || {};
      return {
        ...toPlain(t), // keep dates usable in UI
        priceUSD  : price,
        remainUi  : remain,
        valueUSD  : remain * price,
        entryPriceUSD: entry,
        spentUSD  : spent,
        name      : mm.name   || t.name   || "",
        symbol    : mm.symbol || t.symbol || "",
        logo      : mm.logo   || t.logo   || "",
      };
    });

    // (Optional) sort by value desc then createdAt desc — same UX as before
    enriched.sort((a, b) => (b.valueUSD - a.valueUSD) || (new Date(b.createdAt) - new Date(a.createdAt)));

    // Return plain array (frontend accepts array or {trades:[]})
    return res.json(enriched);
  } catch (err) {
    console.error("GET /trades/open failed:", err);
    return res.status(500).json({ error: "Failed to load open trades." });
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
  try {
    const { mints = [], walletId, forceDelete = false } = req.body || {};

    // Validate inputs
    if (!Array.isArray(mints) || mints.length === 0) {
      return res.status(400).json({ error: "mints[] array required" });
    }
    const uniqueMints = [...new Set(mints.filter(Boolean))];

    if (walletId == null) {
      return res.status(400).json({ error: "walletId required" });
    }
    const wid = Number(walletId);
    if (!Number.isFinite(wid)) {
      return res.status(400).json({ error: "walletId must be a number" });
    }

    // Wallet ownership check
    const wallet = await prisma.wallet.findFirst({
      where: { id: wid, userId: req.user.id },
      select: { id: true },
    });
    if (!wallet) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    // Hard delete: remove all open trades for the given mints
    if (forceDelete) {
      const del = await prisma.trade.deleteMany({
        where: {
          walletId: wallet.id,
          mint: { in: uniqueMints },
          exitedAt: null, // only open rows
        },
      });
      return res.json({
        message: `${del.count} open trade(s) deleted`,
        deletedCount: del.count,
      });
    }

    // Soft close: set closedOutAmount = outAmount, add exitedAt + triggerType
    // (Prisma can't set a column from another column in updateMany; do it per-row)
    const rows = await prisma.trade.findMany({
      where: {
        walletId: wallet.id,
        mint: { in: uniqueMints },
        exitedAt: null, // only open rows
      },
      select: { id: true, outAmount: true },
    });

    if (rows.length === 0) {
      return res.json({ message: "No matching open trades found.", updatedCount: 0 });
    }

    await prisma.$transaction(
      rows.map((r) =>
        prisma.trade.update({
          where: { id: r.id },
          data: {
            closedOutAmount: r.outAmount, // BigInt → BigInt
            triggerType: "manualDelete",
            exitedAt: new Date(),
          },
        })
      )
    );

    return res.json({
      message: `${rows.length} open trade(s) closed`,
      updatedCount: rows.length,
    });
  } catch (err) {
    console.error("DELETE /trades/open failed:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});




// routes/trades.route.js (append near other GETs)
router.post("/prices/batch", requireAuth, async (req, res) => {
  try {
    const mints = (req.body?.mints || []).filter(Boolean);
    if (!mints.length) return res.json({});

    // Reuse your existing liquidity-aware helpers:
    const { getPricesWithLiquidityBatch } =
      require("../services/strategies/paid_api/getTokenPrice");

    // Decide thresholds centrally (env or sensible defaults)
    const MIN_LIQ = Number(process.env.BIRDEYE_MIN_LIQ_USD || 50_000);
    const STALE_S = Number(process.env.BIRDEYE_STALE_SEC   || 3600);

    const quotes = await getPricesWithLiquidityBatch(req.user.id, mints, {
      minLiquidityUSD: MIN_LIQ,
      maxStaleSeconds: STALE_S,
    });

    // Normalize to { mint: price } with zeroed rejects
    const out = {};
    for (const mint of mints) out[mint] = quotes[mint]?.price || 0;
    res.json(out);
  } catch (err) {
    console.error("batch prices failed:", err);
    res.status(500).json({ error: err.message || "Failed to fetch quotes" });
  }
});



// ✅ PATCH /api/trades/:id/smart-exit — update fields inside Trade.extras
router.patch("/:id/smart-exit", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id must be a number" });
    }

    // Only allow editing open trades owned by the user
    const trade = await prisma.trade.findFirst({
      where: { id, wallet: { userId: req.user.id }, exitedAt: null },
      select: { id: true, extras: true },
    });
    if (!trade) {
      return res.status(404).json({ error: "Open trade not found for user" });
    }

    const body = req.body || {};
    const updates = {};

    // Normalize + validate
    if (body.smartExitMode != null) {
      updates.smartExitMode = String(body.smartExitMode).toLowerCase(); // "time" | "liquidity" | "volume" | "off"
    }
    if (body.timeMaxHoldSec != null) {
      const s = Number(body.timeMaxHoldSec);
      if (!Number.isFinite(s) || s < 0) {
        return res.status(400).json({ error: "timeMaxHoldSec must be >= 0" });
      }
      updates.timeMaxHoldSec = Math.floor(s);
    }
    if (body.smartLiqDropPct != null) {
      const p = Number(body.smartLiqDropPct);
      if (!Number.isFinite(p)) return res.status(400).json({ error: "smartLiqDropPct must be a number" });
      updates.smartLiqDropPct = p;
    }
    if (body.smartVolThreshold != null) {
      const v = Number(body.smartVolThreshold);
      if (!Number.isFinite(v)) return res.status(400).json({ error: "smartVolThreshold must be a number" });
      updates.smartVolThreshold = v;
    }

    // Merge, and drop null/empty + invalid “0 sec” time
    const merged = { ...(trade.extras || {}), ...updates };
    for (const k of Object.keys(merged)) {
      const val = merged[k];
      if (val == null || val === "") delete merged[k];
      if (k === "timeMaxHoldSec" && (!Number.isFinite(Number(val)) || Number(val) <= 0)) {
        delete merged[k];
      }
    }

    const updated = await prisma.trade.update({
      where: { id: trade.id },
      data: { extras: merged },
      select: { id: true, extras: true },
    });

    res.json(updated);
  } catch (err) {
    console.error("PATCH /trades/:id/smart-exit failed:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
});

// ✅ POST /api/trades/:id/smart-exit/cancel — turn it off & clear knobs
router.post("/:id/smart-exit/cancel", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "id must be a number" });
    }

    const trade = await prisma.trade.findFirst({
      where: { id, wallet: { userId: req.user.id }, exitedAt: null },
      select: { id: true, extras: true },
    });
    if (!trade) {
      return res.status(404).json({ error: "Open trade not found for user" });
    }

    const extras = { ...(trade.extras || {}) };
    extras.smartExitMode = "off";
    delete extras.timeMaxHoldSec;
    delete extras.smartLiqDropPct;
    delete extras.smartVolThreshold;
    extras.smartExitCancelledAt = new Date().toISOString();

    const updated = await prisma.trade.update({
      where: { id: trade.id },
      data: { extras },
      select: { id: true, extras: true },
    });

    res.json(updated);
  } catch (err) {
    console.error("POST /trades/:id/smart-exit/cancel failed:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
});














// ─────────────────────────────────────────────────────────────────────────────
// In-memory metadata cache (mint → { data:{name,symbol,logoURI,decimals}, until, pinnedUntil })
//  - base TTL: 24h
//  - pin while mint is in trades: +7d (sliding)
// GC every 60s
// ─────────────────────────────────────────────────────────────────────────────
const PIN_TTL_MS  = 7  * 24 * 60 * 60 * 1000;  // 7d
const metaCache   = new Map(); // mint -> { data, until, pinnedUntil }

function isFresh(rec, now = Date.now()) {
  if (!rec) return false;
  const exp = Math.max(rec.until || 0, rec.pinnedUntil || 0);
  return now < exp;
}

function normalizeLogoURI(raw) {
  const s = (raw || "").toString();
  if (!s) return "";
  if (s.includes("fotofolio.xyz") && s.includes("url=")) {
    try { return decodeURIComponent(s.split("url=")[1]); } catch { return ""; }
  }
  if (s.startsWith("ipfs://")) {
    const hash = s.replace("ipfs://", "");
    return `https://ipfs.io/ipfs/${hash}`;
  }
  if (s.includes("/ipfs/") && !s.includes("ipfs.io/ipfs/")) {
    const hash = s.split("/ipfs/")[1];
    return `https://ipfs.io/ipfs/${hash}`;
  }
  return s;
}

function upsertCache(mint, data, { pin = false } = {}) {
  const prev  = metaCache.get(mint) || {};
  const now   = Date.now();
  const until = now + META_TTL_MS;
  const pinnedUntil = Math.max(prev.pinnedUntil || 0, pin ? (now + PIN_TTL_MS) : 0);
  metaCache.set(mint, { data, until, pinnedUntil });
}

setInterval(() => {
  const now = Date.now();
  for (const [mint, rec] of metaCache) {
    const exp = Math.max(rec.until || 0, rec.pinnedUntil || 0);
    if (now >= exp) metaCache.delete(mint);
  }
}, 60_000);

// ─────────────────────────────────────────────────────────────────────────────
// Coalesced wallet token_list scan (fast timeout ~1.5s). Returns Map<mint, data>
// ─────────────────────────────────────────────────────────────────────────────
const inFlightScans = new Map(); // key = walletPubkey

async function scanWalletTokenList(userId, walletAddress) {
  const key = walletAddress;
  if (inFlightScans.has(key)) return inFlightScans.get(key);

  const p = (async () => {
    try {
      // Try CU-aware wrapper first (if present)
      let resp;
      if (birdeyeCUCounter) {
        resp = await birdeyeCUCounter({
          url: "https://public-api.birdeye.so/defi/wallet/token_list",
          method: "GET",
          params: { address: walletAddress },
          cuCost: (CU_TABLE && CU_TABLE["/defi/wallet/token_list"]) || 1,
          userId,
          timeoutMs: 1500,
        });
      } else {
        // Axios fallback
        const ax = await axios.get(
          "https://public-api.birdeye.so/defi/wallet/token_list",
          {
            params: { address: walletAddress },
            timeout: 1500,
            headers: { "X-API-KEY": process.env.BIRDEYE_API_KEY || "" },
          }
        );
        resp = ax?.data;
      }

      const items = resp?.data?.items || resp?.data || resp?.items || [];
      const out   = new Map();

      for (const it of items) {
        const mint     = it?.address || it?.mint || it?.mintAddress || it?.token_address;
        if (!mint) continue;
        const name     = it?.name || it?.tokenName || "";
        const symbol   = it?.symbol || it?.tokenSymbol || "";
        const logoURI  = normalizeLogoURI(it?.logoURI || it?.logo_uri || it?.logo || "");
        const decimals = (typeof it?.decimals === "number") ? it.decimals : null;
        const data     = { name, symbol, logoURI, decimals };
        out.set(mint, data);
      }
      return out;
    } catch (_) {
      return new Map();
    } finally {
      // let another scan happen after a short window
      setTimeout(() => inFlightScans.delete(key), 1500);
    }
  })();

  inFlightScans.set(key, p);
  return p;
}





// ─────────────────────────────────────────────────────────────────────────────
// POST /wallets/token-meta  — batch metadata for mints
// Body: { mints: string[], walletId?: number, walletLabel?: string, pin?: boolean }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/token-meta", requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    let { mints = [], walletId, walletLabel, pin = false } = req.body || {};
    if (!Array.isArray(mints)) mints = [];
    const uniq = [...new Set(mints.filter(Boolean))];
    if (!uniq.length) return res.json([]);

    // Resolve wallet: prefer explicit walletId → then walletLabel → then user's active → then any user wallet
    let wallet = null;
    if (walletId != null) {
      const wid = Number(walletId);
      if (!Number.isFinite(wid)) return res.status(400).json({ error: "walletId must be a number" });
      wallet = await prisma.wallet.findFirst({ where: { id: wid, userId } });
      if (!wallet) return res.status(404).json({ error: "Wallet not found." });
    } else if (walletLabel) {
      wallet = await prisma.wallet.findFirst({ where: { label: walletLabel, userId } });
    } else {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user?.activeWalletId) {
        wallet = await prisma.wallet.findFirst({ where: { id: user.activeWalletId, userId } });
      }
      if (!wallet) {
        wallet = await prisma.wallet.findFirst({ where: { userId }, orderBy: { id: "asc" } });
      }
    }

    const now = Date.now();
    const out = [];
    const misses = [];

    // First: serve fresh cache hits immediately
    for (const mint of uniq) {
      const rec = metaCache.get(mint);
      if (rec && isFresh(rec, now)) {
        out.push({ mint, ...rec.data });
      } else {
        misses.push(mint);
      }
    }

    // Second: one wallet scan to populate the cache for misses (if wallet known)
    if (misses.length && wallet?.publicKey) {
      const scan = await scanWalletTokenList(userId, wallet.publicKey);
      for (const mint of misses.slice()) {
        const data = scan.get(mint);
        if (data) {
          upsertCache(mint, data, { pin });
          out.push({ mint, ...data });
        }
      }
    }

    // Third: fallback to single-mint metadata for anything still missing (limited, but usually few)
    const stillMissing = misses.filter(m => !out.find(x => x.mint === m));
    for (const mint of stillMissing) {
      try {
        const meta = await getTokenMetadata(userId, mint);
        if (meta) {
          const data = {
            name   : meta?.name   || "",
            symbol : meta?.symbol || "",
            logoURI: normalizeLogoURI(meta?.logo_uri || meta?.logoURI || meta?.logo || "")
          };
          upsertCache(mint, data, { pin });
          out.push({ mint, ...data });
        } else {
          out.push({ mint, name: "", symbol: "", logoURI: "" });
        }
      } catch {
        out.push({ mint, name: "", symbol: "", logoURI: "" });
      }
    }

    // Return only mints the client asked for, in the same order
    const byMint = new Map(out.map(o => [o.mint, o]));
    return res.json(uniq.map(m => byMint.get(m) || { mint: m, name: "", symbol: "", logoURI: "" }));
  } catch (err) {
    console.error("❌ POST /wallets/token-meta error:", err);
    return res.status(500).json([]);
  }
});




/* ------------------------------------------------------------------------------ */
module.exports = router;
