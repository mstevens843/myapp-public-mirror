// backend/services/dcaExecutor.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const prisma                   = require("../prisma/prisma");
const axios                    = require("axios");
const { prepareBuyLogFields }  = require("./utils/analytics/tradeFormatter");
const { logTrade }             = require("./utils/analytics/logTrade");
const { addOrUpdateOpenTrade } = require("./utils/analytics/openTrades");
const { sendBotAlert }         = require("../telegram/botAlerts"); // kept for compatibility
const { sendAlert }            = require("../telegram/alerts");

const API_BASE = process.env.API_BASE || "http://localhost:5001";

/* ────────────────────────────── helpers ───────────────────────────── */
function shortMint(m) { return `${m.slice(0, 4)}…${m.slice(-4)}`; }
function tsUTC() { return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"; }
function fmt(x, d = 4) { return (+x).toFixed(d).replace(/\.?0+$/, ""); }
function pick(...vals) { return vals.find(v => v !== undefined && v !== null); }

// // Legacy split between UI and bot users—preserved for reference.
// function isAppUser(userId) {
//   return userId === "ui" || userId === "web";
// }
// async function alertUser(userId, message, category) {
//   if (isAppUser(userId)) await sendAlert(userId, message, category);
//   else                    await sendBotAlert(userId, message, category);
// }

/** Unified alert (respects user prefs + chat resolution in sendAlert). */
async function alertUser(userId, msg, tag = "DCA") {
  try {
    await sendAlert(userId, msg, tag);
  } catch (err) {
    console.error("❌ Telegram alert failed:", err?.message || err);
  }
}

/** Derive a safe, numeric per-buy amount if not precomputed. */
function deriveAmountPerBuy(order) {
  if (order?.amountPerBuy != null) return Number(order.amountPerBuy);
  const total = Number(order?.amount ?? 0);
  const n     = Number(pick(order?.numBuys, order?.totalBuys));
  if (!total || !n) return null;
  return total / n;
}

/** Normalize unit and input mint. */
function unitInfo(unitRaw) {
  const unit = String(unitRaw || "usdc").toLowerCase();
  if (unit === "sol") {
    return {
      unit: "sol",
      inputMint: "So11111111111111111111111111111111111111112",
      amountField: "amountInSOL",
      fmtDigits: 3,
    };
  }
  return {
    unit: "usdc",
    inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amountField: "amountInUSDC",
    fmtDigits: 2,
  };
}

/* ────────────────────────────── MAIN BUY ──────────────────────────── */
/**
 * Executes a single DCA buy chunk.
 * NOTE: This function updates the DCA row (completedBuys/executedCount/lastBuyAt/tx)
 * on success. Callers (monitors, schedulers) should NOT increment again.
 */
async function performDcaBuy(userId, order, authHeader = "") {
  if (!order?.tokenMint) {
    throw new Error("DCA order missing tokenMint");
  }

  const { unit, inputMint, amountField, fmtDigits } = unitInfo(order.unit);
  const amountPerBuy = deriveAmountPerBuy(order);
  if (!amountPerBuy) {
    throw new Error("DCA order missing amountPerBuy and cannot derive from amount/numBuys");
  }

  const buyPayload = {
    mint        : order.tokenMint,                          // target token
    walletLabel : order.walletLabel || "default",
    slippage    : order.slippage ?? 1.0,
    force       : true,
    strategy    : "dca",
    skipLog     : true,                                     // we log manually below
    amountInUSDC: unit === "usdc" ? amountPerBuy : undefined,
    amountInSOL : unit === "sol"  ? amountPerBuy : undefined,
  };

  try {
    /* ── swap call ───────────────────────────────── */
    const res = await axios.post(`${API_BASE}/api/internalJobs/buy`, buyPayload, {
      headers: authHeader ? { Authorization: authHeader } : {},
      timeout: 60_000,
    });

    const src = res?.data?.result || res?.data || {};
    const { tx, inAmount, outAmount } = src;
    if (!tx) throw new Error("No transaction returned from swap");

    /* ── update DCA order row ───────────────────── */
    await prisma.dcaOrder.update({
      where: { id: order.id },
      data : {
        completedBuys: { increment: 1 },
        executedCount: { increment: 1 },
        lastBuyAt    : new Date(),
        tx,
      },
    });

    /* ── analytics: log + open-trade ────────────── */
    const logPayload = await prepareBuyLogFields({
      strategy   : "dca",
      inputMint,
      outputMint : order.tokenMint,
      inAmount,
      outAmount,
      walletLabel: buyPayload.walletLabel,
      slippage   : buyPayload.slippage,
      txHash     : tx,
    });

    await logTrade(logPayload);

    await addOrUpdateOpenTrade({
      mint         : order.tokenMint,
      entryPrice   : logPayload.entryPrice,
      entryPriceUSD: logPayload.entryPriceUSD,
      inAmount,
      outAmount,
      strategy     : "dca",
      walletLabel  : buyPayload.walletLabel,
      slippage     : buyPayload.slippage,
      decimals     : logPayload.decimals,
      usdValue     : logPayload.usdValue,
      txHash       : tx,
      type         : "buy",
      unit,
    });

    /* ── rich Telegram alert ─────────────────────── */
    const totalBuys = Number(pick(order?.numBuys, order?.totalBuys)) || 0;
    const doneNext  = Number(order?.completedBuys || 0) + 1; // pre-increment view
    const explorer  = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
    const tokenUrl  = `https://birdeye.so/token/${order.tokenMint}`;
    const short     = shortMint(order.tokenMint);
    const time      = tsUTC();
    const amountInS = unit === "usdc"
      ? `${fmt(amountPerBuy, fmtDigits)} USDC`
      : `${fmt(amountPerBuy, fmtDigits)} SOL`;

    const lines = `
📉 *DCA Buy Executed* ${doneNext} / ${totalBuys}

🧾 *Mint:* \`${short}\`
🔗 [View Token on Birdeye](${tokenUrl})
💸 *In:* ${amountInS}
👤 *Wallet:* \`${order.walletLabel || "default"}\`
🕒 *Time:* ${time}
📡 [View Transaction](${explorer})
    `.trim();

    await alertUser(userId, lines, "DCA");
    return { tx, inAmount, outAmount };

  } catch (err) {
    const msg =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      String(err);

    console.error(`❌ DCA buy failed for order ${order?.id || "?"}:`, msg);

    try {
      await prisma.dcaOrder.update({
        where: { id: order.id },
        data : { missedCount: { increment: 1 } },
      });
    } catch (dbErr) {
      console.error("❌ Failed to bump missedCount:", dbErr?.message || dbErr);
    }

    const totalBuys = Number(pick(order?.numBuys, order?.totalBuys)) || 0;
    const failIdx   = Number(order?.completedBuys || 0) + 1;

    const failMsg = `❌ *DCA Buy ${failIdx} / ${totalBuys} Failed*\n${msg}`;
    await alertUser(userId, failMsg, "DCA");

    return { tx: null };
  }
}

/** Convenience wrapper when the caller conceptually wants “now”. */
async function executeImmediateDcaBuy(userId, order, authHeader = "") {
  return await performDcaBuy(userId, order, authHeader);
}

module.exports = {
  performDcaBuy,
  executeImmediateDcaBuy,
};
