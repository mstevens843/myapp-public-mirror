// handleSafety.js - Telegram handler for /safety command or inline safety check
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { sessions, rememberMint } = require("../utils/sessions");
const { isSafeToBuyDetailed } = require("../../services/utils/safety/safetyCheckers/botIsSafeToBuy");

module.exports = async function handleSafety(bot, msg, mint = null) {
  const chatId = msg.chat.id;

  // Prompt user if no mint provided
  if (!mint) {
    sessions[chatId] = { step: "awaitingToken", command: "safety" };

    const mintButtons = (sessions[chatId].recentMints || []).map(m => ({
      text: m.length > 6 ? m.slice(0, 4) + "…" + m.slice(-4) : m,
      callback_data: `selectMint:${m}`,
    }));

    return bot.sendMessage(chatId, "🛡️ *Choose a token mint to run safety check:*", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          ...mintButtons.map(b => [b]),
          [{ text: "🛡️ Paste Safety", callback_data: "pasteNewSafety" }]
        ],
      },
    });
  }

  // Run safety logic
  try {
    const result = await isSafeToBuyDetailed(mint);

    let reply = `🛡️ *Safety Check Result:*\nPassed: ${result.passed ? "✅ Yes" : "❌ No"}\n\n*Breakdown:*\n`;

    for (const [key, value] of Object.entries(result.breakdown || {})) {
      const passed = typeof value === "object" ? value.passed : value;
      const reason = value?.error ? ` - ${value.error}` : "";
      reply += `• ${key}: ${passed ? "✅" : "❌"}${reason}\n`;
    }

    await bot.sendMessage(chatId, reply.trim(), { parse_mode: "Markdown" });

  } catch (err) {
    await bot.sendMessage(chatId, `❌ Safety check failed: ${err.message}`);
  }

  const buttons = [
    [{ text: "🔙 Back to Menu", callback_data: "home" }],
  ];
  
  await bot.sendMessage(chatId, `ℹ️ Done. What next?`, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: buttons
    }
  });
  
  

  rememberMint(chatId, mint);
  delete sessions[chatId];
};



// ✅ You Now Have:
// Recent token memory for every user

// Dynamic inline buttons on /buy, /sell, and /safety

// Toggle between saved mints and manual paste