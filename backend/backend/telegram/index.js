require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
if (process.env.START_TELEGRAM !== "true") {
  console.log("⏸️ Telegram bot startup skipped (START_TELEGRAM not true)");
  return;
}


const TelegramBot = require("node-telegram-bot-api");
const sessions = require("./utils/sessions");
const { getSwapQuote, executeSwap, loadKeypair } = require("../utils/swap"); 
const handleCallback = require("./handleCallback");
const fs = require("fs");
const path = require("path");
const TP_SL_FILE = path.join(__dirname, "./data/tp-sl-settings.json");
const { loadWalletsFromLabels } = require("../services/utils/wallet/walletManager"); 
const { monitorTpSlTelegram } = require("./services/monitorTpSlTelegram");
const { getBirdeyeDefiPrice } = require("../utils/birdeye");




const {
  handleBuy,
  handleSell,
  handleWallet,
  handlePositions,
  handleSafety,
  handleTrades,
  handleWatchlist,
  TakeProfitStopLoss,
  handleSettings,
  handleDca,
  handleCreateDca,
  handleCancelDca,
  handleTpSlDelete,
  handleTpSlEdit,
} = require("./commandHandlers");
const { startAutoRefresh, toggleAutoRefresh } = require("./utils/autoRefresh");
const { isAuthorized } = require("./utils/auth");
const { logAccess } = require("./utils/logger"); // add at the top
const { loadSettings, saveSettings } = require("./utils/tpSlStorage");
const { setTelegramPrefs }             = require("./utils/telegramPrefs");  
const { monitorLimitTg } = require("./services/monitorLimit.tg");
const { monitorDcaTg } = require("./services/monitorDca.Tg"); // if/when you create this

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

const isValidMintAddress = (text) =>
  typeof text === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text);


function startBackgroundJobs() {
  monitorLimitTg();
  monitorDcaTg();
  console.log("⏱ TP/SL monitor running...");
  monitorTpSlTelegram(); // ✅ add this
  startAutoRefresh(bot);
}

bot.on("polling_error", (error) => {
    console.error("❌ Polling error:", error.message || error.response?.body || error);
  });

  loadWalletsFromLabels(["default.txt"]);


  function rejectIfUnauthorized(bot, msg, command = "unknown") {
    const chatId = msg.chat.id;
    const user = msg.chat.username || chatId;
  
    if (!isAuthorized(chatId)) {
      console.warn(`⛔ Unauthorized attempt on /${command} by ${user}`);
      bot.sendMessage(chatId, "⛔ You're not authorized.");
      return true;
    }
    logAccess(user, command); // ✅ file log
    console.log(`📥 Authorized user: ${user} ran /${command}`);
    return false;
  }


// 🔌 Slash commands
bot.onText(/\/start/, (msg) => {
    console.log(`🚀 /start triggered by ${msg.chat.username || msg.chat.id}`);
    if (rejectIfUnauthorized(bot, msg, "start")) return;
     // 🆕 1-line “ensure prefs” (runs every /start, idempotent)
     setTelegramPrefs(msg.chat.id, {
       enabled: true,
       target: msg.chat.id,          // personal DM
       types: ["Buy", "Sell", "DCA", "Limit", "TP", "SL"],
     });
    
     bot.sendMessage(msg.chat.id, "🔔 Alerts enabled for this chat.");
     require("./commandHandlers/handleMenu")(bot, msg);
    });

bot.onText(/\/menu/, (msg) => {
    if (rejectIfUnauthorized(bot, msg, "start")) return;
  require("./commandHandlers/handleMenu")(bot, msg);
});


bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;
    const user = msg.chat.username || chatId;
  
    if (!isAuthorized(chatId)) return bot.sendMessage(chatId, "⛔ You're not authorized.");
    
    console.log(`🛑 /stop triggered by ${user}`);
    delete sessions[chatId]; // clear session state
    bot.sendMessage(chatId, "👋 Bot session ended. Type /start to begin again.");
  });

