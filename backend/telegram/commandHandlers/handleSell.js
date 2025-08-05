// handleSell.js - Telegram handler for /sell command or inline Sell flow
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { sessions, rememberMint } = require("../utils/sessions");
const axios = require("axios");
const { loadSettings } = require("../utils/tpSlStorage");
const { logTrade } = require("../../services/utils/analytics/logTrade"); 
const { sendBotAlert } = require("../botAlerts");
const { getUserPreferences } = require("../services/userPrefs");



const API_BASE = process.env.API_BASE || "http://localhost:3001";

module.exports = async function handleSell(bot, msg, token = null, percent = null) {
  const chatId = msg.chat.id;



  // Step 1: Prompt user to pick token if missing
  if (!token && !percent) {
    sessions[chatId] = { step: "awaitingToken", command: "sell" };
    const { getCurrentWallet, getWalletBalance } = require("../../services/utils/wallet/walletManager");
    const { getTokenAccountsAndInfo } = require("../../utils/tokenAccounts");
    const { getCachedPrice } = require("../../utils/priceCache.dynamic");
    const PAGE_SIZE = 5;

    const wallet = getCurrentWallet();
    const tokenAccounts = await getTokenAccountsAndInfo(wallet.publicKey);

    let allPositions = [];

    for (const t of tokenAccounts) {
      if (t.amount <= 0) continue;

      const price = await getCachedPrice(t.mint);
    await new Promise(res => setTimeout(res, 200)); // rate-limit buffer
    const valueUSD = price ? +(t.amount * price).toFixed(2) : 0;

      allPositions.push({
        name: t.name?.replace(/[^\x20-\x7E]/g, "") || "Unknown",
        mint: t.mint,
        display: `${t.name || t.mint.slice(0, 4)} (${t.amount.toFixed(3)} tokens ~ $${valueUSD})`,
      });
    }

    // build buttons
    const buttons = allPositions.slice(0, PAGE_SIZE).map(p => [
      { text: `🟤 Sell ${p.display}`, callback_data: `sellToken:${p.mint}` }
    ]);

    // fallback manual option
    buttons.push([{ text: "🔍 Paste Mint Manually", callback_data: "sell:manual" }]);

    return bot.sendMessage(chatId, "📉 *Select a token to sell:*", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });
  }


  // Step 2: Show current TP/SL config
  const all = loadSettings();
  const config = all?.[chatId]?.[token];

  // if (config) {
  //   await bot.sendMessage(chatId, `📉 TP/SL Config for \`${token}\`:\n🎯 TP: *${config.tp}%* / SL: *${config.sl}%*`, {
  //     parse_mode: "Markdown",
  //   });
  // }

 // Step 3: TP/SL enforcement (if enabled)
try {
  if (config && config.enabled !== false) {
    const { tp, sl } = config;
    const pnlRes = await axios.get(`${API_BASE}/api/positions/pnl/${token}`);
    const pct = pnlRes.data?.pnlPct;

    if (pct !== undefined) {
      if (pct >= tp) {
        await bot.sendMessage(chatId, `🎯 *Take Profit triggered!* (+${pct.toFixed(2)}%)`);
      } else if (pct <= -sl) {
        await bot.sendMessage(chatId, `🔻 *Stop Loss triggered!* (${pct.toFixed(2)}%)`);
      } else {
        return bot.sendMessage(chatId, `🟡 Not within TP/SL range (P&L: ${pct.toFixed(2)}%)`);
      }
    }
  }
} catch (err) {
  console.error("TP/SL Check Error:", err.message);
}

// step 3.5 
let result;
let tx;

try {
  const prefs = await getUserPreferences(chatId);
  const slippage = prefs.slippage ?? 1.0;
  console.log(`📊 [SELL] Slippage set for ${token}: ${slippage}`);

  const res = await axios.post(`${API_BASE}/api/manual/sell`, {
    mint: token,
    percent: Number(percent),
    walletLabel: "default",
    slippage,
    force: true,
  });

  result = res?.data?.result || {};
  tx = result.tx;

  if (!tx) throw new Error("No transaction returned");

} catch (err) {
  const errorMsg = err?.response?.data?.error || err.message || "Manual sell failed.";
  console.error("❌ SELL ERROR:", err);
  await sendBotAlert(chatId, `❌ Manual Sell failed for \`${token}\`: ${errorMsg}`, "Sell");
  return bot.sendMessage(chatId, `❌ Sell failed: ${errorMsg}`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
    }
  });
}



// Step 4: Handle success cleanly
const inAmount = result.inAmount ?? 0;
const outAmount = result.outAmount ?? 0;
const entryPrice = result.entryPrice ?? 0;
const exitPrice = result.exitPrice ?? 0;
const priceImpact = result.priceImpact ?? 0;
const entryPriceUSD = result.entryPriceUSD ?? null;
const usdValue = result.usdValue ?? null;

const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;

await bot.sendMessage(chatId, `✅ *Sell successful!*\n[View TX](${explorer})`, {
  parse_mode: "Markdown",
  disable_web_page_preview: true,
  reply_markup: {
    inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
  }
});

try {
  await sendBotAlert(
    chatId,
    `✅ *Manual Sell Executed*\n\n` +
    `• Token: \`${token}\`\n` +
    `• Amount Out: ${(outAmount / 1e6).toFixed(4)} USDC\n` +
    (usdValue ? `• USD Value: $${usdValue.toFixed(2)}\n` : "") +
    (entryPriceUSD ? `• Entry Price (USD): $${entryPriceUSD.toFixed(4)}\n` : "") +
    `• Slippage: *${slippage}%*\n` +
    `• Price Impact: *${(priceImpact * 100).toFixed(2)}%*\n` +
    `• Tx: [View on Solana](${explorer})`,
    "Sell"
  );

  await logTrade({
    strategy: "manual",
    inputMint: token,
    outputMint: "So11111111111111111111111111111111111111112",
    inAmount: +inAmount.toFixed(4),
    outAmount: +outAmount.toFixed(4),
    entryPrice,
    entryPriceUSD, // ✅ Add this
    usdValue,      // ✅ Add this
    exitPrice,
    priceImpact,
    txHash: tx,
    success: true,
  });
} catch (logErr) {
  console.warn("⚠️ Sell success but alert/log failed:", logErr.message);
}


// Step 5: Cleanup
rememberMint(chatId, token);
delete sessions[chatId];
};

// ✅ Final Flow (Telegram UX):
// User clicks Sell & Manage

// Bot shows:

// less
// Copy
// Edit
// ⚖️ Manage Position
// Token: SLAP
// Choose how much to sell:
// [ Sell 25% ] [ Sell 50% ] [ Sell 100% ]
// [ Cancel ]
