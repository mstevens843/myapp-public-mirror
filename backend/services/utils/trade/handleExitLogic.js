const { getTokenPrice, getTokenBalance, executeSwap } = require("../../../utils/swap");
const { logTrade } = require("../analytics/logTrade");
const { sendAlert } = require("../../../telegram/alerts")

const axios = require("axios");

async function handleExitLogic({ config, entryPrice, mint, wallet }) {
  const { takeProfit = 0, stopLoss = 0, inputMint } = config;
  if (!takeProfit && !stopLoss) return false;

  const currentPrice = await getTokenPrice(req.user.id, mint);
  if (!currentPrice || !entryPrice) return false;

  const change = ((currentPrice - entryPrice) / entryPrice) * 100;

  // 🟢 TAKE PROFIT
  if (takeProfit && change >= takeProfit) {
    console.log(`🏆 Take Profit triggered for ${mint} at +${change.toFixed(2)}%`);
    await logAndSell({ config, mint, wallet, reason: "Take Profit", currentPrice });
    return true;
  }

  // 🔻 STOP LOSS
  if (stopLoss && change <= -stopLoss) {
    console.log(`🛑 Stop Loss triggered for ${mint} at ${change.toFixed(2)}%`);
    await logAndSell({ config, mint, wallet, reason: "Stop Loss", currentPrice });
    return true;
  }

  return false;
}

async function logAndSell({ config, mint, wallet, reason, currentPrice }) {
  const walletAddress = wallet.publicKey;
  const fullBalance = await getTokenBalance(walletAddress, mint);

  const amountToSell = config.snipeAmount;

  const tx = await executeSwap({
    inputMint: mint,
    outputMint: config.inputMint,
    amount: amountToSell,
    slippage: config.slippage,
    wallet,
  });

  const success = !!tx;

  logTrade({
    timestamp: new Date().toISOString(),
    strategy: "sniper",
    inputMint: mint,
    outputMint: config.inputMint,
    entryPrice: null,
    exitPrice: currentPrice,
    success,
    notes: reason,
    txHash: tx,
  });

  await sendAlert(chatId || "ui", `${success ? "✅" : "❌"} *${reason}* for ${mint}\nCurrent: ${currentPrice.toFixed(4)}`, "Buy");

  if (!success) return;

  const percentSold = amountToSell / fullBalance;

  if (percentSold >= 0.98) {
    // ✅ Full sell
    try {
      await axios.delete(`http://localhost:3001/api/trades/open/${mint}`);
      console.log(`🧹 Removed ${mint} from open trades`);
    } catch (err) {
      console.warn(`⚠️ Failed to remove open trade: ${err.message}`);
    }
  } else {
    // ✍️ Partial sell
    try {
      await axios.patch(`http://localhost:3001/api/trades/open/${mint}`, {
        percent: percentSold,
      });
      console.log(`✏️ Updated open trade for ${mint} by ${Math.round(percentSold * 100)}%`);
    } catch (err) {
      console.warn(`⚠️ Failed to patch open trade: ${err.message}`);
    }
  }
}

module.exports = { handleExitLogic };