/**
 * ✅ 2. Stop the Whole Bot Process (From Code)
This isn’t common for users — but you can do it for dev/debug:
 */
  bot.onText(/\/shutdown/, (msg) => {
    if (!isAuthorized(msg.chat.id)) return;
    bot.sendMessage(msg.chat.id, "🛑 Shutting down bot...").then(() => {
      process.exit(0); // Ends Node.js process
    });
  });


// ✅ Match full /buy <TOKEN> <AMOUNT>
bot.onText(/\/buy\s+(\w+)\s+([\d.]+)/, (msg, match) => {
    const user = msg.chat.username || msg.chat.id;
    console.log(`💸 /buy ${match[1]} ${match[2]} by ${user}`);
  
    if (!isAuthorized(msg.chat.id)) return bot.sendMessage(msg.chat.id, "⛔ You're not authorized to use this bot.");
    const token = match[1];
    const amount = match[2];
    handleBuy(bot, msg, token, amount); // passes token & amount directly
  });


// bot.onText(/\/buy$/, (msg) => {
//   if (!isAuthorized(msg.chat.id)) return bot.sendMessage(msg.chat.id, "⛔ You're not authorized.");
//   handleBuy(bot, msg);
// });

bot.onText(/\/snipe(?: (.+))?/, (msg, match) => {
    if (rejectIfUnauthorized(bot, msg, "start")) return;
    const mintArg = match[1]?.trim();
    handleSnipe(bot, msg, mintArg);
  });



bot.onText(/\/sell\s+(\w+)\s+([\d.]+)/, (msg, match) => {
    if (rejectIfUnauthorized(bot, msg, "sell")) return;
  const token = match[1];
  const amount = match[2];
  handleSell(bot, msg, token, amount);
});


// bot.onText(/\/sell$/, (msg) => {
//   if (!isAuthorized(msg.chat.id)) return bot.sendMessage(msg.chat.id, "⛔ You're not authorized.");
//   handleSell(bot, msg);
// });


bot.onText(/\/tpsl/, (msg) => {
  if (rejectIfUnauthorized(bot, msg, "tpsl")) return;
  TakeProfitStopLoss(bot, msg);
});

bot.onText(/\/wallet/, (msg) => {
    console.log(`👛 /wallet command from ${msg.chat.username || msg.chat.id}`);
    if (rejectIfUnauthorized(bot, msg, "start")) return;
  handleWallet(bot, msg);
});

bot.onText(/\/positions/, (msg) => {
    if (rejectIfUnauthorized(bot, msg, "start")) return;
  handlePositions(bot, msg);
});

bot.onText(/\/safety/, (msg) => {
    if (rejectIfUnauthorized(bot, msg, "start")) return;
  handleSafety(bot, msg);
});

bot.onText(/\/trades/, (msg) => {
    if (rejectIfUnauthorized(bot, msg, "start")) return;
  handleTrades(bot, msg);
});

bot.onText(/\/watchlist(?: (.+))?/, (msg, match) => {
    if (rejectIfUnauthorized(bot, msg, "start")) return;
  const mint = match[1]?.trim();
  handleWatchlist(bot, msg, mint);
});

bot.onText(/\/unhide/, (msg) => {
  if (rejectIfUnauthorized(bot, msg, "unhide")) return;
  const chatId = msg.chat.id;
  const session = sessions[chatId];
  if (session && session.hiddenTokens?.length) {
    session.hiddenTokens = [];
    return bot.sendMessage(chatId, "✅ All hidden tokens have been restored to /positions.", {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
      }
    });
  }
  return bot.sendMessage(chatId, "ℹ️ No hidden tokens to unhide.", {
    reply_markup: {
      inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
    }
  });
});

bot.onText(/\/reset/, (msg) => {
  if (rejectIfUnauthorized(bot, msg, "reset")) return;
  const chatId = msg.chat.id;

  delete sessions[chatId]; // Clears all session data
  return bot.sendMessage(chatId, "✅ Session has been reset.", {
    reply_markup: {
      inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
    }
  });
});


bot.onText(/\/tpsl_delete/, (msg) => {
  handleTpSlDelete(bot, msg);
});

