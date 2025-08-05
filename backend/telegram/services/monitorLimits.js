// /*  monitorLimitOrders.js  */
// require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

// const { getTokenPrice }          = require("../../utils/marketData");
// const { getBirdeyeDefiPrice }    = require("../../utils/birdeye");
// const { sendBotAlert }           = require("../botAlerts");
// const { readLimitOrdersFile,
//         writeLimitOrdersFile }   = require("../utils/limitManager");
// const {
//   read : readWeb,
//   write: writeWeb,
//   mergeAndWrite,                // 👈 NEW – do not overwrite!

// } = require("../../services/utils/analytics/orderStorage");

// const { prepareBuyLogFields }    = require("../../services/utils/analytics/tradeFormatter");
// const { addOrUpdateOpenTrade }   = require("../../services/utils/analytics/openTrades");
// const { logTrade }               = require("../../services/utils/analytics/logTrade");

// const {
//   performManualBuy,
//   performManualSellByAmount      // sell-side helper
// } = require("../../services/manualExecutor");

// const sleep        = (ms) => new Promise(r => setTimeout(r, ms));
// const INTERVAL_MS  = 15_000;      // 15 s polling

// /* ——————————————————————————————————————————————— */
// async function monitorLimitOrders () {
//   console.log("📡  Starting Limit-Order monitor …");

//   setInterval(async () => {
//     /* pull bot-side & UI-side orders, merge them ------------- */
//     const allOrders   = readLimitOrdersFile();
//     const webOrders   = readWeb().filter(o => o.type === "limit" && o.status !== "deleted");

//     for (const o of webOrders) {
//       const uid = o.userId || "web";
//       allOrders[uid]  = allOrders[uid] || [];
//       if (!allOrders[uid].some(x => x.id === o.id)) allOrders[uid].push(o);
//     }

//     /* iterate users ------------------------------------------------ */
//     for (const [userId, orders] of Object.entries(allOrders)) {
//       const remainingOrders = [];

//       for (const order of orders) {
//         if (order.status === "done") {         // already executed
//           remainingOrders.push(order);
//           continue;
//         }

//         /* resolve target price ------------------------------------ */
//         if (order.targetPrice === undefined) order.targetPrice = order.price;
//         const target = +order.targetPrice;

//         /* live price w/ fallback ---------------------------------- */
//         let price = await getTokenPrice(order.token);
//         if (!price) {
//           const be = await getBirdeyeDefiPrice(order.token);
//           await sleep(300);
//           price = be?.price || 0;
//         }
//         if (!price) {                       // still no price
//           console.warn(`❌ No price for ${order.token}`);
//           remainingOrders.push(order);
//           continue;
//         }

//         /* check trigger ------------------------------------------- */
//         const hit = (order.side === "buy"  && price <= target) ||
//                     (order.side === "sell" && price >= target);
//         if (!hit) { remainingOrders.push(order); continue; }

//         /* --------------------------------------------------------- */
//         try {
//           /* BUY -------------------------- */
//           if (order.side === "buy") {
//             const res = await performManualBuy(
//               null,                       // amountInSOL
//               order.token,                // mint
//               "web",                      // chatId
//               order.walletLabel || "default",
//               1.0,                        // slippage
//               order.amount,               // amountInUSDC
//               "limit",                    // strategy
//               true                        // skipLog
//             );

//             const { tx, entryPrice, entryPriceUSD,
//                     usdValue, inAmount, outAmount } = res;
//             if (!tx) throw new Error("performManualBuy returned null tx");

//             /* log + alert */
//             await handleSuccess({
//               userId, order, tx, usdValue,
//               entryPrice, entryPriceUSD,
//               inAmount, outAmount, side: "buy"
//             });
//           }

//           /* SELL ------------------------ */
//           if (order.side === "sell") {
//             const res = await performManualSellByAmount(
//               order.amount,                  // amount of tokens to sell
//               order.token,
//               "limit",                       // ✅ strategy
//               "web",                         // chatId
//               order.walletLabel || "default",
//               1.0                            // slippage
//             );

//             const { tx } = res;
//             if (!tx) throw new Error("performManualSellByAmount returned null tx");

//             /* price math for alert (simple) ----------------------- */
//             const explorer  = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;
//             await sendBotAlert(
//               userId,
//               `✅ *Limit SELL Executed!*  \`${order.token}\`\n` +
//               `• Sold ${order.amount} tokens\n` +
//               `• Tx: [view ↗](${explorer})`,
//               "Limit"
//             );
//           }

//           /* mark & keep in list so UI can show “done” state */
//           order.status     = "done";
//           order.executedAt = new Date().toISOString();
//           remainingOrders.push(order);

//         } catch (err) {
//           /* ---------- failure path ---------- */
//           const msg = err.message || err;
//           console.error(`❌ Limit ${order.side} for ${order.token} failed:`, msg);
//           await sendBotAlert(
//             userId,
//             `❌ Limit ${order.side} failed for \`${order.token}\`:\n${msg}`,
//             "Limit"
//           );
//           order.failCount = (order.failCount || 0) + 1;
//           if (order.failCount < 10) remainingOrders.push(order);
//           else {
//             await sendBotAlert(userId,
//               `⚠️ Removed limit order for \`${order.token}\` after 10 failures.`,
//               "Limit"
//             );
//           }
//         }
//       } /* inner for-order */

//       allOrders[userId] = remainingOrders;
//     }   /* outer for-user  */

//     /* persist ----------------------------------------------------- */
//     writeLimitOrdersFile(allOrders);

//     const limitRows = Object.values(allOrders)
//                       .flat()
//                       .filter(o => o.status !== "deleted");

//     /* ADD - merge instead of blind overwrite */
//     mergeAndWrite(limitRows);
//   }, INTERVAL_MS);
// }


// /* helper: unify success logging / alert for BUY */
// async function handleSuccess ({
//   userId, order, tx, usdValue,
//   entryPrice, entryPriceUSD,
//   inAmount, outAmount, side
// }) {
//   const explorer = `https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`;

//   await sendBotAlert(
//     userId,
//     `✅ *Limit ${side.toUpperCase()} Executed!*  \`${order.token}\`\n` +
//     `• Amount: ${order.amount} ${side === "buy" ? "USDC" : "tokens"}\n` +
//     `• Price: ${entryPrice?.toFixed(6)} SOL / $${entryPriceUSD?.toFixed(4) || "?"}\n` +
//     (usdValue ? `• USD Value: $${usdValue.toFixed(2)}\n` : "") +
//     `• Tx: [view ↗](${explorer})`,
//     "Limit"
//   );

//   /* central analytics (BUY only) */
//   if (side === "buy") {
//     const logPayload = await prepareBuyLogFields({
//       strategy   : "limit",
//       inputMint  : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
//       outputMint : order.token,
//       inAmount,
//       outAmount,
//       walletLabel: order.walletLabel || "default",
//       slippage   : 1.0,
//       txHash     : tx,
//     });
//     await logTrade(logPayload);
//     await addOrUpdateOpenTrade({
//       mint         : order.token,
//       entryPrice   : logPayload.entryPrice,
//       entryPriceUSD: logPayload.entryPriceUSD,
//       inAmount,
//       outAmount,
//       strategy     : "limit",
//       walletLabel  : order.walletLabel || "default",
//       slippage     : 1.0,
//       decimals     : logPayload.decimals,
//       usdValue     : logPayload.usdValue,
//       txHash       : tx,
//       type         : "buy",
//     });
//   }
// }

// /* export ---------------------------------------------------------- */
// module.exports = { monitorLimitOrders };
