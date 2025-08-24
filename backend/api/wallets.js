require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const express = require("express");
const router = express.Router();
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const bs58 = require("bs58");
const { getCurrentWallet, loadWalletsFromDb } = require("../services/utils/wallet/walletManager");
const { getFullNetWorthApp } = require("../utils/getFullNetworth");
const getWalletTokensWithMeta = require("../services/strategies/paid_api/getWalletTokensWithMeta");
const axios = require("axios");
const { getTokenName } = require("../services/utils/analytics/getTokenName");
const pLimit = require("p-limit");
const limit = pLimit(4);
const connection = new Connection(process.env.SOLANA_RPC_URL);
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const authenticate = require("../middleware/requireAuth");
const { encrypt, decrypt } = require("../middleware/auth/encryption");
const check2FA = require("../middleware/auth/check2FA");
const { getTokenAccountsAndInfo, getMintDecimals } = require("../utils/tokenAccounts");
// ⬇️ Use the same unprotected-envelope service as other routes
const { createUnprotectedWallet } = require("../armEncryption/unprotected");
const crypto = require("crypto");

// Validation for balance queries
const validate = require("../middleware/validate");
const { balanceQuerySchema } = require("./schemas/wallets.schema");

/* ───────────────── Price helper (robust import) ───────────────── */
const priceMod = require("../services/strategies/paid_api/getTokenPrice");
const getTokenPrice =
  typeof priceMod === "function" ? priceMod : priceMod.getTokenPrice;

const SOL_MINT_CONST =
  (priceMod && priceMod.SOL_MINT) ||
  "So11111111111111111111111111111111111111112";

async function getSolPriceSafe(userId) {
  try {
    if (priceMod && typeof priceMod.getSolPrice === "function") {
      return await priceMod.getSolPrice(userId);
    }
    if (typeof getTokenPrice === "function") {
      return await getTokenPrice(userId, SOL_MINT_CONST);
    }
    return 0;
  } catch {
    return 0;
  }
}

// ─── constants (no env bloat) ────────────────────────────────────────────────
const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Same quality gates as net worth (tune here if you want)
const DUST_USD                 = 0.05;
const LIQ_FLOOR_USD            = 1000;
const MAX_PRICE_STALENESS_SEC  = 6 * 3600;

// Micro caches to crush bursts (no new deps)
const inflightTokens = new Map();    // key -> Promise
const microCacheTokens = new Map();  // key -> { data, until }
const TOKENS_TTL_MS = 1000;          // reuse for 1s
const META_TTL_MS   = 10 * 60 * 1000;// cache Birdeye wallet meta for 10m
const metaCacheByWallet = new Map(); // walletPubkey -> { at, map }

