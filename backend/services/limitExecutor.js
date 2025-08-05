require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const prisma                  = require("../prisma/prisma");
const axios                    = require("axios");
const { prepareBuyLogFields }  = require("./utils/analytics/tradeFormatter");
const { addOrUpdateOpenTrade } = require("./utils/analytics/openTrades");
const { logTrade }             = require("./utils/analytics/logTrade");
const { sendBotAlert }         = require("../telegram/botAlerts");
const { sendAlert }            = require("../telegram/alerts");

const API_BASE = process.env.API_BASE || "http://localhost:5001";

/* ───────────────────────────────────────── helpers ───────────────────────── */
function shortMint(m) { return `${m.slice(0, 4)}…${m.slice(-4)}`; }
function tsUTC() { return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"; }
function fmt(x, d = 4) { return (+x).toFixed(d).replace(/\.?0+$/, ""); }

const STABLES = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX",
  "7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT"
]);

// function isAppUser(userId) {
//   return userId === "ui" || userId === "web";
// }

// async function alertUser(userId, message, category) {
//   if (isAppUser(userId)) {
//     await sendAlert(userId, message, category);
//   } else {
//     await sendBotAlert(userId, message, category);
//   }
// }

async function alertUser(userId, msg, tag = "Limit") {
  try {
    await sendAlert(userId, msg, tag);
  } catch (err) {
    console.error("❌ Telegram alert failed:", err.message);
  }
}


/* ──────────────────────────────── LIMIT BUY ─────────────────────────────── */
async function performLimitBuy(order, authHeader = "") {
  const { id, token, amount, walletLabel } = order;

  const buyPayload = {
    mint        : token,
    walletLabel : walletLabel || "default",
    slippage    : 1.0,
    force       : true,
    strategy    : "limit",
    skipLog     : true,
    amountInUSDC: amount
  };

  const res = await axios.post(`${API_BASE}/api/internalJobs/buy`, buyPayload, {
    headers: { Authorization: authHeader }
  });

  const src = res.data.result || res.data || {};
  const { tx, entryPriceUSD, entryPrice, usdValue, inAmount, outAmount } = src;
  if (!tx) throw new Error("performLimitBuy returned null tx");

  await prisma.limitOrder.update({
    where: { id },
    data : { status: "executed", executedAt: new Date(), tx }
  });

  await handleBuySuccess({
    userId: order.userId, order, tx,
    usdValue, entryPrice, entryPriceUSD, inAmount, outAmount
  });

  if (STABLES.has(token)) {
    console.log(`🚫 Skipping trade logging for stable ${token}`);
    return tx;
  }

  return tx;
}

/* ──────────────────────────────── LIMIT SELL ─────────────────────────────── */
async function performLimitSell(order, authHeader = "") {
  const { id, token, amount, walletLabel } = order;

  const sellPayload = {
    mint        : token,
    walletLabel : walletLabel || "default",
    slippage    : 1.0,
    force       : true,
    strategy    : "limit",
    skipLog     : true,
    amount
  };

  const res = await axios.post(`${API_BASE}/api/internalJobs/sell`, sellPayload, {
    headers: { Authorization: authHeader }
  });

  const src = res.data.result || res.data || {};
  const { tx } = src;
  if (!tx) throw new Error("performLimitSell returned null tx");

  await prisma.limitOrder.update({
    where: { id },
    data : { status: "executed", executedAt: new Date(), tx }
  });

  /* ── alert in new unified style ───────────────── */
  const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
  const tokenUrl = `https://birdeye.so/token/${token}`;
  const short    = shortMint(token);
  const time     = tsUTC();

  const lines = `
💼 *Limit Sell Executed*

🧾 *Mint:* \`${short}\`
🔗 [View Token on Birdeye](${tokenUrl})
🎯 *Triggered At:* \`$${order.targetPrice?.toFixed(6) || "N/A"}\`
🎯 *Amount Sold:* ${fmt(amount, 4)} tokens
👤 *Wallet:* \`${walletLabel || "default"}\`
🕒 *Time:* ${time}
📡 [View Transaction](${explorer})
`.trim();

  await alertUser(order.userId, lines, "Limit");
  return tx;
}

/* ─────────────────────── helper: BUY logging + alert ─────────────────────── */
async function handleBuySuccess({
  userId, order, tx, usdValue,
  entryPrice, entryPriceUSD,
  inAmount, outAmount
}) {
  /* full rich alert */
  const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
  const tokenUrl = `https://birdeye.so/token/${order.token}`;
  const short    = shortMint(order.token);
  const time     = tsUTC();

  const lines = `
🛒 *Limit Buy Executed*

🧾 *Mint:* \`${short}\`
🔗 [View Token on Birdeye](${tokenUrl})
💸 *In:* ${fmt(order.amount, 2)} USDC
🎯 *Triggered At:* \`$${order.targetPrice?.toFixed(6) || "N/A"}\`
📈 *Entry:* \`$${entryPriceUSD?.toFixed(6) || "N/A"}\`
👤 *Wallet:* \`${order.walletLabel || "default"}\`
🕒 *Time:* ${time}
📡 [View Transaction](${explorer})
`.trim();

  await alertUser(userId, lines, "Limit");

  /* log + open‑trades (skip for stables handled earlier) */
  const logPayload = await prepareBuyLogFields({
    strategy   : "limit",
    inputMint  : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    outputMint : order.token,
    inAmount,
    outAmount,
    walletLabel: order.walletLabel || "default",
    slippage   : 1.0,
    txHash     : tx
  });

  await logTrade(logPayload);
  await addOrUpdateOpenTrade({
    mint         : order.token,
    entryPrice   : logPayload.entryPrice,
    entryPriceUSD: logPayload.entryPriceUSD,
    inAmount,
    outAmount,
    strategy     : "limit",
    walletLabel  : order.walletLabel || "default",
    slippage     : 1.0,
    decimals     : logPayload.decimals,
    usdValue     : logPayload.usdValue,
    txHash       : tx,
    type         : "buy",
    unit         : "usdc"
  });
}

module.exports = {
  performLimitBuy,
  performLimitSell
};
