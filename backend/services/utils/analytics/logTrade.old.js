// // utils/logTrade.js

// /**
//  * Analytics Logger Module
//  * - Records trade events with metadata for tracking performance
//  * - Logs per-strategy files *and* a global closed-trades file
//  *
//  * When a position is fully closed (token ➜ SOL), the entry is duplicated
//  * to logs/closed-trades.json so the daily-recap route can read one source.
//  */

// const fs    = require("fs");
// const path  = require("path");
// const axios = require("axios");

// const LOG_DIR = path.join(__dirname, "../../../logs");
// const CACHE_PATH = path.join(__dirname, "../../../data/token-name-cache.json");
// const CLOSED_TRADES_FILE = path.join(LOG_DIR, "closed-trades.json");
// const SOL_MINT           = "So11111111111111111111111111111111111111112"; // wrapped SOL

// // ────────── helpers ────────────────────────────────────────────────
// function loadNameCache() {
//   if (!fs.existsSync(CACHE_PATH)) fs.writeFileSync(CACHE_PATH, "{}");
//   try   { return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")); }
//   catch { return {}; }
// }

// fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
// function saveNameCache(cache) {
//   fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
// }


// async function getTokenName(mint) {
//   const cache = loadNameCache();
//   if (cache[mint]) return cache[mint];

//   try {
//     const { data } = await axios.get(
//       `https://public-api.birdeye.so/public/token/${mint}`,
//       { headers: { "X-API-KEY": process.env.BIRDEYE_API_KEY } }
//     );
//     const name = data?.data?.name || "Unknown";
//     cache[mint] = name;
//     saveNameCache(cache);
//     return name;
//   } catch (err) {
//     console.warn(`⚠️ Could not fetch token name for ${mint}: ${err.message}`);
//     return "Unknown";
//   }
// }

// // ────────── main logger ────────────────────────────────────────────
// async function logTrade(data) {
//   const {
//     strategy = "unknown",
//     inputMint,
//     outputMint,
//     inAmount,
//     outAmount,
    
//     entryPrice = null,
//     entryPriceUSD = null,
//     exitPrice  = null,
//     exitPriceUSD  = null,  
//     priceImpact = null,
//     takeProfit  = null,
//     stopLoss    = null,
//     txHash      = null,
//     simulated   = false,
//     success     = false,
//     notes       = "",
//     walletLabel,
//     slippage,
//     decimals,
//     usdValue    = null,
//     spentSOL = null,
//     side        = data.side || data.type // normalize

//   } = data;

//   const timestamp = new Date().toISOString();

//   // Attempt to auto-detect side if still missing
//   const _side =
//     side ||
//     (inputMint === SOL_MINT ? "buy"
//       : outputMint === SOL_MINT ? "sell"
//       : "unknown");

//   const tokenMint = _side === "buy" ? outputMint : inputMint;
//   const tokenName = await getTokenName(tokenMint);

//   const gainLoss =
//     typeof entryPrice === "number" && typeof exitPrice === "number"
//       ? (((exitPrice - entryPrice) / entryPrice) * 100).toFixed(2) + "%"
//       : null;

//   const entry = {
//     timestamp,
//     strategy,
//     inputMint,
//     outputMint,
//     inAmount,
//     outAmount,
//     entryPrice,
//     entryPriceUSD, 
//     exitPrice,
//     exitPriceUSD,     
//     gainLoss,
//     takeProfit,
//     stopLoss,
//     priceImpact,
//     txHash,
//     simulated,
//     success,
//     notes,
//     walletLabel: walletLabel || null,
//     slippage: slippage || null,
//     decimals: decimals ?? null,
//     usdValue,
//     spentSOL, // ✅ ADDED HERE
//     tokenName,
//     side: _side
//   };

//   // ── Ensure directories/files exist ───────────────────────────────
//   if (!fs.existsSync(LOG_DIR))             fs.mkdirSync(LOG_DIR);
//   if (!fs.existsSync(CLOSED_TRADES_FILE))  fs.writeFileSync(CLOSED_TRADES_FILE, "[]");

//   const stratPath =
//     strategy === "manual"
//       ? path.join(LOG_DIR, "manual-trades.json")
//       : path.join(LOG_DIR, `${strategy}.json`);

//   if (!fs.existsSync(stratPath)) fs.writeFileSync(stratPath, "[]");

//   // ── Write to per-strategy log ────────────────────────────────────
//   try {
//     const arr = JSON.parse(fs.readFileSync(stratPath, "utf-8"));
//     arr.push(entry);
//     fs.writeFileSync(stratPath, JSON.stringify(arr, null, 2));
//     console.log(`📦 Logged${simulated ? " [SIM]" : ""} trade ➜ ${path.basename(stratPath)}`);
//   } catch (err) {
//     console.error(`❌ Logging error (${strategy}):`, err.message);
//   }

//   // ── ALSO append to closed-trades when position exits to SOL ──────
//   if (_side === "sell" && outputMint === SOL_MINT) {
//     try {
//       const closed = JSON.parse(fs.readFileSync(CLOSED_TRADES_FILE, "utf-8"));
//       closed.push(entry);
//       fs.writeFileSync(CLOSED_TRADES_FILE, JSON.stringify(closed, null, 2));
//       console.log("🔒 Added to closed-trades.json");
//     } catch (err) {
//       console.error("❌ Closed-trade logging failed:", err.message);
//     }
//   }

//   // ── Optional Telegram push ───────────────────────────────────────
//   try {
//     const { sendTelegramMessage } = require("../../../telegram/alerts");
//     if (!simulated && success) {
//       const short = (m) => `${m.slice(0, 4)}…${m.slice(-4)}`;
//       const msg = `
// ${_side === "buy" ? "🚀 *Buy Executed*" : "💰 *Sell Executed*"}
// ━━━━━━━━━━━━━━━━━━━━
// 📌 Strategy: *${strategy}*
// 🔁 ${short(inputMint)} → ${short(outputMint)}
// 💰 Entry: ${entryPrice ?? "N/A"} | Exit: ${exitPrice ?? "N/A"}
// ${gainLoss ? `📈 PnL: ${gainLoss}` : ""}
// 🔗 [Solscan](${`https://solscan.io/tx/${txHash}`})
//       `.trim();
//       sendTelegramMessage(msg);
//     }
//   } catch {/* no telegram installed */}
// }

// module.exports = { logTrade, getTokenName };



// // if we use import (sendAlert instead.) 
// // try {
// //   const { sendAlert } = require("../../../telegram/alert"); // unified alert module
// //   if (!simulated && success) {
// //     const short = (m) => `${m.slice(0, 4)}…${m.slice(-4)}`;
// //     const msg = `
// // ${_side === "buy" ? "🚀 *Buy Executed*" : "💰 *Sell Executed*"}
// // ━━━━━━━━━━━━━━━━━━━━
// // 📌 Strategy: *${strategy}*
// // 🔁 ${short(inputMint)} → ${short(outputMint)}
// // 💰 Entry: ${entryPrice ?? "N/A"} | Exit: ${exitPrice ?? "N/A"}
// // ${gainLoss ? `📈 PnL: ${gainLoss}` : ""}
// // 🔗 [Solscan](https://solscan.io/tx/${txHash})
// //     `.trim();

// //     const alertType = _side === "buy" ? "Buy" : "Sell";
// //     await sendAlert(chatId || "ui", msg, alertType);
// //   }
// // } catch {
// //   /* no telegram installed */
// // }
// // }