// helper: fast timeout axios GET
async function axiosGetWithTimeout(url, opts = {}, ms = 1200) {
  const source = new AbortController();
  const t = setTimeout(() => source.abort(), ms);
  try {
    const res = await axios.get(url, { signal: source.signal, ...opts });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// ── Pagination helper (idempotent) ───────────────────────────────────────────
function __getPage(req, defaults = { take: 100, skip: 0, cap: 500 }) {
  const cap = Number(defaults.cap || 500);
  let take = parseInt(req.query?.take ?? defaults.take, 10);
  let skip = parseInt(req.query?.skip ?? defaults.skip, 10);
  if (!Number.isFinite(take) || take <= 0) take = defaults.take;
  if (!Number.isFinite(skip) || skip < 0) skip = defaults.skip;
  take = Math.min(Math.max(1, take), cap);
  skip = Math.max(0, skip);
  return { take, skip };
}
// ─────────────────────────────────────────────────────────────────────────────

const MIN_VALUE_USD = 0.50;
const EXCLUDE_MINTS = new Set([
  "So11111111111111111111111111111111111111112", // wSOL
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCER9SADJdTjaiCviCqiSBamEn3DcSjh3rCt", // USDC legacy
]);

const MIN_IMPORT_USD = 0.25;
const MIN_LIQUIDITY_USD = Number(process.env.MIN_LIQUIDITY_USD || 1000);

// Import the enhanced price helper (compatible with old default export)
const priceMod_WALLETS = require("../services/strategies/paid_api/getTokenPrice");
const getTokenPrice_WALLETS =
  typeof priceMod_WALLETS === "function" ? priceMod_WALLETS : priceMod_WALLETS.getTokenPrice;
const getPricesWithLiquidityBatch_WALLETS =
  priceMod_WALLETS.getPricesWithLiquidityBatch || (async (userId, mints)=>{
    const out = {};
    for (const m of mints) out[m] = { price: await getTokenPrice_WALLETS(userId, m), liquidity: 0, updateUnixTime: 0 };
    return out;
  });


async function injectUntracked(userId, walletIds = null) {
  let wrote = false;

  const wallets = await prisma.wallet.findMany({
    where : { userId, ...(walletIds ? { id: { in: walletIds } } : {}) },
    select: { id: true, label: true, publicKey: true }
  });

  for (const w of wallets) {
    const balances = await getTokenAccountsAndInfo(new PublicKey(w.publicKey));
    const entries = balances
      .filter(({ mint, amount }) => amount > 0 && !EXCLUDE_MINTS.has(mint));

    if (entries.length === 0) continue;

    // Batch quotes with liquidity
    const mints = entries.map(e => e.mint);
    const quotes = await getPricesWithLiquidityBatch_WALLETS(userId, mints);

    for (const { mint, amount } of entries) {
      const q = quotes[mint] || {};
      const price = Number(q.price || 0);
      const liquidity = Number(q.liquidity || 0);
      const updateUnixTime = Number(q.updateUnixTime || 0);
      const fresh = updateUnixTime && ((Date.now()/1e3) - updateUnixTime) <= MAX_PRICE_STALENESS_SEC;

      const uiAmount = Number(amount);
      const valueUsd = uiAmount * price;
      if (valueUsd <= MIN_IMPORT_USD) continue;
      if (!fresh || liquidity < MIN_LIQUIDITY_USD) continue;

      const decimals = await getMintDecimals(mint).catch(() => 0);
      const rawBalance = BigInt(Math.floor(uiAmount * 10 ** decimals));

      const trackedRows = await prisma.trade.findMany({
        where  : { walletId: w.id, mint, exitedAt: null },
        select : { outAmount: true, closedOutAmount: true }
      });

      const tracked = trackedRows.reduce((s, r) => s + (r.outAmount - (r.closedOutAmount ?? 0n)), 0n);
      if (tracked >= rawBalance) continue;

      const delta = rawBalance - tracked;
      if (delta === 0n) continue;

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

      wrote = true;
      console.log(`🆕 injectUntracked → ${mint} (${w.label}) Δ ${delta}  $${valueUsd.toFixed(2)}  liq=${liquidity}`);
    }
  }
  return wrote;
}

// ✅ POST /api/wallets/balance
// Body: { label: "default" }
router.post("/balance", authenticate, async (req, res) => {
  try {
    const { walletLabel, label, walletId, pubkey, publicKey } = req.body || {};
    const userId = req.user?.id;

    // Resolve a public key (prefer explicit pubkey)
    let publicKeyStr = null;

    if (pubkey || publicKey) {
      publicKeyStr = (pubkey ?? publicKey).toString();
    } else if (walletId != null) {
      const w = await prisma.wallet.findFirst({
        where: { id: Number(walletId), userId },
        select: { publicKey: true },
      });
      if (!w) return res.status(404).json({ error: "Wallet not found." });
      publicKeyStr = w.publicKey;
    } else if (walletLabel || label) {
      const w = await prisma.wallet.findFirst({
        where: { label: (walletLabel ?? label).toString(), userId },
        select: { publicKey: true },
      });
      if (!w) return res.status(404).json({ error: "Wallet not found." });
      publicKeyStr = w.publicKey;
    } else {
      // Fallback: user's active wallet
      const u = await prisma.user.findUnique({
        where: { id: userId },
        select: { activeWalletId: true },
      });
      if (!u?.activeWalletId) {
        return res.status(404).json({ error: "No active wallet set for this user." });
      }
      const w = await prisma.wallet.findUnique({
        where: { id: u.activeWalletId },
        select: { publicKey: true },
      });
      if (!w?.publicKey) {
        return res.status(404).json({ error: "Active wallet not found." });
      }
      publicKeyStr = w.publicKey;
    }

    // Balance & price
    let owner;
    try {
      owner = new PublicKey(publicKeyStr);
    } catch {
      return res.status(400).json({ error: "Invalid public key." });
    }

    const lamports   = await connection.getBalance(owner);
    const balanceSol = lamports / 1e9;

    const solPrice = await getSolPriceSafe(userId); // never throws; returns 0 on fail
    const valueUsd = +(balanceSol * solPrice).toFixed(2);

    return res.json({
      balance : +balanceSol.toFixed(3),
      price   : solPrice,
      valueUsd,
      publicKey: owner.toBase58(),
    });
  } catch (err) {
    console.error("Balance check failed:", err);
    return res.status(500).json({ error: err.message || "Failed to fetch balance" });
  }
});

// 🔍 GET /api/wallets/balance
// Allows clients to fetch a SOL balance by supplying pubkey, walletId or walletLabel in the query string.
router.get("/balance", validate({ query: balanceQuerySchema }), async (req, res) => {
  const { take, skip } = __getPage(req, { take: 100, cap: 500 });
  try {
    const { pubkey, walletId, walletLabel } = req.query;
    // Case 1: direct public key
    if (pubkey) {
      const balanceLamports = await connection.getBalance(new PublicKey(pubkey));
      return res.json({ balance: (balanceLamports / 1e9).toFixed(3) });
    }

    // Case 2: resolve by walletId or walletLabel in database
    let resolvedWallet;
    if (walletId) {
      resolvedWallet = await prisma.wallet.findFirst({
        where: { id: parseInt(walletId, 10) },
        select: { publicKey: true }
      });
    } else if (walletLabel) {
      resolvedWallet = await prisma.wallet.findFirst({
        where: { label: walletLabel },
        select: { publicKey: true }
      });
    }
    if (!resolvedWallet) {
      return res.status(404).json({ error: "Wallet not found." });
    }
    const balanceLamports = await connection.getBalance(new PublicKey(resolvedWallet.publicKey));
    return res.json({ balance: (balanceLamports / 1e9).toFixed(3) });
  } catch (err) {
    console.error("Balance fetch failed:", err.message);
    return res.status(500).json({ error: err.message || "Failed to fetch balance" });
  }
});

// 🧊 In-flight coalescing + tiny micro-cache for /wallets/networth
const inflightNetworth = new Map(); // key -> Promise
const microCacheNetworth = new Map(); // key -> { data, until }
const MICRO_TTL_MS = 750; // reuse result for quick double-fires (no envs)

// GET  /api/wallets/networth   ← idempotent, no body required
router.get("/networth", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    /* 1️⃣ Pull the active-wallet id that was just saved via /wallet/set-active */
    const { activeWalletId } = await prisma.user.findUnique({
      where:  { id: userId },
      select: { activeWalletId: true },
    });

    if (!activeWalletId) {
      return res.status(404).json({ error: "No active wallet set for this user." });
    }

    /* 2️⃣ Grab that wallet’s publicKey */
    const { publicKey } = await prisma.wallet.findUnique({
      where:  { id: activeWalletId },
      select: { publicKey: true },
    });

    if (!publicKey) {
      return res.status(404).json({ error: "Active wallet not found." });
    }

    /* 🔑 Coalescing key: user + wallet */
    const k = `${userId}:${publicKey}`;

    /* ⚡ Tiny micro-cache (handles immediate repeats right after resolve) */
    const cached = microCacheNetworth.get(k);
    if (cached && Date.now() < cached.until) {
      return res.json(cached.data);
    }

    /* 🧊 Reuse any in-flight computation for the same key */
    if (inflightNetworth.has(k)) {
      const result = await inflightNetworth.get(k);
      return res.json(result);
    }

    /* 3️⃣ Compute net worth once, share result */
    const p = (async () => {
      const result = await getFullNetWorthApp(publicKey, userId);
      // store brief micro-cache so quick back-to-back calls reuse the same body
      microCacheNetworth.set(k, { data: result, until: Date.now() + MICRO_TTL_MS });
      return result;
    })();

    inflightNetworth.set(k, p);

    try {
      const result = await p;
      return res.json(result);
    } finally {
      // clear in-flight marker for this key
      if (inflightNetworth.get(k) === p) inflightNetworth.delete(k);
    }
  } catch (err) {
    console.error("❌ Net-worth error:", err);
    return res.status(500).json({ error: "Failed to fetch wallet net worth" });
  }
});


