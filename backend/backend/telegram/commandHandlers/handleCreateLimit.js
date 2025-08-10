const fs = require("fs");
const path = require("path");
const LIMITS_PATH = path.join(__dirname, "../../telegram/data/limit-orders.json");
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function readLimitOrders() {
  if (!fs.existsSync(LIMITS_PATH)) return {};
  return JSON.parse(fs.readFileSync(LIMITS_PATH, "utf8"));
}

function writeLimitOrders(data) {
  fs.writeFileSync(LIMITS_PATH, JSON.stringify(data, null, 2));
}

module.exports = async function handleCreateLimit(bot, msg) {
  const chatId = msg.chat.id;

  // 🧹 Clean up previous listeners to avoid double fire
  bot.removeAllListeners("message");

  const helpMessage = [
    "📝 *USDC-based limit orders only!*",
    "",
    "Format:",
    "`[buy|sell] [TOKEN_MINT] [amount in USDC] [target price in USDC]`",
    "",
    "Example:",
    "`buy 7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr 5 0.47`",
    "",
    "🔍 *Token Search:*",
    "[Birdeye](https://birdeye.so) | [DEX Screener](https://dexscreener.com/solana)"
  ].join("\n");

  await bot.sendMessage(chatId, helpMessage, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[{ text: "🔙 Cancel Limit", callback_data: "home" }]]
    }
  });

  const listener = async (msg2) => {
    if (msg2.chat.id !== chatId) return;

    const text = msg2.text.trim();
    const [side, token, amount, price] = text.split(" ");
    bot.removeListener("message", listener);

    if (!["buy", "sell"].includes(side) || !token || isNaN(amount) || isNaN(price)) {
      return bot.sendMessage(chatId, "❌ Invalid format. Please try again.", {
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
        }
      });
    }

    if (token === USDC_MINT) {
      return bot.sendMessage(chatId, "❌ You can't set a limit order *on* USDC.", {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
        }
      });
    }

    const orders = readLimitOrders();
    if (!orders[chatId]) orders[chatId] = [];

    orders[chatId].push({
      side,
      token,
      amount: parseFloat(amount),
      price: parseFloat(price),
      createdAt: Date.now()
    });

    writeLimitOrders(orders);

    await bot.sendMessage(chatId, `✅ Limit ${side.toUpperCase()} order added!\n\nToken: \`${token}\`\nAmount: ${amount} USDC\nTarget Price: $${price}`, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "🔙 Back to Menu", callback_data: "home" }]]
      }
    });
  };

  bot.on("message", listener);
};