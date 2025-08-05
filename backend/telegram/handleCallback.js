// telegram/handleCallback.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { rememberMint } = require("./utils/sessions");
const { sendBotAlert } = require("./botAlerts"); 
const handleBuy = require("./commandHandlers/handleBuy");
const handleSell = require("./commandHandlers/handleSell");
const handleWallet = require("./commandHandlers/handleWallet");
const handlePositions = require("./commandHandlers/handlePositions");
const handleSafety = require("./commandHandlers/handleSafety");
const handleSettings = require("./commandHandlers/handleSettings");
const handleAlerts = require("./commandHandlers/handleAlerts");
const handleManage = require("./commandHandlers/handleManage");
const handleRefer = require("./commandHandlers/handleRefer");
const handleDca = require("./commandHandlers/handleDca");
const handleLimits = require("./commandHandlers/handleLimits");
const handleTrades = require("./commandHandlers/handleTrades");
const handleMenu = require("./commandHandlers/handleMenu");
const handleTpSl = require("./commandHandlers/handleTpSl"); 
const handleTpSlDelete = require("./commandHandlers/handleTpSlDelete");
const handleTpSlEdit = require("./commandHandlers/handleTpSlEdit");
const handleCreateLimit = require("./commandHandlers/handleCreateLimit");
const handleCancelLimit = require("./commandHandlers/handleCancelLimit");
const handleConvert = require("./commandHandlers/handleConvert");
const { loadSettings, saveSettings } = require("./utils/tpSlStorage");
const sessions = require("./utils/sessions");
const { addUserLimitOrder, removeUserLimitOrder, getUserLimitOrders } = require("./utils/limitManager");
const { addUserDcaOrder, removeUserDcaOrder, getUserDcaOrders } = require("./services/dcaManager");
const { getUserPreferences, setUserPreferences } = require("./services/userPrefs");

const { getTelegramPrefs, setTelegramPrefs } = require("./utils/telegramPrefs");