// GET /api/tpsl/:wallet
router.get("/tpsl/:wallet", (req, res) => {
  const { wallet } = req.params;
  // const all = loadSettings();

  for (const userId in all) {
    for (const mint in all[userId]) {
      if (all[userId][mint].wallet === wallet || all[userId][mint].walletLabel === wallet) {
        return res.json(all[userId]);
      }
    }
  }

  res.status(404).json({ error: "No TP/SL config found for this wallet." });
});


// ─── GET /wallet/tokens?wallet=PUBKEY ───
router.get("/tokens", async (req, res) => {
  try {
    const owner   = new PublicKey(req.query.wallet);
    const conn    = new Connection(process.env.SOLANA_RPC_URL, "confirmed");

    const { value } = await conn.getParsedTokenAccountsByOwner(
      owner,
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    );

    const tokens = value
      .map(acc => acc.account.data.parsed.info)
      .filter(i   => +i.tokenAmount.uiAmount > 0)          // skip dust
      .map(i => ({
        mint     : i.mint,
        amount   : +i.tokenAmount.uiAmount,
        decimals : +i.tokenAmount.decimals,
      }));

    res.json(tokens);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});




router.get("/tokens/default", async (req, res) => {
  try {
    const { current } = require("../services/utils/wallet/walletManager");
    const conn        = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
    const owner       = current().publicKey;

    // Fetch tokens from wallet
    const { value } = await conn.getParsedTokenAccountsByOwner(
      owner,
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    );

    const tokens = value
      .map(a => a.account.data.parsed.info)
      .filter(i => +i.tokenAmount.uiAmount > 0.1)
      .map(i => ({
        mint     : i.mint,
        amount   : +i.tokenAmount.uiAmount,
        decimals : +i.tokenAmount.decimals,
      }));

    /* ── inject native SOL balance ── */
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const solLamports = await conn.getBalance(owner);
    if (solLamports > 0) {
      tokens.push({
        mint     : SOL_MINT,
        amount   : solLamports / 1e9,
        decimals : 9,
      });
    }
    
    // 🔥 Fetch names/symbols/logo/prices using Birdeye wallet portfolio endpoint
    let metaMap = {};
    /* pre-seed meta so it always has a name/icon */
    metaMap[SOL_MINT] = {
      name   : "Solana",
      symbol : "SOL",
      logo   : "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
      price  : 0,
    };

    try {
      const { data } = await axios.get("https://public-api.birdeye.so/v1/wallet/token_list", {
        params: { wallet: owner.toBase58() },
        headers: {
          "x-chain": "solana",
          "X-API-KEY": process.env.BIRDEYE_API_KEY,
        },
        timeout: 5000,
      });

      const items = data?.data?.items || [];
      for (const item of items) {
        metaMap[item.address] = {
          name: item.name,
          symbol: item.symbol,
          logo: item.logoURI,
          price: item.priceUsd, // may be missing/0 → we’ll fill via batch below
        };
      }
    } catch (err) {
      console.warn("❌ Birdeye wallet portfolio fetch failed:", err.response?.status || err.message);
    }

    /* 🔁 Replace per-mint fallback with ONE batched call */
    const unresolved = tokens
      .filter(t => !(metaMap[t.mint] && Number(metaMap[t.mint].price) > 0))
      .map(t => t.mint);

    if (unresolved.length) {
      const userId = req.user?.id || null;
      const quotes = await getPricesWithLiquidityBatch_WALLETS(userId, unresolved);
      const now    = Math.floor(Date.now() / 1e3);

      for (const m of unresolved) {
        const q     = quotes[m] || {};
        const price = Number(q.price || 0);
        const liq   = Number(q.liquidity || 0);
        const ut    = Number(q.updateUnixTime || 0);
        const fresh = ut > 0 && (now - ut) <= MAX_PRICE_STALENESS_SEC;

        if (price > 0 && fresh && liq >= MIN_LIQUIDITY_USD) {
          metaMap[m] = { ...(metaMap[m] || {}), price };
        }
      }
    }

    // Attach name + symbol fallback
    const MIN_VALUE_USD = 0.50;
    const enriched = tokens
      .map(t => {
        const price = Number(metaMap[t.mint]?.price || 0);
        return {
          ...t,
          name  : metaMap[t.mint]?.name   || `${t.mint.slice(0,4)}…${t.mint.slice(-4)}`,
          symbol: metaMap[t.mint]?.symbol || "",
          logo  : metaMap[t.mint]?.logo   || "",
          price,
          valueUsd: t.amount * price,
        };
      })
      .filter(t =>
        t.mint === SOL_MINT || (t.price > 0 && t.valueUsd >= MIN_VALUE_USD)
      )
      .sort((a, b) => b.valueUsd - a.valueUsd);

    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


router.get("/tokens/default-detailed", async (req, res) => {
  try {
    const { current } = require("../services/utils/wallet/walletManager");
    const conn        = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
    const owner       = current().publicKey;

    // Fetch tokens from wallet
    const { value } = await conn.getParsedTokenAccountsByOwner(
      owner,
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    );

    const tokens = value
      .map(a => a.account.data.parsed.info)
      .filter(i => +i.tokenAmount.uiAmount > 0.1)
      .map(i => ({
        mint     : i.mint,
        amount   : +i.tokenAmount.uiAmount,
        decimals : +i.tokenAmount.decimals,
      }));

    /* ── inject native SOL balance ── */
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const solLamports = await conn.getBalance(owner);
    if (solLamports > 0) {
      tokens.push({
        mint     : SOL_MINT,
        amount   : solLamports / 1e9,
        decimals : 9,
      });
    }

    // 🔥 Fetch names/symbols/logo/prices using Birdeye wallet portfolio endpoint
    let metaMap = {};
    /* pre-seed meta so it always has a name/icon */
    metaMap[SOL_MINT] = {
      name   : "Solana",
      symbol : "SOL",
      logo   : "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
      price  : 0,
    };

    try {
      const { data } = await axios.get("https://public-api.birdeye.so/v1/wallet/token_list", {
        params: { wallet: owner.toBase58() },
        headers: {
          "x-chain": "solana",
          "X-API-KEY": process.env.BIRDEYE_API_KEY,
        },
        timeout: 5000,
      });

      const items = data?.data?.items || [];
      for (const item of items) {
        metaMap[item.address] = {
          name: item.name,
          symbol: item.symbol,
          logo: item.logoURI,
          price: item.priceUsd,
        };
      }
    } catch (err) {
      console.warn("❌ Birdeye wallet portfolio fetch failed:", err.response?.status || err.message);
    }

    /* 🔁 Replace per-mint fallback with ONE batched call */
    const unresolved = tokens
      .filter(t => !(metaMap[t.mint] && Number(metaMap[t.mint].price) > 0))
      .map(t => t.mint);

    if (unresolved.length) {
      const userId = req.user?.id || null;
      const quotes = await getPricesWithLiquidityBatch_WALLETS(userId, unresolved);
      const now    = Math.floor(Date.now() / 1e3);

      for (const m of unresolved) {
        const q     = quotes[m] || {};
        const price = Number(q.price || 0);
        const liq   = Number(q.liquidity || 0);
        const ut    = Number(q.updateUnixTime || 0);
        const fresh = ut > 0 && (now - ut) <= MAX_PRICE_STALENESS_SEC;

        if (price > 0 && fresh && liq >= MIN_LIQUIDITY_USD) {
          metaMap[m] = { ...(metaMap[m] || {}), price };
        }
      }
    }

    // Attach name + symbol fallback
    const MIN_VALUE_USD = 0.50;
    const enriched = tokens
      .map(t => {
        const price = Number(metaMap[t.mint]?.price || 0);
        return {
          ...t,
          name  : metaMap[t.mint]?.name   || `${t.mint.slice(0,4)}…${t.mint.slice(-4)}`,
          symbol: metaMap[t.mint]?.symbol || "",
          logo  : metaMap[t.mint]?.logo   || "",
          price,
          valueUsd: t.amount * price,
        };
      })
      .filter(t =>
        t.mint === SOL_MINT || (t.price > 0 && t.valueUsd >= MIN_VALUE_USD)
      )
      .sort((a, b) => b.valueUsd - a.valueUsd);

    res.json(enriched);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});





// get token name -> frontend
router.post("/token-meta", async (req, res) => {
  const raw = req?.body?.mints;
  const mints = Array.isArray(raw) ? [...new Set(raw.filter(Boolean))] : [];
  if (mints.length === 0) return res.json([]);

  const chunk = (arr, n = 100) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  const normalize = (t = {}) => ({
    mint: String(t.mint || ""),
    name: String(t.name || ""),
    symbol: String(t.symbol || ""),
    logoURI: String(t.logoURI || t.logo || ""),
  });

  const results = [];
  for (const batch of chunk(mints, 100)) {
    let arr = null;
    try {
      // Your helper may throw if it sees account.data as ["…","base64"].
      arr = await getWalletTokensWithMeta(batch);
    } catch (err) {
      // Don’t spam logs, don’t fail the request; just emit placeholders.
      // (FE only uses this to enrich Unknown tokens anyway.)
      // If you still want a breadcrumb, downgrade to debug:
      // console.debug("token-meta batch fallback:", err?.message || err);
      arr = batch.map((m) => ({ mint: m, name: "", symbol: "", logoURI: "" }));
    }

    for (const t of Array.isArray(arr) ? arr : []) results.push(normalize(t));
  }

  return res.json(results);
});



// grab wallet from default.txt for rotation bot list
// GET /api/wallets/labels  (rotation helper; best-effort)
router.get("/labels", async (req, res) => {
  (async () => {
    const wm      = require("../services/utils/wallet/walletManager");
    const wallets = wm.all();

    const solPrice = await getSolPriceSafe(null);
    const conn     = new Connection(process.env.SOLANA_RPC_URL, "confirmed");

    const enriched = await Promise.all(wallets.map((kp, i) =>
      limit(async () => {
        const balLamports = await conn.getBalance(kp.publicKey);
        const balanceSol  = balLamports / 1e9;
        return {
          label   : `wallet-${i + 1}`,
          pubkey  : kp.publicKey.toBase58(),
          balance : +balanceSol.toFixed(3),
          price   : solPrice,
          value   : +(balanceSol * solPrice).toFixed(2),
        };
      })
    ));

    res.json(enriched);
  })().catch(e => {
    console.error("labels route error:", e);
    res.status(500).json({ error: "Failed to load wallet labels" });
  });
});


// GET /api/wallets/tokens/by-label?label=wallet-2
// Route for rotation bot to get multiple wallets. 
router.get("/tokens/by-label", async (req, res) => {
  try {
    const label = req.query.label;
    if (!label) {
      return res.status(400).json({ error: "Missing ?label" });
    }

    const wm     = require("../services/utils/wallet/walletManager");
    const allKPs = wm.all(); // every loaded keypair
    const idx    = allKPs.findIndex((_, i) => `wallet-${i + 1}` === label);
    if (idx === -1) {
      return res.status(404).json({ error: "Wallet label not found" });
    }

    const owner = allKPs[idx].publicKey;

    // Already enriched with name/symbol/logo
    const tokens = await getWalletTokensWithMeta(owner.toBase58());

    // 🔁 Batch prices once (with liquidity + staleness gating)
    const userId   = req.user?.id || null;
    const now      = Math.floor(Date.now() / 1e3);
    const basePass = new Set([
      SOL_MINT_CONST,
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
    ]);

    const allMints = [...new Set(tokens.map(t => t.mint))];
    const quotes   = allMints.length
      ? await getPricesWithLiquidityBatch_WALLETS(userId, allMints)
      : {};

    for (const t of tokens) {
      const q       = quotes[t.mint] || {};
      const price   = Number(q.price || 0);
      const liq     = Number(q.liquidity || 0);
      const ut      = Number(q.updateUnixTime || 0);
      const fresh   = ut > 0 && (now - ut) <= MAX_PRICE_STALENESS_SEC;
      const allowed = basePass.has(t.mint) || (price > 0 && fresh && liq >= MIN_LIQUIDITY_USD);
      const final   = allowed ? price : 0;

      t.price    = final;
      t.valueUsd = +(t.amount * final).toFixed(2);
    }

    res.json(tokens);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});



// POST /api/wallets/validate-mint  { mint: "..." }
// used to validate custom mints added to rotation bot. 
router.post("/validate-mint", async (req, res) => {
  const { mint } = req.body || {};
  const isValid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || "");
  if (!isValid) return res.status(400).json({ ok:false, reason:"format" });

  try {
    const getTokenShortTermChange =
      require("../services/strategies/paid_api/getTokenShortTermChanges");

    const d = await getTokenShortTermChange(null, mint, "5m", "1h");
    const change = d?.priceChange5m ?? d?.priceChange1m ?? null;
    if (change === null) {
      return res.status(404).json({ ok:false, reason:"no-data" });
    }
    return res.json({ ok:true, symbol:d.symbol || "", name:d.name || "" });
  } catch (err) {
    console.error("validate-mint:", err.message);
    return res.status(500).json({ ok:false, reason:"api" });
  }
});





// FOR NEW AUTH SYSTEM SAVE WALLET HIDE KEY
router.post("/import-wallet", authenticate, async (req, res) => {
  const { label, privateKey } = req.body;
  const dbUserId = req.user.id; // User.id (UUID string)

  console.log("🛂 Authenticated user:", dbUserId);
  console.log("📩 Request body:", {
    label,
    privateKey: privateKey?.slice(0, 6) + "...",
  });

  if (!label || !privateKey)
    return res.status(400).json({ error: "Missing label or privateKey." });

  try {
    /* 1️⃣  Decode the base58 secret key */
    let secretKey;
    try {
      secretKey = bs58.decode(privateKey.trim());
      console.log("🔑 Decoded secretKey length:", secretKey.length);
    } catch (e) {
      return res.status(400).json({ error: "Invalid base58 private key." });
    }
    if (secretKey.length !== 64)
      return res
        .status(400)
        .json({ error: "Key must be 64-byte ed25519 secret." });

    const keypair = Keypair.fromSecretKey(secretKey);
    const publicKey = keypair.publicKey.toBase58();
    console.log("🧾 Public key derived:", publicKey);

    /* 2️⃣  Duplicate checks (publicKey and label scoped to this user) */
    if (await prisma.wallet.findFirst({ where: { userId: dbUserId, publicKey } }))
      return res.status(400).json({ error: "Wallet already saved." });

    if (await prisma.wallet.findFirst({ where: { userId: dbUserId, label } }))
      return res.status(400).json({ error: "Label already exists." });

    /* 3️⃣  Load user for AAD/HKDF salt (User.userId) and active wallet check */
    const userRec = await prisma.user.findUnique({
      where: { id: dbUserId },
      select: { id: true, userId: true, activeWalletId: true },
    });
    if (!userRec) return res.status(404).json({ error: "User not found." });

    /* 4️⃣  Create wallet via centralized UNPROTECTED service
           - KEK = HKDF(ENCRYPTION_SECRET, salt = userRec.userId, info="wallet-kek")
           - Envelope JSON is stored in Wallet.encrypted (object, not string)
           - No plaintext in Wallet.privateKey
    */
    const wallet = await createUnprotectedWallet({
      prismaClient: prisma,
      dbUserId: userRec.id,               // FK → User.id (string/UUID)
      aadUserId: userRec.userId,          // HKDF salt/AAD (string)
      label,
      secretKey: Buffer.from(secretKey),  // Buffer OK; service can also accept base58/hex
      publicKey,                          // consistency/sanity
    });

    console.log("✅ Wallet saved to DB:", wallet.id);

    /* 5️⃣  Make it active if user has none */
    if (!userRec.activeWalletId) {
      await prisma.user.update({
        where: { id: dbUserId },
        data: { activeWalletId: wallet.id },
      });
    }

    /* 6️⃣  Inject untracked SPL positions */
    await injectUntracked(dbUserId, [wallet.id]);

    /* 7️⃣  Done */
    return res.json({
      message: "Wallet saved.",
      wallet,
      activeWalletId: userRec.activeWalletId || wallet.id,
      refetchOpenTrades: true,
    });
  } catch (err) {
    if (err.code === "P2002" && err.meta?.target?.includes("userId_label"))
      return res.status(400).json({ error: "Label already exists." });

    console.error("🔥 Wallet import error:", err);
    return res.status(500).json({ error: "Failed to import wallet." });
  }
});



router.post('/send-sol', async (req, res) => {
  const { senderWalletId, recipientAddress, amount } = req.body;

  if (!recipientAddress || !amount) {
    return res.status(400).json({ error: 'Recipient address or amount missing.' });
  }

  try {
    const senderWallet = await prisma.wallet.findUnique({
      where: { id: senderWalletId },
    });

    if (!senderWallet) {
      return res.status(404).json({ error: 'Sender wallet not found.' });
    }

    // 🔐 For legacy wallets with a stored privateKey, decrypt as before.  For
    // envelopes we cannot derive the secret key here without an armed
    // session, so we return an informative error instead of throwing.
    let senderKeypair;
    if (senderWallet.privateKey) {
      try {
        const decryptedPrivateKey = decrypt(senderWallet.privateKey);
        const secretKey = bs58.decode(decryptedPrivateKey.toString().trim());
        senderKeypair = Keypair.fromSecretKey(secretKey);
      } catch (err) {
        console.error('Failed to decrypt legacy private key:', err.message);
        return res.status(500).json({ error: 'Failed to decrypt wallet key.' });
      }
    } else if (senderWallet.encrypted) {
      // The wallet is envelope‑encrypted.  Users must arm the wallet first to
      // obtain a DEK via the Arm session API.  Without that, we cannot send.
      return res.status(401).json({ error: 'Protected or unarmed wallet. Please arm the wallet before sending.' });
    } else {
      return res.status(400).json({ error: 'Wallet has no key material.' });
    }

    console.log(`🪪 Sender pubkey: ${senderKeypair.publicKey.toBase58()}`);

    console.log(`🌐 Connecting to Solana RPC`);
    const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');

    const senderBalanceLamports = await connection.getBalance(senderKeypair.publicKey);
    const amountLamports = Math.floor(amount * 1e9);

    // Add a buffer for transaction fees
    if (senderBalanceLamports < amountLamports + 5000) {
      return res.status(400).json({ error: `Insufficient balance. Available: ${(senderBalanceLamports / 1e9).toFixed(4)} SOL` });
    }

    console.log(`💸 Building transaction`);
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: senderKeypair.publicKey,
        toPubkey: new PublicKey(recipientAddress),
        lamports: Math.floor(amount * 1e9), // SOL -> lamports
      })
    );

    console.log(`✍️ Sending transaction`);
    const signature = await connection.sendTransaction(transaction, [senderKeypair]);

    console.log(`⏳ Confirming transaction: ${signature}`);
    await connection.confirmTransaction(signature, 'confirmed');

    console.log(`✅ Transaction confirmed: ${signature}`);
    res.json({ success: true, signature });
  } catch (error) {
    console.error('🔥 Error sending Sol:', error);
    res.status(500).json({ error: 'Failed to send transaction.' });
  }
});



//Test Route (for testing manully
// Backend route that fetches wallets
router.get("/load", authenticate, async (req, res) => {
  try {
    console.log("🔷 /wallets/load called");
    console.log("🔷 Authenticated user ID:", req.user?.id);

    const wallets = await prisma.wallet.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        label: true,
        publicKey: true,
        createdAt: true,
        isProtected: true,
        passphraseHash: true, 
      },
    });

    console.log("🔷 Wallets loaded:", wallets.length);

    if (wallets.length === 0) {
      console.warn("⚠️ No wallets found for user:", req.user.id);
      return res.status(404).json({ error: "No wallets found" });
    }

    res.json(wallets);
  } catch (err) {
    console.error("❌ Error loading wallets:", err);
    res.status(500).json({ error: "Server error" });
  }
});



