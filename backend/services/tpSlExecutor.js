/* TP/SL executor – fires sells and then retires the rule 💸 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const prisma                 = require("../prisma/prisma");
const getTokenPrice          = require("./strategies/paid_api/getTokenPrice");
const { performManualSell }  = require("./manualExecutor");
const { sendAlert }          = require("../telegram/alerts");
const { sendBotAlert }       = require("../telegram/botAlerts");
const { getTokenBalanceRaw } = require("../utils/marketData");
const { PublicKey }          = require("@solana/web3.js");

/* ───────────────────────────── helpers ───────────────────────────── */
function shortMint(m) { return `${m.slice(0, 4)}…${m.slice(-4)}`; }
function tsUTC() { return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"; }
function fmt(x, d = 4) { return (+x).toFixed(d).replace(/\.?0+$/, ""); }

// function isAppUser(userId) {
//   return userId === "ui" || userId === "web";
// }
// async function alertUser(userId, msg, tag) {
//   try {
//     if (isAppUser(userId)) await sendAlert(userId, msg, tag);
//     else                   await sendBotAlert(userId, msg, tag);
//   } catch { /* silent fail */ }
// }


async function alertUser(userId, msg, tag = "TP/SL") {
  try {
    await sendAlert(userId, msg, tag);  // will handle prefs + chatId
  } catch (err) {
    console.error("❌ Telegram alert failed:", err.message);
  }
}


/* ────────────────────────── core checker ─────────────────────────── */
async function checkAndTriggerTpSl(rule) {
  const {
    id, mint,
    tp, sl, tpPercent, slPercent,
    sellPct,
    walletId, strategy = "manual",
    enabled, userId
  } = rule;
  if (!enabled) return;

  console.log(`📥 [TP/SL] Checking ${mint} (wallet ${walletId}) …`);

  /* 1️⃣ Fetch open trades for entry price */
  const rows = await prisma.trade.findMany({
    where   : { walletId, mint, strategy, side: "buy" },
    orderBy : { timestamp: "asc" }
  });
  if (!rows.length) {
    console.warn(`⚠️ No open trades found for ${mint} on wallet ${walletId}`);
    return;
  }
  const entryPriceUSD = rows[0].entryPriceUSD;
  if (!entryPriceUSD) {
    console.warn(`⚠️ Missing entryPriceUSD on first trade for ${mint}`);
    return;
  }

  /* 2️⃣ Current price */
  let price;
  try { price = await getTokenPrice(userId, mint); }
  catch (e) {
    console.warn("getTokenPrice failed:", e.message);
    return;
  }
  if (!price) return;

  const delta = ((price - entryPriceUSD) / entryPriceUSD) * 100;
  const hitTp = tp != null && tpPercent > 0 && (delta >= tp  || Math.abs(delta - tp)  < 0.00001);
  const hitSl = sl != null && slPercent > 0 && (delta <= -sl || Math.abs(delta + sl) < 0.00001);
  if (!hitTp && !hitSl) return;

  const triggerType  = hitTp ? "tp" : "sl";
  const sellFraction = sellPct != null
    ? sellPct / 100
    : (hitTp ? tpPercent : slPercent) / 100;

  /* 3️⃣ Fetch balance (for log) */
  const walletRow = await prisma.wallet.findUnique({
    where : { id: walletId },
    select: { publicKey: true }
  });
  if (!walletRow) throw new Error(`Wallet not found for id ${walletId}`);
  const owner = new PublicKey(walletRow.publicKey);

  let balanceRaw;
  try { balanceRaw = await getTokenBalanceRaw(owner, mint); }
  catch { balanceRaw = 0n; }

  const desiredRaw = (balanceRaw * BigInt(Math.round(sellFraction * 1e6))) / 1_000_000n;
  const safeRaw    = desiredRaw > balanceRaw ? balanceRaw : desiredRaw;
  const safePct    = balanceRaw > 0n ? (Number(safeRaw) / Number(balanceRaw)) * 100 : 0;

  console.log(`🚀 Trigger ${triggerType.toUpperCase()} → sell ${safePct.toFixed(2)}%`);

  /* 4️⃣ Execute sell */
  try {
    const { tx } = await performManualSell({
      percent     : sellFraction,
      mint,
      walletId,
      userId,
      strategy,
      triggerType,
      slippage    : 0.5
    });

    /* retire rule & clean up */
    // await prisma.tpSlRule.delete({ where: { id } });
    // const stillOpen = await prisma.trade.findMany({
    //   where: { walletId, mint, strategy, outAmount: { gt: 0 } }
    // });
    // if (stillOpen.length === 0) {
    //   console.log(`🧹 No open trades left for ${mint}, deleting remaining TP/SL rules…`);
    //   await prisma.tpSlRule.deleteMany({ where: { userId, walletId, mint, strategy } });
    // }
    await prisma.tpSlRule.deleteMany({ where: { id } });

    /* 5️⃣ Alert */
    const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
    const tokenUrl = `https://birdeye.so/token/${mint}`;
    const short    = shortMint(mint);
    const time     = tsUTC();
const targetPct = hitTp ? tp : sl;
const lines = `
🎯 *${triggerType === "tp" ? "Take Profit" : "Stop Loss"} Triggered*

🧾 *Mint:* \`${short}\`
🔗 [View Token on Birdeye](${tokenUrl})
📈 *Change:* ${delta.toFixed(2)} % (Target: ${targetPct}%)
💸 *Sold:* ${fmt(safePct, 2)} % of position
📉 *Entry Price:* $${entryPriceUSD.toFixed(6)}
👤 *Wallet ID:* \`${walletId}\`
🕒 *Time:* ${time}
📡 [View Transaction](${explorer})
`.trim();

// await alertUser(userId, lines, "TP/SL");
await alertUser(userId, lines, triggerType.toUpperCase()); 
    return { triggered: true, type: triggerType, changePct: delta, txHash: tx };

  } catch (err) {
    console.error("performManualSell failed:", err.message);

    if (err.message.includes("No matching open-trade rows")) {
      await prisma.tpSlRule.update({
        where: { id },
        data : { enabled: false, status: "orphaned", updatedAt: new Date() }
      });
    }

    await alertUser(
      userId,
      `❌ *TP/SL Error* for \`${mint}\`\n${err.message}`,
      "TP/SL"
    );
  }
}

module.exports = { checkAndTriggerTpSl };