bot.onText(/\/tpsl_edit/, (msg) => {
  handleTpSlEdit(bot, msg);
});



  bot.onText(/\/forget/, (msg) => {
    if (rejectIfUnauthorized(bot, msg, "forget")) return;
    const chatId = msg.chat.id;
    if (sessions[chatId]) {
      sessions[chatId].recentMints = [];
      console.log(`🧹 [User ${chatId}] forgot token history`);
    }
    bot.sendMessage(chatId, "🧹 Your recent token history has been cleared.", {
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
      }
    });
  });


  startAutoRefresh(bot);

bot.onText(/\/autorefresh/, (msg) => {
  const chatId = msg.chat.id;
  const enabled = toggleAutoRefresh(chatId);
  bot.sendMessage(chatId, enabled ? "🔄 Auto-refresh enabled (every 60s)" : "🛑 Auto-refresh disabled.");
});
  

// 🔁 For session prompts like "awaitingToken"
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const session = sessions[chatId];
    const text = msg.text;
    const user = msg.chat.username || chatId;
  
    if (!session || !text || text.startsWith("/")) return;
  
    console.log(`📩 Message received from ${user}: ${text}`);
    console.log(`🧠 Session step: ${session.step}, Command: ${session.command}`);

    // ✅ Handle percent input for selling
    if (session.step === "awaitingSellPercent") {
      const percentInput = parseFloat(text);
      if (isNaN(percentInput) || percentInput <= 0 || percentInput > 100) {
        return bot.sendMessage(chatId, "❌ Please enter a valid number between 1 and 100.");
      }

      const percent = percentInput / 100;
      const token = session.mint;

      const handleSell = require("./commandHandlers/handleSell");
      return handleSell(bot, msg, token, percent);
    }
  
    if (session.step === "awaitingToken") {
      const mint = text.trim();
    
      // ✅ Reject if it's not a valid-looking Solana mint address
      if (!isValidMintAddress(mint)) {
        return bot.sendMessage(chatId, "❌ That doesn't look like a valid token mint. Please try again.");
      }
    
      session.token = mint;
    
      const { getUserPreferences } = require("./services/userPrefs");
      const prefs = await getUserPreferences(chatId);
    
      // ✅ Auto Buy intercept
      if (session.command === "buy" && prefs.autoBuy?.enabled && prefs.autoBuy.amount) {
        const { rememberMint } = require("./utils/sessions");
        rememberMint(chatId, mint);
        delete sessions[chatId];
        return handleBuy(bot, msg, mint, prefs.autoBuy.amount, "autobuy");
      }
    
      if (session.command === "buy" || session.command === "sell") {
        session.step = "awaitingAmount";
        return bot.sendMessage(chatId, `💰 How much SOL to ${session.command}?`);
      }
    
      if (session.command === "safety") {
        return handleSafety(bot, msg, mint);
      }
    
      if (session.command === "swap") {
        session.step = "awaitingAmount";
        return bot.sendMessage(chatId, `💱 How much SOL to swap for \`${mint}\`?`, {
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]],
          },
        });
      }
    }

    // 🧠 Awaiting DCA Token Mint
    if (session.step === "awaitingDcaToken") {
      session.token = text.trim();
      session.step = "awaitingDcaFrequency";
      return bot.sendMessage(chatId, "⏱ How often to buy (in hours)? E.g. `6`");
    }

    // 🧠 Awaiting DCA Frequency
    if (session.step === "awaitingDcaFrequency") {
      const freq = parseFloat(text);
      if (isNaN(freq) || freq <= 0) return bot.sendMessage(chatId, "❌ Invalid number. Try again.");
      session.frequency = freq;
      session.step = "awaitingDcaAmount";
      return bot.sendMessage(chatId, "💰 How much SOL to buy each time?");
    }

    // 🧠 Awaiting DCA Amount
    if (session.step === "awaitingDcaAmount") {
      const amt = parseFloat(text);
      if (isNaN(amt) || amt <= 0) return bot.sendMessage(chatId, "❌ Invalid amount. Try again.");

      const { token, frequency } = session;
      const { addUserDcaOrder } = require("./utils/dcaManager");
      await addUserDcaOrder(chatId, { token, frequency, amount: amt });

      delete sessions[chatId];
      return bot.sendMessage(chatId, `✅ DCA order added for ${token}: every ${frequency}h, ${amt} SOL.`, {
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
        }
      });
    }


          // ✅ Awaiting Auto Buy Amount (from settings)
          if (session.step === "awaitingAutoBuyAmount") {
            const input = parseFloat(text);
            if (isNaN(input) || input <= 0) {
              return bot.sendMessage(chatId, "❌ Invalid amount. Please enter a number like `0.05`.");
            }
      
            const { getUserPreferences, setUserPreferences } = require("./services/userPrefs");
            const prefs = await getUserPreferences(chatId);
            prefs.autoBuy = prefs.autoBuy || {};
            prefs.autoBuy.amount = input;
            await setUserPreferences(chatId, prefs);
      
            delete sessions[chatId];
      
            return bot.sendMessage(chatId, `✅ Auto Buy amount set to *${input} SOL*.`, {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]],
              },
            });
          }


          if (session.step === "awaitingSlippage") {
            const input = parseFloat(text);
            if (isNaN(input) || input <= 0 || input > 100) {
              return bot.sendMessage(chatId, "❌ Invalid slippage %. Enter a number between 0.1 and 100.");
            }
          
            const { getUserPreferences, setUserPreferences } = require("./services/userPrefs");
            const prefs = await getUserPreferences(chatId);
            prefs.slippage = input;
            await setUserPreferences(chatId, prefs);
          
            delete sessions[chatId];
          
            return bot.sendMessage(chatId, `✅ Slippage set to *${input}%*`, {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]],
              },
            });
          }
            