// TEMP: Delete all wallets for current user
router.delete("/wipe", authenticate, async (req, res) => {
  await prisma.wallet.deleteMany({ where: { userId: req.user.id } });
  res.json({ message: "All wallets wiped for user." });
});


// GET /api/wallets/portfolio?walletId=123
router.get("/portfolio", authenticate, async (req, res) => {
  try {
    const userId  = req.user?.id;
    const walletId = req.query.walletId;
    console.log(`[portfolio] Received request: walletId=${walletId}`);
    if (!walletId) return res.status(400).json({ error: "Missing walletId" });

    const wallet = await prisma.wallet.findUnique({
      where: { id: parseInt(walletId, 10) },
      select: { publicKey: true }
    });
    if (!wallet?.publicKey) return res.status(404).json({ error: "Wallet not found" });
    console.log(`[portfolio] Found wallet:`, wallet);

    const conn  = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
    const owner = new PublicKey(wallet.publicKey);
    console.log(`[portfolio] Querying Solana balance for pubkey: ${wallet.publicKey}`);

    // 1) On-chain token accounts (+ native SOL)
    const { value } = await conn.getParsedTokenAccountsByOwner(
      owner,
      { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
    );
    const tokens = value
      .map(a => a.account.data.parsed.info)
      .filter(i => +i.tokenAmount.uiAmount > 0) // include small dust; we'll filter later with USD value
      .map(i => ({
        mint: i.mint,
        amount: +i.tokenAmount.uiAmount,
        decimals: +i.tokenAmount.decimals
      }));

    const SOL_MINT = "So11111111111111111111111111111111111111112";
    const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const basePass = new Set([SOL_MINT, USDC_MINT]);

    const lamports = await conn.getBalance(owner);
    if (lamports > 0) {
      tokens.push({ mint: SOL_MINT, amount: lamports / 1e9, decimals: 9 });
    }

    // 2) Token metadata (name/symbol/logo) via wallet token_list (do NOT trust its price)
    let metaMap = {
      [SOL_MINT]: {
        name: "Solana",
        symbol: "SOL",
        logo:
          "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
      },
    };
    try {
      const { data } = await require("axios").get(
        "https://public-api.birdeye.so/v1/wallet/token_list",
        {
          params: { wallet: owner.toBase58(), ui_amount_mode: "scaled" },
          headers: { "x-chain": "solana", "X-API-KEY": process.env.BIRDEYE_API_KEY },
          timeout: 5000,
        }
      );
      const items = data?.data?.items || [];
      for (const item of items) {
        metaMap[item.address] = {
          name: item.name,
          symbol: item.symbol,
          logo: item.logoURI,
        };
      }
    } catch (err) {
      console.warn("❌ Birdeye wallet portfolio fetch failed:", err.response?.status || err.message);
    }

    // 3) Batch price+liquidity+staleness for ALL mints
    const allMints = [...new Set(tokens.map(t => t.mint))];
    const quotes = await getPricesWithLiquidityBatch_WALLETS(userId, allMints);

    const MIN_VALUE_USD        = 0.50;
    const MIN_LIQUIDITY_USD    = Number(process.env.MIN_LIQUIDITY_USD || 1000);
    const MAX_PRICE_STALENESS  = Number(process.env.MAX_PRICE_STALENESS_SEC || 6 * 3600);
    const now = Math.floor(Date.now() / 1000);

    // 4) Build enriched rows with gates
    const enriched = tokens
      .map(t => {
        const q = quotes[t.mint] || {};
        const price = Number(q.price || 0);
        const liquidity = Number(q.liquidity || 0);
        const updatedAt = Number(q.updateUnixTime || 0);
        const fresh = updatedAt > 0 && (now - updatedAt) <= MAX_PRICE_STALENESS;

        // Base assets (SOL/USDC) are allowed through regardless of gates
        const pass =
          basePass.has(t.mint) ||
          (price > 0 && fresh && liquidity >= MIN_LIQUIDITY_USD);

        if (!pass) return null;

        const valueUsd = t.amount * price;
        if (!basePass.has(t.mint) && valueUsd < MIN_VALUE_USD) return null;

        const meta = metaMap[t.mint] || {};
        return {
          mint: t.mint,
          amount: t.amount,
          decimals: t.decimals,
          name: meta.name || `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`,
          symbol: meta.symbol || "",
          logo: meta.logo || "",
          price,
          valueUsd: +valueUsd.toFixed(2),
          liquidity,
          updateUnixTime: updatedAt,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.valueUsd - a.valueUsd);

    console.log("[portfolio] Enriched portfolio:", enriched);
    return res.json(enriched);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Failed to fetch portfolio" });
  }
});




router.get("/:id/tokens", authenticate, async (req, res) => {
  try {
    const userId  = req.user.id;
    const walletId = Number.parseInt(req.params.id, 10);
    if (isNaN(walletId)) return res.status(400).json({ error: "Invalid wallet ID" });

    // flags (default behavior = current behavior)
    const includeMeta   = req.query.meta   !== "0";          // Birdeye wallet metadata
    const includeQuotes = req.query.quotes !== "0";          // prices/liquidity
    const minValueUsd   = Number.isFinite(+req.query.minUsd) ? +req.query.minUsd : 1;
    const showAll       = req.query.all === "1";             // skip value filter if set

    // Check ownership
    const wallet = await prisma.wallet.findFirst({ where: { id: walletId, userId } });
    if (!wallet) return res.status(404).json({ error: "Wallet not found for this user." });

    const owner = new PublicKey(wallet.publicKey);
    const conn  = new Connection(process.env.SOLANA_RPC_URL, "confirmed");

    // ── cache/coalesce key
    const k = `${userId}:${walletId}:m${includeMeta?1:0}:q${includeQuotes?1:0}:u${minValueUsd}:a${showAll?1:0}`;

    // micro-cache
    const cached = microCacheTokens.get(k);
    if (cached && Date.now() < cached.until) return res.json(cached.data);

    // in-flight coalescing
    if (inflightTokens.has(k)) {
      const result = await inflightTokens.get(k);
      return res.json(result);
    }

    const p = (async () => {
      // Fetch SPL token accounts
      const { value } = await conn.getParsedTokenAccountsByOwner(
        owner,
        { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
      );

      let tokens = value
        .map(a => a.account.data.parsed.info)
        .map(i => ({
          mint     : i.mint,
          amount   : +i.tokenAmount.uiAmount,
          decimals : +i.tokenAmount.decimals,
        }))
        // keep any positive balances; filtering-by-value happens later
        .filter(t => Number.isFinite(t.amount) && t.amount > 0);

      // Inject native SOL
      const solLamports = await conn.getBalance(owner);
      if (solLamports > 0) {
        tokens.push({ mint: SOL_MINT, amount: solLamports / 1e9, decimals: 9 });
      }

      // ── Optional: metadata (Birdeye wallet token_list) with soft cache & fast timeout
      const metaMap = Object.create(null);
      // pre-seed SOL
      metaMap[SOL_MINT] = {
        name   : "Solana",
        symbol : "SOL",
        logo   : "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png",
      };

      if (includeMeta) {
        const mc = metaCacheByWallet.get(wallet.publicKey);
        const fresh = mc && (Date.now() - mc.at < META_TTL_MS);
        if (fresh) {
          Object.assign(metaMap, mc.map);
        } else {
          try {
            const { data } = await axiosGetWithTimeout(
              "https://public-api.birdeye.so/v1/wallet/token_list",
              {
                params: { wallet: owner.toBase58() },
                headers: { "x-chain": "solana", "X-API-KEY": process.env.BIRDEYE_API_KEY }
              },
              1200 // fast timeout to avoid UI stall
            );
            const items = data?.data?.items || [];
            for (const item of items) {
              metaMap[item.address] = {
                name: item.name,
                symbol: item.symbol,
                logo: item.logoURI,
              };
            }
            metaCacheByWallet.set(wallet.publicKey, { at: Date.now(), map: { ...metaMap } });
          } catch (err) {
            console.warn("🟡 Birdeye meta skipped:", err?.message || err?.code || err);
          }
        }
      }

      // ── Optional: batched quotes (same helper as net worth)
      let priceMap = Object.create(null);
      let liqMap   = Object.create(null);
      let updatedMap = Object.create(null);

      if (includeQuotes) {
        // dedupe and skip SOL/USDC special cases
        const mints = [...new Set(tokens.map(t => t.mint))]
          .filter(m => m && m !== USDC_MINT && m !== SOL_MINT);

        // small instrumentation
        console.log(`📦 [tokens] Price batch: querying ${mints.length} mint(s)`);

        const quotes = await getPricesWithLiquidityBatch(userId, mints);

        for (const m of mints) {
          const q = quotes[m] || {};
          priceMap[m]   = Number(q.price || 0);
          liqMap[m]     = Number(q.liquidity || 0);
          updatedMap[m] = Number(q.updateUnixTime || 0);
        }

        // fill SOL + USDC
        priceMap[USDC_MINT] = 1;
        try {
          const solPrice = await getSolPrice(userId);
          priceMap[SOL_MINT] = Number(solPrice || 0);
        } catch { priceMap[SOL_MINT] = 0; }
      }

      // ── Build enriched rows with gating consistent with net-worth
      const out = [];
      const nowSec = Math.floor(Date.now()/1000);

      for (const t of tokens) {
        const meta = metaMap[t.mint] || {};
        let price  = includeQuotes ? (priceMap[t.mint] || 0) : 0;
        let liq    = includeQuotes ? (liqMap[t.mint]   || 0) : 0;
        let upAt   = includeQuotes ? (updatedMap[t.mint]|| 0) : 0;

        // Gate quotes for non-allowlisted mints
        const isSol  = t.mint === SOL_MINT;
        const isUsdc = t.mint === USDC_MINT;

        const isFresh = upAt > 0 ? (nowSec - upAt) <= MAX_PRICE_STALENESS_SEC : false;
        const valueUsd = (price || 0) * t.amount;

        const belowDust   = includeQuotes ? (valueUsd < DUST_USD) : false;
        const illiquid    = includeQuotes ? (liq > 0 && liq < LIQ_FLOOR_USD) : false;
        const stale       = includeQuotes ? (!isFresh) : false;

        // If quotes are included and quality is poor, zero them unless SOL/USDC
        if (includeQuotes && !isSol && !isUsdc && (belowDust || illiquid || stale)) {
          // zero out to keep, but non-inflating
          price = 0;
        }

        out.push({
          mint: t.mint,
          amount: t.amount,
          decimals: t.decimals,
          name  : meta.name   || `${t.mint.slice(0,4)}…${t.mint.slice(-4)}`,
          symbol: meta.symbol || "",
          logo  : meta.logo   || "",
          price,
          liquidityUsd: includeQuotes ? liq   : undefined,
          updatedAt   : includeQuotes ? upAt  : undefined,
          valueUsd    : +(t.amount * (price || 0)).toFixed(6),
        });
      }

      // filter & sort
      const filtered = showAll
        ? out
        : out.filter(r => r.mint === SOL_MINT || (r.price > 0 && r.valueUsd >= minValueUsd));

      const enriched = filtered.sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));

      // micro-cache for quick repeats
      microCacheTokens.set(k, { data: enriched, until: Date.now() + TOKENS_TTL_MS });
      return enriched;
    })();

    inflightTokens.set(k, p);
    try {
      const result = await p;
      return res.json(result);
    } finally {
      if (inflightTokens.get(k) === p) inflightTokens.delete(k);
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


module.exports = router;