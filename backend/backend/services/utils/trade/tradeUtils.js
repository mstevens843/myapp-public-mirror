const { logTrade } = require("../analytics/logTrade");
const { handleExitLogic } = require("./handleExitLogic");
const { sendAlert } = require("../../../telegram/alerts")

const axios = require("axios");

async function handleSuccessTrade({ tx, quote, mint, strategy, config, wallet }) {
  const entryPrice = quote.price || (Number(quote.inAmount) / Number(quote.outAmount));

  const solPrice = await getTokenPriceApp("So11111111111111111111111111111111111111112");
  const entryPriceUSD = solPrice ? entryPrice * solPrice : null;

  // 📊 Log trade
  logTrade({
    timestamp: new Date().toISOString(),
    strategy,
    inputMint: quote.inputMint,
    outputMint: mint,
    inAmount: quote.inAmount,
    outAmount: quote.outAmount,
    priceImpact: quote.priceImpactPct * 100,
    txHash: tx || null,
    success: !!tx,
    takeProfit: config.takeProfit,
    stopLoss: config.stopLoss,
  });

  // 📦 Save open trade
  try {
    await axios.post("http://localhost:3001/api/trades/open", {
      mint,
      entryPrice,
      entryPriceUSD, 
      inAmount: quote.inAmount,
      strategy,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.warn(`⚠️ Failed to sync open trade: ${err.message}`);
  }

  // 📢 Notify
  const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
  console.log(`✅ Trade Success: ${explorer}`);
  await sendAlert(chatId || "ui", `✅ *${strategy} Success*\n[TX](${explorer})`, "Buy");

  // 🧠 Exit logic
  await handleExitLogic({
    config,
    entryPrice,
    entryPriceUSD, // ✅ NEW
    mint,
    wallet,
  });
}

module.exports = { handleSuccessTrade };