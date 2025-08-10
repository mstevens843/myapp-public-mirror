require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const prisma                   = require("../prisma/prisma");
const axios                    = require("axios");
const { prepareBuyLogFields }  = require("./utils/analytics/tradeFormatter");
const { logTrade }             = require("./utils/analytics/logTrade");
const { addOrUpdateOpenTrade } = require("./utils/analytics/openTrades");
const { sendBotAlert }         = require("../telegram/botAlerts");
const { sendAlert }            = require("../telegram/alerts");

const API_BASE = process.env.API_BASE || "http://localhost:5001";

/* ────────────────────────────── helpers ───────────────────────────── */
function shortMint(m) { return `${m.slice(0, 4)}…${m.slice(-4)}`; }
function tsUTC() { return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"; }
function fmt(x, d = 4) { return (+x).toFixed(d).replace(/\.?0+$/, ""); }

// function isAppUser(userId) {
//   return userId === "ui" || userId === "web";
// }
// async function alertUser(userId, message, category) {
//   if (isAppUser(userId)) await sendAlert(userId, message, category);
//   else                    await sendBotAlert(userId, message, category);
// }

async function alertUser(userId, msg, tag = "DCA") {
  try {
    await sendAlert(userId, msg, tag);  // will handle prefs + chatId
  } catch (err) {
    console.error("❌ Telegram alert failed:", err.message);
  }
}

/* ────────────────────────────── MAIN BUY ──────────────────────────── */
async function performDcaBuy(userId, order, authHeader = "") {
  const buyPayload = {
    mint        : order.tokenMint,
    walletLabel : order.walletLabel || "default",
    slippage    : order.slippage ?? 1.0,
    force       : true,
    strategy    : "dca",
    skipLog     : true,
    amountInUSDC: order.unit === "usdc" ? order.amountPerBuy : undefined,
    amountInSOL : order.unit === "sol"  ? order.amountPerBuy : undefined
  };

  try {
    /* ── swap call ───────────────────────────────── */
    const res = await axios.post(`${API_BASE}/api/internalJobs/buy`, buyPayload, {
      headers: { Authorization: authHeader }
    });
    const src = res.data.result || res.data || {};
    const { tx, inAmount, outAmount } = src;
    if (!tx) throw new Error("No transaction returned");

    /* ── update DCA order row ───────────────────── */
    await prisma.dcaOrder.update({
      where: { id: order.id },
      data : {
        completedBuys: { increment: 1 },
        executedCount: { increment: 1 },
        lastBuyAt    : new Date(),
        tx
      }
    });

    /* ── analytics: log + open‑trade ────────────── */
    const logPayload = await prepareBuyLogFields({
      strategy   : "dca",
      inputMint  : buyPayload.amountInSOL
        ? "So11111111111111111111111111111111111111112"
        : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      outputMint : order.tokenMint,
      inAmount,
      outAmount,
      walletLabel: buyPayload.walletLabel,
      slippage   : buyPayload.slippage,
      txHash     : tx
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
      unit         : order.unit || "usdc"
    });

    /* ── rich Telegram alert ─────────────────────── */
    const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
    const tokenUrl = `https://birdeye.so/token/${order.tokenMint}`;
    const short    = shortMint(order.tokenMint);
    const time     = tsUTC();
    const amountIn = order.unit === "usdc"
      ? `${fmt(order.amountPerBuy, 2)} USDC`
      : `${fmt(order.amountPerBuy, 3)} SOL`;

    const lines = `
📉 *DCA Buy Executed* ${order.completedBuys + 1} / ${order.totalBuys}

🧾 *Mint:* \`${short}\`
🔗 [View Token on Birdeye](${tokenUrl})
💸 *In:* ${amountIn}
👤 *Wallet:* \`${order.walletLabel || "default"}\`
🕒 *Time:* ${time}
📡 [View Transaction](${explorer})
    `.trim();

    await alertUser(userId, lines, "DCA");
    return { tx };

  } catch (err) {
    console.error(`❌ DCA buy failed for order ${order.id}:`, err.message);

    await prisma.dcaOrder.update({
      where: { id: order.id },
      data : { missedCount: { increment: 1 } }
    });

    const failMsg = `❌ *DCA Buy ${order.completedBuys + 1} / ${order.totalBuys} Failed*\n${err.message}`;
    await alertUser(userId, failMsg, "DCA");
    return { tx: null };
  }
}

async function executeImmediateDcaBuy(userId, order) {
  return await performDcaBuy(userId, order);
}

module.exports = {
  performDcaBuy,
  executeImmediateDcaBuy
};
