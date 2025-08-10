// handleManage.js - Telegram handler for managing TP/SL + sell options for a token
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { sessions } = require("../utils/sessions");
const { loadSettings } = require("../utils/tpSlStorage");

module.exports = async function handleManage(bot, msg, mintArg = null) {
  const chatId = msg.chat.id;
  const recentMints = sessions[chatId]?.recentMints || [];
  const mint = mintArg || recentMints[0];

  if (!mint) {
    return bot.sendMessage(chatId, "❌ No recent token found. Use /sell or /positions first.");
  }

  const all = loadSettings();
  const config = all?.[chatId]?.[mint];
  const enabled = config?.enabled ?? true;

  const tpSlText = config
    ? `🎯 TP: *${config.tp}%* / SL: *${config.sl}%*\nTP/SL Status: ${enabled ? "✅ Enabled" : "❌ Disabled"}`
    : `⚠️ No TP/SL set for this token`;

  const message = `
⚖️ *Manage Position*

Token: \`${mint}\`

${tpSlText}

Choose how much to sell:
`.trim();

  const buttons = [
    [
      { text: "Sell 25%", callback_data: `sellPercent:0.25:${mint}` },
      { text: "Sell 50%", callback_data: `sellPercent:0.5:${mint}` },
      { text: "Sell 100%", callback_data: `sellPercent:1:${mint}` },
    ],
  ];

  if (config) {
    buttons.push([
      { text: "✏️ Adjust TP/SL", callback_data: `tpSl:edit:${mint}` },
      { text: "🚫 Clear TP/SL", callback_data: `tpSl:clear:${mint}` },
    ]);
    buttons.push([
      {
        text: enabled ? "❌ Disable TP/SL" : "✅ Enable TP/SL",
        callback_data: `tpSl:toggle:${mint}`,
      },
    ]);
  } else {
    buttons.push([
      { text: "➕ Set TP/SL", callback_data: "tpSl:add" },
    ]);
  }

  buttons.push([{ text: "❌ Cancel", callback_data: "menu" }]);

  await bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: buttons },
  });
};