// Step 1: Add TP/SL
if (session.step === "awaitingTpSlMint") {
  session.tpSlMint = msg.text.trim();
  session.step = "awaitingTpPercent";
  return bot.sendMessage(chatId, "🎯 What % Take Profit? (e.g., `25` for 25%)");
}

if (session.step === "awaitingTpPercent") {
  const tp = parseFloat(msg.text.trim());
  if (isNaN(tp)) return bot.sendMessage(chatId, "❌ Invalid TP %. Try again.");
  session.tp = tp;
  session.step = "awaitingSlPercent";
  return bot.sendMessage(chatId, "🔻 What % Stop Loss? (e.g., `15` for 15%)");
}

if (session.step === "awaitingSlPercent") {
  const sl = parseFloat(msg.text.trim());
  if (isNaN(sl)) return bot.sendMessage(chatId, "❌ Invalid SL %. Try again.");

  const all = loadSettings();
  all[chatId] = all[chatId] || {};
  const stats = await getBirdeyeDefiPrice(session.tpSlMint);
  const entryPrice = stats?.price;
  
all[chatId][session.tpSlMint] = {
  tp: session.tp,
  sl,
  entryPrice,
  enabled: true,
};
  saveSettings(all);
  delete sessions[chatId];

  await bot.sendMessage(chatId, `✅ TP/SL set for \`${session.tpSlMint}\`\nTake profit: ${session.tp}%\nStop loss: ${sl}%`, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]],
    },
  });

  const { getUserPreferences } = require("./services/userPrefs");
  const prefs = await getUserPreferences(chatId);

  if (!prefs.tpSlEnabled) {
    await bot.sendMessage(chatId, "⚠️ *Heads up!*\nTP/SL is currently *OFF* in your settings.\nYour configuration was saved and will activate when TP/SL is enabled.", {
      parse_mode: "Markdown"
    });
  }

  return;
}

// Step 2: Edit TP/SL
if (session.step === "awaitingTpSlEdit") {
  const [tpStr, slStr] = msg.text.trim().split(" ");
  const tp = parseFloat(tpStr);
  const sl = parseFloat(slStr);
  const mint = session.mint;

  if (isNaN(tp) || isNaN(sl)) {
    return bot.sendMessage(chatId, "❌ Invalid format. Use: `25 15` for TP 25% and SL 15%", {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]],
      },
    });
  }

  const all = loadSettings();
  all[chatId] = all[chatId] || {};
  all[chatId][mint] = { ...all[chatId][mint], tp, sl };
  saveSettings(all);
  delete sessions[chatId];

  return bot.sendMessage(chatId, `✅ TP/SL for \`${mint}\` updated:\nTake profit: ${tp}%\nStop loss: ${sl}%`, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]],
    },
  });
}

