// services/internalJobs.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const express = require("express");
const router = express.Router();
const { PublicKey } = require("@solana/web3.js");
const crypto = require("crypto");
const { v4: uuid } = require("uuid");

const prisma = require("../prisma/prisma");
const { getTokenAccountsAndInfo } = require("../utils/tokenAccounts");
const getTokenPrice = require("../services/strategies/paid_api/getTokenPrice");
const { getWalletBalance } =
  require("../services/utils/wallet/walletManager");
const { getCachedPrice } =
  require("../utils/priceCache.static");
const { getTokenName } =
  require("../services/utils/analytics/getTokenName");

// Manual executor (arm-aware, does logging, creates TP/SL rule when tp/sl provided)
const {
  performManualBuy,
  performManualSellByAmount,
  performManualSell,
} = require("../services/manualExecutor");

// Idempotent job runner (mirrors /api/manual routes behaviour)
const { runJob } = require("../services/jobs/jobRunner");

// ── Pagination helper (kept) ────────────────────────────────────────────────
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
// ────────────────────────────────────────────────────────────────────────────

const SOL_MINT = "So11111111111111111111111111111111111111112";

// Stable-coin mints we ignore in positions
const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",  // USDH
  "7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT"  // UXD
]);

// ── Strict internal auth (unchanged) ───────────────────────────────────────
router.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}`) return next();
  console.log("🚫 INTERNAL route blocked. Header:", auth);
  return res.status(403).json({ error: "Forbidden. Internal only." });
});
// :contentReference[oaicite:8]{index=8}

// ── Small helpers ──────────────────────────────────────────────────────────
async function getWallet(userId, walletLabel) {
  if (!walletLabel) {
    const { activeWalletId } = await prisma.user.findUnique({
      where:  { id: userId },
      select: { activeWalletId: true },
    });
    if (!activeWalletId) throw new Error("No active wallet set for user.");
    return prisma.wallet.findUnique({
      where:  { id: activeWalletId },
      select: { id: true, label: true },
    });
  }
  const w = await prisma.wallet.findFirst({
    where:  { label: walletLabel, userId },
    select: { id: true, label: true },
  });
  if (!w) throw new Error(`Wallet '${walletLabel}' not found for user.`);
  return w;
}
// :contentReference[oaicite:9]{index=9}

// Treat arm errors consistently (mirror /api/manual routes)
function isArmError(e) {
  return (
    e?.status === 401 ||
    e?.code === "AUTOMATION_NOT_ARMED" ||
    /Automation not armed/i.test(e?.message || "")
  );
}
function sendArm401(res, walletId) {
  return res.status(401).json({
    error: "Automation not armed",
    needsArm: true,
    walletId,
  });
}

// Idempotency helpers (accept header or derive from body)
const uuidV4Regex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stablePick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
function deriveIdKey(userId, path, body) {
  const core = stablePick(body, [
    "amountInSOL",
    "amountInUSDC",
    "percent",
    "amount",
    "mint",
    "walletId",
    "walletLabel",
    "slippage",
    "strategy",
    "tp",
    "sl",
    "tpPercent",
    "slPercent",
    "triggerType",
    "jobId",          // optional field your schedulers can include
    "limitPrice",     // optional for limit executors
    "dcaScheduleId",  // optional for DCA executors
  ]);
  const bucket = Math.floor(Date.now() / 30_000); // 30s window
  const salt   = String(process.env.IDEMPOTENCY_SALT || "");
  const raw    = JSON.stringify({ userId, path, core, bucket, salt });
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ────────────────────────────────────────────────────────────────────────────
// GET /internal/positions
// - scope=all → aggregates across all user wallets
// - default (no scope) → active wallet only
// - filters out stablecoins in the positions list
router.get("/positions", async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const scopeAll = String(req.query.scope || "").toLowerCase() === "all";
    const solPrice = await getCachedPrice(SOL_MINT, { readOnly: true });

    // Build wallet set
    let wallets = [];
    if (scopeAll) {
      wallets = await prisma.wallet.findMany({
        where:  { userId },
        select: { id: true, label: true, publicKey: true },
      });
      if (!wallets.length) {
        return res.status(404).json({ error: "No wallet found for user." });
      }
    } else {
      const active = await prisma.user.findUnique({
        where:  { id: userId },
        select: { activeWalletId: true },
      });

      const where = { userId };
      if (req.query.walletLabel) where["label"] = req.query.walletLabel;
      else if (active?.activeWalletId) where["id"] = active.activeWalletId;

      const one = await prisma.wallet.findFirst({
        where,
        select: { id: true, label: true, publicKey: true },
      });
      if (!one) return res.status(404).json({ error: "No wallet found for user." });
      wallets = [one];
    }

    const walletIds = wallets.map((w) => w.id);

    // Pull only trades for these wallets (prevents cross-wallet PnL bleed)
    const allRows = await prisma.trade.findMany({
      where:   { walletId: { in: walletIds } },
      orderBy: { timestamp: "asc" },
    });

    const openRows = allRows.filter(
      (r) => BigInt(r.closedOutAmount ?? 0n) < BigInt(r.outAmount ?? 0n)
    );

    // Live balances per wallet, then aggregate into a mint → amount map
    const positionsMap = new Map(); // mint -> { amount, name }
    let totalSol = 0;
    let totalUsdc = 0;

    for (const w of wallets) {
      const connWallet = { publicKey: new PublicKey(w.publicKey) };
      const tokenAccounts = await getTokenAccountsAndInfo(connWallet.publicKey);
      const solBalance = await getWalletBalance(connWallet);
      totalSol += solBalance;

      const usdcAcc = tokenAccounts.find(
        (t) => t.mint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
      );
      if (usdcAcc) totalUsdc += usdcAcc.amount * 1;

      for (const { mint, amount, name } of tokenAccounts) {
        if (STABLES.has(mint) || amount < 1e-6) continue;
        const cur = positionsMap.get(mint) || { amount: 0, name: name || null };
        cur.amount += amount;
        if (!cur.name && name) cur.name = name;
        positionsMap.set(mint, cur);
      }
    }

    // Build positions payload (weighted entry across open rows)
    const positions = [];
    for (const [mint, agg] of positionsMap.entries()) {
      const matches = openRows.filter((r) => r.mint === mint);

      const totalTokReal = matches.reduce(
        (s, r) => s + Number(r.outAmount) / 10 ** (r.decimals ?? 0),
        0
      );
      const totalCostSOL = matches.reduce(
        (s, r) => s + Number(r.inAmount) / 1e9,
        0
      );
      const weightedEntry = totalTokReal
        ? +(totalCostSOL / totalTokReal).toFixed(9)
        : null;

      const totalCostUSD = matches.reduce(
        (s, r) =>
          s +
          (Number(r.outAmount) / 10 ** (r.decimals ?? 0)) *
            (r.entryPriceUSD ?? 0),
        0
      );
      const entryPriceUSD = totalTokReal
        ? +(totalCostUSD / totalTokReal).toFixed(6)
        : null;

      const price = await getTokenPrice(userId, mint);
      const cleanName = (agg.name || "Unknown").replace(/[^\x20-\x7E]/g, "");
      const valueUSD = +(agg.amount * price).toFixed(2);

      positions.push({
        mint,
        name: cleanName,
        amount: agg.amount,
        price,
        valueUSD,
        valueSOL: +(valueUSD / solPrice).toFixed(4),
        entryPrice: weightedEntry,
        entryPriceUSD,
        inAmount: +totalCostSOL.toFixed(6),
        strategy: matches[0]?.strategy ?? "manual",
        entries: matches.length,
        timeOpen: matches[0]
          ? new Date(matches[0].timestamp).toLocaleString()
          : null,
        tpSl: null, // filled below for single-wallet scope
        url: `https://birdeye.so/token/${mint}`,
      });
    }

    // Only attach TP/SL when single-wallet scope (preserves old behaviour)
    if (!scopeAll) {
      const w = wallets[0];
      const tpSlRules = await prisma.tpSlRule.findMany({
        where: { userId, walletId: w.id, status: "active" },
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
      for (const p of positions) {
        const tpSl = userSettings[p.mint];
        if (tpSl) {
          p.tpSl = { tp: tpSl.tp, sl: tpSl.sl, enabled: tpSl.enabled !== false };
        }
      }
    }

    // Include tokens that are “open” in DB but currently zero balance
    const seen = new Set(positions.map((p) => p.mint));
    for (const r of openRows) {
      if (seen.has(r.mint) || STABLES.has(r.mint)) continue;
      const price = await getTokenPrice(userId, r.mint);
      positions.push({
        mint: r.mint,
        name: (await getTokenName(r.mint)) || "Unknown",
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

    const solVal = totalSol * solPrice;
    const usdcVal = totalUsdc;

    return res.json({
      scope: scopeAll ? "all" : "active",
      walletCount: wallets.length,
      netWorth: +(
        solVal +
        usdcVal +
        positions.reduce((s, t) => s + t.valueUSD, 0)
      ).toFixed(2),
      sol: { amount: totalSol, price: solPrice, valueUSD: solVal },
      usdc: { amount: totalUsdc, valueUSD: usdcVal },
      positions,
    });
  } catch (err) {
    console.error("❌ /positions error:", err);
    return res
      .status(500)
      .json({ error: "Failed to fetch token positions" });
  }
});
// :contentReference[oaicite:10]{index=10} :contentReference[oaicite:11]{index=11} :contentReference[oaicite:12]{index=12}

// ────────────────────────────────────────────────────────────────────────────
// POST /internal/buy (idempotent; used by DCA/Limit executors)
router.post("/buy", async (req, res) => {
  const {
    userId,
    jobId, // optional from scheduler
  } = req.body || {};

  // Prefer header key, then explicit jobId, then derived key
  const headerKey =
    req.get("Idempotency-Key") || req.headers["idempotency-key"] || jobId;

  const idKey =
    headerKey && uuidV4Regex.test(String(headerKey).trim())
      ? String(headerKey).trim()
      : deriveIdKey(userId, req.path, req.body || {});

  try {
    const jobResult = await runJob(
      idKey,
      async () => {
        let {
          amountInSOL,
          amountInUSDC,
          mint,
          force,
          walletLabel,
          slippage,
          strategy,
          tp,
          sl,
          tpPercent,
          slPercent,
        } = req.body;

        // Resolve wallet
        let wallet;
        try {
          wallet = await getWallet(userId, walletLabel);
          if (!walletLabel) walletLabel = wallet.label;
        } catch (e) {
          return { status: 403, response: { error: e.message } };
        }

        // Execute buy via manual executor; pass clientOrderId for executor-level cache
        let result;
        try {
          result = await performManualBuy({
            amountInSOL,
            amountInUSDC,
            mint,
            userId,
            walletId: wallet.id,
            walletLabel,
            slippage,
            strategy,
            tp,
            sl,
            tpPercent,
            slPercent,
            clientOrderId: idKey,
          });
        } catch (e) {
          if (isArmError(e)) return { status: 401, response: { error: "Automation not armed", needsArm: true, walletId: wallet.id } };
          throw e;
        }

        // ⚠️ Do NOT create a TP/SL rule here; the executor already creates one when tp/sl are present.
        // (Prevents duplicate TP/SL rules.)

        return { status: 200, response: { success: true, result } };
      },
      { timeoutMs: 90_000, maxRetries: 1 }
    );

    const status = jobResult.status || 200;
    return res.status(status).json(jobResult.response || {});
  } catch (err) {
    console.error("❌ INTERNAL /buy error:", err?.message || err);
    return res
      .status(500)
      .json({ error: err?.message || "Manual buy failed." });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /internal/sell (idempotent; used by TP/SL/Limit executors)
router.post("/sell", async (req, res) => {
  const {
    userId,
    jobId, // optional from scheduler
  } = req.body || {};

  const headerKey =
    req.get("Idempotency-Key") || req.headers["idempotency-key"] || jobId;

  const idKey =
    headerKey && uuidV4Regex.test(String(headerKey).trim())
      ? String(headerKey).trim()
      : deriveIdKey(userId, req.path, req.body || {});

  try {
    const jobResult = await runJob(
      idKey,
      async () => {
        let {
          percent,
          amount,
          strategy = "manual",
          mint,
          walletLabel,
          slippage,
          triggerType, // "tp"|"sl"|"limit" etc.  (executor uses this to avoid double alerts)
          force,
        } = req.body;

        // Resolve wallet
        let wallet;
        try {
          wallet = await getWallet(userId, walletLabel);
          if (!walletLabel) walletLabel = wallet.label;
        } catch (e) {
          return { status: 403, response: { error: e.message } };
        }

        // Amount-based sell
        if (amount && +amount > 0) {
          try {
            const result = await performManualSellByAmount({
              amount,
              mint,
              strategy,
              userId,
              walletId: wallet.id,
              walletLabel,
              slippage,
              context: "default",
            });
            return { status: 200, response: { success: true, result } };
          } catch (e) {
            if (isArmError(e))
              return {
                status: 401,
                response: { error: "Automation not armed", needsArm: true, walletId: wallet.id },
              };
            throw e;
          }
        }

        // Percent-based sell
        let pct = percent;
        if (pct == null) {
          return { status: 400, response: { error: "Missing sell percent or amount." } };
        }
        pct = parseFloat(pct);
        if (pct > 1) pct /= 100;
        if (!(pct > 0 && pct <= 1)) {
          return {
            status: 400,
            response: {
              error: "Sell percent must be between 1 and 100 (or 0.01 – 1.0).",
            },
          };
        }

        try {
          const result = await performManualSell({
            percent: pct,
            mint,
            strategy,
            userId,
            walletId: wallet.id,
            walletLabel,
            slippage,
            triggerType,
            context: "default",
          });
          return { status: 200, response: { success: true, result } };
        } catch (e) {
          if (isArmError(e))
            return {
              status: 401,
              response: { error: "Automation not armed", needsArm: true, walletId: wallet.id },
            };
          throw e;
        }
      },
      { timeoutMs: 90_000, maxRetries: 1 }
    );

    const status = jobResult.status || 200;
    return res.status(status).json(jobResult.response || {});
  } catch (err) {
    console.error("❌ INTERNAL /sell error:", err?.message || err);
    return res
      .status(500)
      .json({ error: err?.message || "Manual sell failed." });
  }
});

// ────────────────────────────────────────────────────────────────────────────
module.exports = router;
