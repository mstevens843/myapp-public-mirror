// require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
// const axios = require("axios");
// const fs = require("fs");
// const path = require("path");

// const { getTokenPrice, getTokenBalanceRaw } = require("../../utils/marketData");
// const { getTokenAccountsAndInfo } = require("../../utils/tokenAccounts");
// const { getCurrentWallet } = require("../../services/utils/wallet/walletManager"); 
// const { sendBotAlert } = require("../botAlerts"); 
// const { loadSettings, saveSettings } = require("../utils/tpSlStorage");
// const { getMintDecimals } = require("../../utils/tokenAccounts");
// const { getBirdeyeDefiPrice } = require("../../utils/birdeye"); 


// const API_BASE = process.env.API_BASE || "http://localhost:5001";

// async function monitorTpSl() {
//   const wallet = getCurrentWallet();
//   const settings = loadSettings();
//   const tokenAccounts = await getTokenAccountsAndInfo(wallet.publicKey);
//   const tokenMap = Object.fromEntries(tokenAccounts.map(t => [t.mint, t.amount]));

//   for (const chatId in settings) {
//     for (const mint in settings[chatId]) {
//       const config = settings[chatId][mint];
//       if (!config.enabled || !config.entryPrice) continue;


//       const stats = await getBirdeyeDefiPrice(mint);
//       const currentPrice = stats?.price;
//       if (!currentPrice) continue;

//       const { tp, sl, entryPrice } = config;
//       const changePct = ((currentPrice - entryPrice) / entryPrice) * 100;

//       // Trigger check
//       if (changePct >= tp || changePct <= -sl) {
//         const amount = tokenMap[mint];
//         if (!amount || amount <= 0) continue;

//         // const decimals = 6; // ⬅️ or fetch from getMintDecimals() for better accuracy
//         const rawAmount = await getTokenBalanceRaw(wallet.publicKey, mint);
//         const decimals = await getMintDecimals(mint);
//         const uiAmount = Number(rawAmount) / 10 ** decimals;

//         try {
//           const res = await axios.post(`${API_BASE}/api/manual/sell`, {
//             mint,
//             amount: uiAmount,
//             strategy: "tp-sl",            // ✅ REQUIRED to sell correct ro
//             walletLabel: "default",
//             slippage: 0.5,
//             force: true,
//           });

//           const {
//             tx,
//             entryPrice: exitEntryPrice,
//             entryPriceUSD,
//             usdValue
//           } = res.data.result || {};          
//           if (!tx) throw new Error("Sell failed, no transaction returned.");

//           const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
//           const isTp = changePct >= tp;
//           const direction = isTp
//             ? `✅ TP Hit (+${changePct.toFixed(2)}%)`
//             : `🔻 SL Hit (${changePct.toFixed(2)}%)`;
          
//           const alertType = isTp ? "TP" : "SL"; // ✅ This will match the prefs list
          
//           await sendBotAlert(chatId,
//             `🎯 *${alertType} Triggered!*\n\n` +
//             `• Token: \`${mint}\`\n` +
//             `• Entry: $${entryPrice}\n` +
//             `• Current: $${currentPrice.toFixed(4)}\n` +
//             `• Status: ${direction}\n` +
//             (entryPriceUSD ? `• Entry Price (USD): $${entryPriceUSD.toFixed(4)}\n` : "") +
//             (usdValue ? `• USD Value: $${usdValue.toFixed(2)}\n` : "") +
//             `[View Transaction](${explorer})`,
//             alertType
//           );

//           // Disable this TP/SL config
//           settings[chatId][mint].enabled = false;
//           saveSettings(settings);
//           console.log(`✅ TP/SL triggered for ${mint} at ${currentPrice.toFixed(4)} — tx: ${tx}`);
//         } catch (err) {
//           const errorMsg = err?.response?.data?.error || err.message;
//           console.error(`❌ Failed to execute TP/SL for ${mint}:`, errorMsg);
//           await sendBotAlert(chatId,
//             `❌ TP/SL Sell failed for \`${mint}\`\nError: ${errorMsg}`,
//             "TP/SL"
//           );
//         }
//       }
//     }
//   }
// }

// module.exports = { monitorTpSl };

// // 🔁 Start as interval runner
// if (require.main === module) {
//   setInterval(monitorTpSl, 60_000); // every 60s
// }