// // Step 3: Handle Edit Button
// if (data.startsWith("tpSl:edit:")) {
//   const mint = data.split(":")[2];
//   sessions[chatId] = { step: "awaitingTpSlEdit", mint };
//   return bot.sendMessage(chatId, `✏️ Send new TP/SL values for \`${mint}\` in the format:\n\n*25 15*`, {
//     parse_mode: "Markdown",
//   });
// }

// // Step 4: Handle Delete Button
// if (data.startsWith("tpSl:delete:")) {
//   const mint = data.split(":")[2];
//   const all = loadSettings();

//   if (all[chatId]?.[mint]) {
//     delete all[chatId][mint];
//     if (Object.keys(all[chatId]).length === 0) delete all[chatId]; // clean up user object
//     saveSettings(all);

//     return bot.sendMessage(chatId, `🗑️ TP/SL config for \`${mint}\` deleted.`, {
//       parse_mode: "Markdown",
//       reply_markup: {
//         inline_keyboard: [[{ text: "🔙 Back to TP/SL", callback_data: "tpsl" }]],
//       },
//     });
//   } else {
//     return bot.sendMessage(chatId, `❌ No TP/SL config found for \`${mint}\`.`, {
//       parse_mode: "Markdown",
//     });
//   }
// }
  
    if (session.step === "awaitingAmount") {
      const amount = parseFloat(msg.text);
      if (isNaN(amount) || amount <= 0) {
        return bot.sendMessage(chatId, "❌ Invalid amount.");
      }
  
      if (session.command === "buy") return handleBuy(bot, msg, session.token, amount);
      if (session.command === "sell") return handleSell(bot, msg, session.token, amount);
  
      if (session.command === "swap") {
        const wallet = loadKeypair();
        const inputMint = "So11111111111111111111111111111111111111112"; // SOL
        const outputMint = session.token;
        const atomicAmount = Math.floor(amount * 1e9);
  
        const quote = await getSwapQuote({
          inputMint,
          outputMint,
          amount: atomicAmount,
          slippage: 1.0,
        });
  
        if (!quote) {
          return bot.sendMessage(chatId, "❌ No route found for this swap.");
        }
  
        const tx = await executeSwap({ quote, wallet });
  
        if (tx) {
          return bot.sendMessage(
            chatId,
            `✅ Swap complete!\n[View Transaction](https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta)`,
            { parse_mode: "Markdown" }
          );
        } else {
          return bot.sendMessage(chatId, "❌ Swap failed.", {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
            }
          });        }
      }
    }
    // 🧠 Awaiting manual sell float amount
    // 🧠 Awaiting manual sell float amount
    if (session.step === "awaitingManualSellAmount") {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) {
        return bot.sendMessage(chatId, "❌ Invalid amount. Please enter a number like `13.23`.");
      }
    
      const { performManualSellByAmount } = require("../services/manualExecutor");
      const mint = session.token;
    
      try {
        const result = await performManualSellByAmount(amount, mint, "default", 0.5);
        const explorer = `https://explorer.solana.com/tx/${result.tx}?cluster=mainnet-beta`;
    
        await bot.sendMessage(chatId, `✅ *Sell complete!*\n[TX Link](${explorer})`, {
          parse_mode: "Markdown",
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔙 Back to Menu", callback_data: "home" }]
            ]
          }
        });
      } catch (err) {
        console.error("❌ ManualSellByAmount error:", err.message);
        await bot.sendMessage(chatId, `❌ Sell failed: ${err.message}`);
      }
    
      delete sessions[chatId];
      return;
    }

    if (sessions[chatId]?.awaitingAlertTarget) {
        const target = msg.text.trim();
        setTelegramPrefs(chatId, { target });
        sessions[chatId].awaitingAlertTarget = false;
      
        bot.sendMessage(chatId, `✅ Alert target updated to *${target}*`, {
          parse_mode: "Markdown",
        });
      }
  });



  

// ✅ Inline buttons
bot.on("callback_query", (query) => {
    const msg = query.message;
    if (rejectIfUnauthorized(bot, msg, "callback")) return;
    handleCallback(bot, query);
  });


  startBackgroundJobs();

