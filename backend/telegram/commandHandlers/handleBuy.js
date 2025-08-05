// handleBuy.js - Telegram handler for /buy command or inline Buy flow
// handleBuy.js - Telegram handler for /buy command or inline Buy flow
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const axios = require("axios");
const { sessions, rememberMint } = require("../utils/sessions");
const { loadSettings } = require("../utils/tpSlStorage");
const { logTrade } = require("../../services/utils/analytics/logTrade"); 
const API_BASE = process.env.API_BASE || "http://localhost:5001";
const { getUserPreferences } = require("../services/userPrefs"); 
const { isSafeToBuyDetailed } = require("../../services/utils/safety/safetyCheckers/botIsSafeToBuy"); // add this too
const { sendBotAlert } = require("../botAlerts"); 
const { addOrUpdateOpenTrade } = require("../../services/utils/analytics/openTrades"); // create this module
const { getTokenName } = require("../../services/utils/analytics/logTrade");
const { getTokenPriceApp } = require("../../utils/marketData"); // ✅ Add this



module.exports = async function handleBuy(bot, msg, token = null, amount = null, command = null) {
  const chatId = msg.chat.id;
  msg.command = command || "manual";


   // ✅ Quick Buy Shortcut (token + amount passed immediately)
   if (token && amount) {
    try {
      const prefs = await getUserPreferences(chatId);
      const slippage = prefs.slippage ?? 1.0;

      // Safety check if enabled
      if (prefs.safeMode) {
        const result = await isSafeToBuyDetailed(token);
        if (!result.passed) {
          await bot.sendMessage(chatId, `⚠️ Safety check failed — token flagged as unsafe.`);
          return;
        }
      }

      let res;
      try {
        res = await axios.post(`${API_BASE}/api/manual/buy`, {
          mint: token,
          amountInSOL: amount,
          walletLabel: "default",
          slippage,
          force: true,
        });
      } catch (err) {
        const errorMsg = err?.response?.data?.error || err.message;
        console.error("❌ BUY ERROR:", errorMsg);
      
        // 🔁 Retry once if block height expired
        if (errorMsg.includes("block height exceeded")) {
          console.warn("⏱ Retrying due to block height expiration...");
          await new Promise(r => setTimeout(r, 1500));
      
          try {
            res = await axios.post(`${API_BASE}/api/manual/buy`, {
              mint: token,
              amountInSOL: amount,
              walletLabel: "default",
              slippage,
              force: true,
            });
          } catch (retryErr) {
            const retryError = retryErr?.response?.data?.error || retryErr.message;
            console.error("❌ RETRY FAILED:", retryError);
            return bot.sendMessage(chatId, `❌ Quick Buy failed: ${retryError}`);
          }
        } else {
          return bot.sendMessage(chatId, `❌ Quick Buy failed: ${errorMsg}`);
        }
      }
      
      // ✅ Continue as normal
      const {
        tx, inAmount, outAmount, entryPrice, exitPrice, priceImpact
      } = res.data.result;


      // 🔢 Convert entryPrice (SOL/token) → USD/token
      const solPrice = await getTokenPriceApp("So11111111111111111111111111111111111111112");
      const entryPriceUSD = solPrice ? entryPrice * solPrice : null;
      const usdValue = entryPriceUSD ? +(inAmount / 1e9 * entryPriceUSD).toFixed(2) : null;
      const amountInSOL = amount;
      const amountInUSDC = null;
      const decimals = 9;

      
      if (!tx) {
        return bot.sendMessage(chatId, `❌ Quick Buy failed — no transaction was executed.`);
      }
      

      const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;

      await bot.sendMessage(chatId, `✅ *Quick Buy successful!*\n[View TX](${explorer})`, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
        }
      });

      // Optional alert
      await sendBotAlert(
        chatId,
        `✅ *Quick Buy Executed*\n\n` +
        `• Token: \`${token}\`\n` +
        `• Amount In: ${(inAmount / 1e9).toFixed(4)} SOL\n` +
        `• Output: ${(outAmount / 1e6).toFixed(4)} tokens\n` +
        `• Slippage: *${slippage}%*\n` +
        `• Price Impact: *${(priceImpact * 100).toFixed(2)}%*\n` +
        `• Tx: [View on Solana](${explorer})`,
        "Buy"
      );

      logTrade({
        strategy: "manual",
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: token,
        inAmount,
        outAmount,
        entryPrice,
        entryPriceUSD, // ✅ ADD THIS
        usdValue,       // ✅ AND THIS
        exitPrice,
        priceImpact,
        txHash: tx,
        success: true,
        notes: "Quick Buy",
      });
      

      return;
    } catch (err) {
      const error = err?.response?.data?.error || err.message;
      console.error("❌ QUICK BUY ERROR:", error);
      return bot.sendMessage(chatId, `❌ Quick Buy failed: ${error}`);
    }
  }



  // Step 1: Prompt user for token if none provided
     // Step 1: Prompt user for token if none provided
  if (!token && !amount) {
    sessions[chatId] = sessions[chatId] || {}; // ✅ Initialize session safely


    const mintButtons = (sessions[chatId].recentMints || []).map((m) => ({
      text: m.length > 6 ? m.slice(0, 4) + "…" + m.slice(-4) : m,
      callback_data: `selectMint:${m}`,
    }));

    const opts = {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          ...mintButtons.map((b) => [b]),
          [{ text: "🛒 Paste Buy", callback_data: "pasteNew" }],
        ],
      },
    };

    return bot.sendMessage(chatId, "🪙 *Choose a token mint to buy:*", opts);
  }



  try {
    // // Step 2: Show TP/SL config if it exists
    // const all = loadSettings();
    // const config = all?.[chatId]?.[token];
    // if (config && msg.command !== "autobuy") {
    //   const status = config.enabled === false ? "🚫 *DISABLED*" : "✅ *ENABLED*";
    //   await bot.sendMessage(
    //     chatId,
    //     `📈 TP/SL Config for \`${token}\`:\n🎯 TP: *${config.tp}%* / SL: *${config.sl}%*\n${status}`,
    //     { parse_mode: "Markdown" }
    //   );
    // }
    


    // Step 2.5: Run safety check if Safe Mode is enabled
const prefs = await getUserPreferences(chatId);
console.log(`📊 [BUY] Slippage set for ${token}: ${prefs.slippage ?? 1.0}`);


if (prefs.safeMode) {
  const result = await isSafeToBuyDetailed(token);

  let breakdown = `🛡️ *Safety Check (Safe Mode)*\nPassed: ${result.passed ? "✅ Yes" : "❌ No"}\n\n`;
  for (const [key, value] of Object.entries(result.breakdown || {})) {
    const passed = typeof value === "object" ? value.passed : value;
    const reason = value?.error ? ` – ${value.error}` : "";
    breakdown += `• ${key}: ${passed ? "✅" : "❌"}${reason}\n`;
  }

  await bot.sendMessage(chatId, breakdown.trim(), { parse_mode: "Markdown" });
}




    // Step 3: Execute manual buy via API
    const walletLabel = "default";
    const slippage = prefs.slippage ?? 1.0; // ✅ Use saved slippage, default to 1.0 if unset
    console.log(`📊 Using slippage: ${slippage}% for buy on ${token}`);

    const res = await axios.post(`${API_BASE}/api/manual/buy`, {
      mint: token,
      amountInSOL: amount,
      walletLabel,
      slippage,
      force: true,
    });

    const {
      tx, inAmount, outAmount, entryPrice, exitPrice, priceImpact
    } = res.data.result;

    if (!tx) {
      await bot.sendMessage(chatId, `❌ Buy failed — no transaction was executed.`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
        }
      });
      return;
    }

    const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;

    await bot.sendMessage(chatId, `✅ *Buy successful!*\n[View Transaction](${explorer})`, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔙 Back to Menu", callback_data: "home" }]
        ]
      }
    });

    await sendBotAlert(
      chatId,
      `✅ *Manual Buy Executed*\n\n` +
      `• Token: \`${token}\`\n` +
      `• Amount In: ${(inAmount / 1e9).toFixed(4)} SOL\n` +
      `• Output: ${(outAmount / 1e6).toFixed(4)} tokens\n` +
      `• Slippage: *${slippage}%*\n` +
      `• Entry Price: *${entryPrice.toFixed(6)} SOL*` + (entryPriceUSD ? ` / *$${entryPriceUSD}*` : "") + `\n` +
      `• Price Impact: *${(priceImpact * 100).toFixed(2)}%*\n` +      `• Tx: [View on Solana](${explorer})`,
      "Buy"
    );

    // ✅ Step 4: Log the trade to manual.json
    if (tx) {
    logTrade({
      strategy: "manual",
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: token,
      inAmount,
      outAmount,
      entryPriceUSD, // ✅ NEW
      entryPrice,
      exitPrice,
      priceImpact,
      usdValue,
      txHash: tx,
      success: true,
    });
  }

const tokenName = await getTokenName(token);

await addOrUpdateOpenTrade({
  mint: token,
  entryPrice,
  entryPriceUSD,
  inAmount,
  outAmount,
  amountInSOL,
  amountInUSDC,
  walletLabel,
  slippage,
  decimals,
  usdValue,
  strategy: "manual",
  txHash: tx,
  type: "buy",
});
} catch (err) {


  const errorMsg = err?.response?.data?.error || err.message;

  // ✅ Send alert first
  await sendBotAlert(chatId, `❌ Manual Buy failed for \`${token}\`: ${errorMsg}`, "Buy");

  const shortMint = token.length > 10 ? token.slice(0, 4) + "…" + token.slice(-4) : token;
  const formattedAmount = parseFloat(amount).toFixed(3);
  
  await bot.sendMessage(chatId, `❌ Buy failed: ${errorMsg}`, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: `🔁 Retry ${formattedAmount} SOL for ${shortMint}`, callback_data: `retryBuy:${token}:${amount}` }],
        [{ text: "🔙 Back to Menu", callback_data: "home" }]
      ]
    }
  });
}

  // Step 5: Cleanup session
  rememberMint(chatId, token);
  delete sessions[chatId];
};