module.exports = async function handleCallback(bot, query) {
  const chatId = query.message.chat.id;
  const data = query.data;

  bot.answerCallbackQuery(query.id);


  // if (data === "menu") {
  //   return require("./commandHandlers/handleMenu")(bot, msg);
  // }

  if (data.startsWith("selectMint:")) {
    const mint = data.split(":")[1];
    rememberMint(chatId, mint);
  
    const prefs = await getUserPreferences(chatId);
    if (prefs.autoBuy?.enabled && prefs.autoBuy?.amount) {
      return handleBuy(bot, { chat: { id: chatId } }, mint, prefs.autoBuy.amount);
    }
  
    const session = sessions[chatId];
    if (session) {
      session.token = mint;
      session.step = "awaitingAmount";
      return bot.sendMessage(chatId, `💰 How much SOL to ${session.command}?`);
    }
  }


if (data.startsWith("retryBuy:")) {
  const [, mint, amount] = data.split(":");
  return handleBuy(bot, { chat: { id: chatId } }, mint, parseFloat(amount));
}

  if (data.startsWith("sort:")) {
    const mode = data.split(":")[1];
    sessions[chatId] = { ...sessions[chatId], sortMode: mode, positionsPage: 0 };
    const handlePositions = require("./commandHandlers/handlePositions");
    return handlePositions(bot, { chat: { id: chatId } }, 0);
  }

  if (data === "pasteNew") {
    const session = sessions[chatId];
    if (session) {
      session.step = "awaitingToken";
      session.command = "buy"; // ✅ explicitly set to buy
    } else {
      sessions[chatId] = { step: "awaitingToken", command: "buy" };
    }
  
    return bot.sendMessage(chatId, "🪙 Paste the token mint manually:");
  }

  if (data === "pasteNewSafety") {
    sessions[chatId] = { step: "awaitingToken", command: "safety" };
    return bot.sendMessage(chatId, "🛡️ Paste the token mint to *run a safety check*:", {
      parse_mode: "Markdown"
    });
  }

  if (data === "limit:add") {
    return handleCreateLimit(bot, query.message);
  }

  if (data === "limit:remove") {
    return handleCancelLimit(bot, query.message);
  }

  if (data.startsWith("sellPercent:")) {
    const [_, percentStr, mint] = data.split(":");
    const percent = parseFloat(percentStr);
  
    if (!mint || isNaN(percent)) {
      return bot.sendMessage(chatId, "❌ Invalid sell command.");
    }
  
    return handleSell(bot, { chat: { id: chatId } }, mint, percent);
  }
  
  

  // if (data.startsWith("sellPercent:")) {
  //   const [_, percentStr, mint] = data.split(":");
  //   const fraction = parseFloat(percentStr) / 100;
  //   if (!mint || isNaN(fraction)) {
  //     return bot.sendMessage(chatId, "❌ Invalid sell command.");
  //   }
  
  //   const { getCurrentWallet } = require("../services/utils/wallet/walletManager");
  //   const { getTokenAccountsAndInfo } = require("../utils/tokenAccounts");
  //   const axios = require("axios");
  //   const API_BASE = process.env.API_BASE_URL || "http://localhost:5001";
  
  //   try {
  //     const wallet = getCurrentWallet();
  //     const accounts = await getTokenAccountsAndInfo(wallet.publicKey);
  //     const token = accounts.find(t => t.mint === mint);
  
  //     const balance = token?.amount || 0;
  //     const floatAmount = +(balance * fraction).toFixed(6);
  
  //     if (!floatAmount || floatAmount <= 0) {
  //       return bot.sendMessage(chatId, "❌ Could not calculate sell amount. Maybe 0 balance.");
  //     }
  
  //     const res = await axios.post(`${API_BASE}/api/manual/sell`, {
  //       amount: floatAmount,
  //       mint,
  //       walletLabel: "default",
  //       slippage: 0.5,
  //     });
  
  //     const tx = res.data.result?.tx;
  //     if (!tx) {
  //       return bot.sendMessage(chatId, "❌ Sell failed — no transaction was executed.");
  //     }
  //     const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
  
  //     return bot.sendMessage(chatId, `✅ *Sell successful!*\n[TX Link](${explorer})`, {
  //       parse_mode: "Markdown",
  //       disable_web_page_preview: true,
  //       reply_markup: {
  //         inline_keyboard: [
  //           [{ text: "🔙 Back to Menu", callback_data: "home" }]
  //         ]
  //       }
  //     });
      
  //   } catch (err) {
  //     console.error("❌ SELL ERROR:", err.response?.data || err.message);
  //     const errorMsg = err?.response?.data?.error || "Unknown error.";
  //     return bot.sendMessage(chatId, `❌ Sell failed: ${errorMsg}`, {
  //       parse_mode: "Markdown",
  //       reply_markup: {
  //         inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
  //       }
  //     });    }
  // }

  // Handle Sell Token Selection from Positions list
if (data.startsWith("sellToken:")) {
  const mint = data.split(":")[1];
if (!mint) return bot.sendMessage(chatId, "❌ Invalid mint.");

return bot.sendMessage(chatId, `⚖️ *Manage Position*\nToken: \`${mint}\`\n\nChoose how much to sell:`, {
  parse_mode: "Markdown",
  reply_markup: {
    inline_keyboard: [
      [
        { text: "💸 Sell 25%", callback_data: `sellPercent:25:${mint}` },
        { text: "💸 Sell 50%", callback_data: `sellPercent:50:${mint}` },
        { text: "💰 Sell 100%", callback_data: `sellPercent:100:${mint}` },
      ],
      [
        { text: "✏️ Enter custom amount", callback_data: `sell:manualAmount:${mint}` }
      ],
      [{ text: "❌ Cancel", callback_data: "home" }],
    ],
  },
});
}

// Fallback: manual mint paste entry
if (data === "sell:manual") {
  sessions[chatId] = { step: "awaitingToken", command: "sell" };
  return bot.sendMessage(chatId, "🪙 Paste the token mint to sell:");
}

        // Handle DCA Add
        if (data === "dca:add") {
          const handleCreateDca = require("./commandHandlers/handleCreateDca");
          return handleCreateDca(bot, query.message);
        }
        
        if (data === "dca:remove") {
          const handleCancelDca = require("./commandHandlers/handleCancelDca");
          return handleCancelDca(bot, query.message);
        }

        if (data.startsWith("sell:manualAmount:")) {
          const mint = data.split(":")[2];
          sessions[chatId] = { step: "awaitingManualSellAmount", command: "sell", token: mint };
        
          const { getCurrentWallet } = require("../services/utils/wallet/walletManager");
          const { getTokenAccountsAndInfo } = require("../utils/tokenAccounts");
        
          try {
            const wallet = getCurrentWallet();
            const accounts = await getTokenAccountsAndInfo(wallet.publicKey);
            const token = accounts.find(t => t.mint === mint);
        
            const name = token?.name?.replace(/[^\x20-\x7E]/g, "") || mint.slice(0, 4) + "..." + mint.slice(-4);
            const balance = token?.amount?.toFixed(4) || "0";
        
            return bot.sendMessage(chatId, `🪙 Enter how much *${name}* to sell:\n📊 Balance: *${balance}*\n_(e.g., 13.23)_`, {
              parse_mode: "Markdown"
            });
          } catch (err) {
            console.warn("⚠️ Failed to fetch token info:", err.message);
            return bot.sendMessage(chatId, `🪙 Enter how much to sell for \`${mint}\`:\n(e.g., 13.23)`, {
              parse_mode: "Markdown"
            });
          }
        }



        if (
          data === "tpSl:deleteMenu" ||
          data === "confirmDeleteSelected" ||
          data === "cancelDeleteTpSl" ||
          data === "clearAllTpSl" || 
          data.startsWith("toggleDelete:")
        ) {
          return handleTpSlDelete(bot, query);
        }
        
        if (data === "tpSl:editMenu") {
          return handleTpSlEdit(bot, query.message);
        }
        

        if (data === "tpSl:add") {
          sessions[chatId] = { step: "awaitingTpSlMint" };
          return bot.sendMessage(chatId, "🪙 Paste the *token mint* you want to configure TP/SL for:", {
            parse_mode: "Markdown",
          });
        }
        

        
  if (data === "tpSl:clear") {
    const all = loadSettings();
    delete all[chatId];
    saveSettings(all);
    return bot.sendMessage(chatId, "🧹 TP/SL settings cleared.");
  }

  if (data.startsWith("tpSl:toggle:")) {
    const mint = data.split(":")[2];
    const all = loadSettings();
    const userConfig = all[chatId] = all[chatId] || {};
    const current = userConfig[mint];
  
    if (!current) {
      return bot.sendMessage(chatId, "⚠️ No TP/SL config found for this token.");
    }
    current.enabled = !current.enabled;
    saveSettings(all);
  
    bot.answerCallbackQuery(query.id, {
      text: current.enabled ? "✅ TP/SL Enabled" : "🚫 TP/SL Disabled",
      show_alert: false,
    });


    // Reload the position manager to reflect change
    return handleManage(bot, { chat: { id: chatId } }, mint);
  }

      // Handle Edit TP/SL button
      if (data && data.startsWith("tpSl:edit:")) {
        const mint = data.split(":")[2];
        sessions[chatId] = { step: "awaitingTpSlEdit", mint };
        return bot.sendMessage(chatId, `✏️ Send new TP/SL values for \`${mint}\` in the format:\n\n*25 15*`, {
          parse_mode: "Markdown",
        });
      }
  
      // Handle Delete TP/SL button
      if (data.startsWith("tpSl:delete:")) {
        const mint = data.split(":")[2];
        const all = loadSettings();
  
        if (all[chatId]?.[mint]) {
          delete all[chatId][mint];
          if (Object.keys(all[chatId]).length === 0) delete all[chatId];
          saveSettings(all);
  
          await bot.sendMessage(chatId, `🗑️ TP/SL config for \`${mint}\` deleted.`, {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Back to TP/SL", callback_data: "tpsl" }]],
            },
          });
        } else {
          await bot.sendMessage(chatId, `❌ No TP/SL config found for \`${mint}\`.`, {
            parse_mode: "Markdown",
          });
        }
        return;
      }
      
  


  if (data.startsWith("manage:")) {
    const mint = data.split(":")[1];
    return handleManage(bot, { chat: { id: chatId } }, mint);
  }

  if (data.startsWith("buyAgain:")) {
    const mint = data.split(":")[1];
    sessions[chatId] = { step: "awaitingAmount", command: "buy", token: mint };
    rememberMint(chatId, mint);
    return bot.sendMessage(chatId, `💰 How much SOL to buy \`${mint}\`?`, { parse_mode: "Markdown" });
  }

  if (data.startsWith("swap:")) {
    const mint = data.split(":")[1];
    if (!mint) return bot.sendMessage(chatId, "❌ Invalid mint.");
  
    sessions[chatId] = { step: "awaitingAmount", command: "swap", token: mint };
    rememberMint(chatId, mint);
    return bot.sendMessage(chatId, `💱 How much SOL to swap for \`${mint}\`?`, { parse_mode: "Markdown" });
  }

  if (data.startsWith("limit:delete:")) {
    const index = parseInt(data.split(":")[2]);
    const orders = await getUserLimitOrders(chatId);
    const order = orders[index];
    if (!order) {
      return bot.sendMessage(chatId, "❌ Could not find that limit order.");
    }
  
    await removeUserLimitOrder(chatId, index);
  
    await sendBotAlert(
      chatId,
      `🗑 *Limit Order Cancelled*\n\n` +
      `• Token: \`${order.token}\`\n` +
      `• Side: ${order.side.toUpperCase()}\n` +
      `• Price: $${order.price}\n` +
      `• Amount: ${order.amount} USDC`,
      "Limit"
    );
  
    return bot.sendMessage(chatId, `🗑 Removed limit order for \`${order.token}\` at ${order.price}`, {
      parse_mode: "Markdown"
    });
  }
  

  if (data.startsWith("dca:delete:")) {
    const index = parseInt(data.split(":")[2]);
    const orders = await getUserDcaOrders(chatId);
    const order = orders[index];
    if (!order) {
      return bot.sendMessage(chatId, "❌ Could not find that DCA order.");
    }
  
    await removeUserDcaOrder(chatId, index);
  
    await sendBotAlert(
      chatId,
      `🗑 *DCA Order Cancelled*\n\n` +
      `• Token: \`${order.tokenMint}\`\n` +
      `• Total Buys: ${order.totalBuys}\n` +
      `• Frequency: ${order.frequency}h\n` +
      `• Amount per Buy: ${order.amountPerBuy.toFixed(4)} ${order.baseMint === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" ? "USDC" : "SOL"}`,
      "DCA"
    );
  
    return bot.sendMessage(chatId, `🗑 Removed DCA order for \`${order.tokenMint}\`.`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
      }
    });
  }

  
  if (data === "positions:next") {
    const current = sessions[chatId]?.positionsPage ?? 0;
    return handlePositions(bot, { chat: { id: chatId } }, current + 1);
  }

  if (data === "positions:prev") {
    const current = sessions[chatId]?.positionsPage ?? 0;
    return handlePositions(bot, { chat: { id: chatId } }, Math.max(0, current - 1));
  }

  if (data === "trades:next") {
    const current = sessions[chatId]?.tradesPage ?? 0;
    const next = current + 1;
    sessions[chatId] = { ...sessions[chatId], tradesPage: next };
    return handleTrades(bot, { chat: { id: chatId } }, next);
  }
  
  if (data === "trades:prev") {
    const current = sessions[chatId]?.tradesPage ?? 0;
    const prev = Math.max(0, current - 1);
    sessions[chatId] = { ...sessions[chatId], tradesPage: prev };
    return handleTrades(bot, { chat: { id: chatId } }, prev);
  }

  if (data === "convert:solToUsdc") {
    return handleConvert(bot, query.message, "solToUsdc");
  }
  
  if (data === "convert:usdcToSol") {
    return handleConvert(bot, query.message, "usdcToSol");
  }
  


  if (data === "home") {
    return handleMenu(bot, { chat: { id: chatId } });
  }

  if (data.startsWith("hide:")) {
    const mint = data.split(":")[1];
    const session = sessions[chatId] ?? (sessions[chatId] = {});
    session.hiddenTokens = session.hiddenTokens || [];
    if (!session.hiddenTokens.includes(mint)) {
      session.hiddenTokens.push(mint);
    }
    return bot.sendMessage(chatId, `🙈 Token \`${mint}\` has been hidden.`, { parse_mode: "Markdown" });
  }

  if (data === "unhide") {
    sessions[chatId].hiddenTokens = [];
    return handlePositions(bot, { chat: { id: chatId } }, 0);
  }

    // --- Alert preference logic ---
    if (data === "toggle:alertsEnabled") {
        const prefs = getTelegramPrefs(chatId);
        const updatedPrefs = { ...prefs, enabled: !prefs.enabled };
        setTelegramPrefs(chatId, updatedPrefs);
    
        bot.answerCallbackQuery(query.id, {
          text: updatedPrefs.enabled ? "✅ Alerts Enabled" : "❌ Alerts Disabled",
          show_alert: false,
        });
    
        return handleAlerts(bot, query.message);
      }
    
      if (data === "setAlertTarget") {
        sessions[chatId] = { ...(sessions[chatId] || {}), awaitingAlertTarget: true };
    
        return bot.sendMessage(chatId, "✏️ Please send the new alert destination (e.g., `@channel` or chat ID):", {
          parse_mode: "Markdown",
        });
      }
    
      if (data === "manageAlertTypes") {
        const prefs = getTelegramPrefs(chatId);
        const current = prefs.types || [];
        const allTypes = ["Buy", "Sell", "DCA", "Limit"]; // ✅ include "Limit"
        const buttons = allTypes.map((type) => [
          {
            text: current.includes(type) ? `✅ ${type}` : `❌ ${type}`,
            callback_data: `toggleAlertType:${type}`,
          },
        ]);
        buttons.push([{ text: "🔙 Back", callback_data: "alerts" }]);
    
        return bot.sendMessage(chatId, "🛠 *Manage Alert Types*\nTap to toggle each type:", {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: buttons,
          },
        });
      }
    
      if (data.startsWith("toggleAlertType:")) {
        const type = data.split(":")[1];
        const prefs = getTelegramPrefs(chatId);
        let current = prefs.types || [];
    
        if (current.includes(type)) {
          current = current.filter((t) => t !== type);
        } else {
          current.push(type);
        }
    
        setTelegramPrefs(chatId, { types: current });
    
        bot.answerCallbackQuery(query.id, {
          text: `${type} alerts ${current.includes(type) ? "enabled" : "disabled"}`,
          show_alert: false,
        });
    
        return bot.emit("callback_query", {
          id: query.id,
          data: "manageAlertTypes",
          message: query.message,
        });
      }
    
      if (data === "alerts") {
        return handleAlerts(bot, query.message);
      }

      // --- AUTO BUY TOGGLE ---
      if (data === "toggle:autoBuyEnabled") {
        const prefs = await getUserPreferences(chatId);
        prefs.autoBuy = prefs.autoBuy || {};
        prefs.autoBuy.enabled = !prefs.autoBuy.enabled;
        await setUserPreferences(chatId, prefs);

        bot.answerCallbackQuery(query.id, {
          text: `Auto Buy is now ${prefs.autoBuy.enabled ? "ON ✅" : "OFF ❌"}`,
          show_alert: false,
        });

        return handleSettings(bot, query.message);
      }

      // --- AUTO BUY AMOUNT EDIT ---
      if (data === "edit:autoBuyAmount") {
        sessions[chatId] = { step: "awaitingAutoBuyAmount" };
        return bot.sendMessage(chatId, "✏️ Enter new Auto Buy amount (in SOL):");
      }
      
      // 🧠 User preference toggles (VIA settings tab)
      if (data.startsWith("toggle:")) {
        const key = data.split(":")[1];
        const allowed = ["tpSlEnabled", "safeMode", "confirmBeforeTrade", "alertsEnabled"];
      
        if (!allowed.includes(key)) {
          return bot.sendMessage(chatId, "❌ Unknown setting toggle.");
        }
      
        const prefs = await getUserPreferences(chatId);
        const updatedValue = !prefs[key];
      
        await setUserPreferences(chatId, { [key]: updatedValue });
      
        bot.answerCallbackQuery(query.id, {
          text: `${key} is now ${updatedValue ? "ON ✅" : "OFF ❌"}`,
          show_alert: false,
        });
      
        return handleSettings(bot, query.message); // refresh UI
      }


      // --- SLIPPAGE EDIT ---
      if (data === "edit:slippage") {
        sessions[chatId] = { step: "awaitingSlippage" };
        return bot.sendMessage(chatId, "✏️ Enter slippage % (e.g., `0.5` or `1.0`):", {
          parse_mode: "Markdown",
        });
      }

      
      // }
      // if (data.startsWith("quickSell:")) {
      //   const mint = data.split(":")[1];
      //   const chatId = query.message.chat.id;
      //   const msg = query.message;
      
      //   return require("./commandHandlers/handleSell")(bot, msg, mint, "quick"); // ✅
      // }
      
      // if (data.startsWith("quickBuy:")) {
      //   const mint = data.split(":")[1];
      //   const chatId = query.message.chat.id;
      //   const msg = query.message; // ✅ same fix here
      
      //   const { getUserPreferences } = require("./services/userPrefs");
      //   const prefs = await getUserPreferences(chatId);
      //   const autoBuyAmount = prefs.autoBuy?.amount || 1;
      
      //   return require("./commandHandlers/handleBuy")(bot, msg, mint, autoBuyAmount);
      // }
  
  

  // Fallbacks
  switch (data) {
    case "buy": return handleBuy(bot, { chat: { id: chatId } });
    case "sell": return handleSell(bot, { chat: { id: chatId } });
    case "wallet": return handleWallet(bot, { chat: { id: chatId } });
    case "positions": return handlePositions(bot, { chat: { id: chatId } });
    case "safety": return handleSafety(bot, { chat: { id: chatId } });
    case "settings": return handleSettings(bot, { chat: { id: chatId } });
    case "alerts": return handleAlerts(bot, { chat: { id: chatId } });
    case "manage": return handleManage(bot, { chat: { id: chatId } });
    case "refer": return handleRefer(bot, { chat: { id: chatId } });
    case "trades": return handleTrades(bot, { chat: { id: chatId } });
    case "dca": return handleDca(bot, { chat: { id: chatId } });
    case "limits": return handleLimits(bot, { chat: { id: chatId } });
    case "tpsl": return handleTpSl(bot, { chat: { id: chatId } }); // ✅ ADD THIS

      
      default: return bot.sendMessage(chatId, "❌ Unknown action.");
    }
    
};
