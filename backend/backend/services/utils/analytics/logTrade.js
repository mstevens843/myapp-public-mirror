// utils/analytics/logTrade.js
/* eslint-disable no-console */

/**
 * Analytics Logger
 * ──────────────────────────────────────────────────────────────
 * • Records every trade (per-strategy + global closed-trades)
 * • Adds numeric gainLossPct so recap math is trivial
 * • Caches token names (Birdeye) to keep UI readable
 */

const fs   = require("fs");
const path = require("path");
const axios = require("axios");
const { readJSONSafe } = require("./json"); // adjust relative path if needed


const LOG_DIR            = path.join(__dirname, "../../../logs");
const CACHE_PATH         = path.join(__dirname, "../../../data/token-name-cache.json");
const CLOSED_TRADES_FILE = path.join(LOG_DIR, "closed-trades.json");
const SOL_MINT           = "So11111111111111111111111111111111111111112";
const { getTokenName } = require("./getTokenName");


/* ────────── main logger ───────────────────────────────────── */

async function logTrade(raw) {
  const {
    strategy = "unknown",
    inputMint,
    outputMint,
    inAmount,
    outAmount,
    entryPrice       = null,
    entryPriceUSD    = null,
    exitPrice        = null,
    exitPriceUSD     = null,
    priceImpact      = null,
    takeProfit       = null,
    stopLoss         = null,
    txHash           = null,
    simulated        = false,
    success          = false,
    notes            = "",
    walletLabel,
    slippage,
    decimals,
    usdValue         = null,
    spentSOL         = null,
    side             = raw.side || raw.type, // normalise buy / sell
    partial          = raw.partial || false,
    triggerType = null,
  } = raw;

  const timestamp = new Date().toISOString();

  /* auto-detect side if caller omitted it */
  const _side =
    side ||
    (inputMint === SOL_MINT ? "buy"
      : outputMint === SOL_MINT ? "sell"
      : "unknown");

  const tokenMint = _side === "buy" ? outputMint : inputMint;
  const tokenName = await getTokenName(tokenMint);

  /* numeric % PnL (used by recap) */
  const gainLossPct =
    typeof entryPriceUSD === "number" && typeof exitPriceUSD === "number"
      ? ((exitPriceUSD - entryPriceUSD) / entryPriceUSD) * 100
      : null;

  /* pretty string form (Telegram / CSV) */
  const gainLoss =
    typeof gainLossPct === "number" ? gainLossPct.toFixed(2) + "%" : null;

  const entry = {
    timestamp,
    strategy,
    inputMint,
    outputMint,
    inAmount,
    outAmount,
    entryPrice,
    entryPriceUSD,
    exitPrice,
    exitPriceUSD,
    gainLossPct,  // numeric
    gainLoss,     // string
    takeProfit,
    stopLoss,
    priceImpact,
    txHash,
    simulated,
    success,
    notes,
    walletLabel : walletLabel || null,
    slippage    : slippage    ?? null,
    decimals    : decimals    ?? null,
    usdValue,
    spentSOL,
    tokenName,
    side        : _side,
    partial     : partial,
    triggerType,
  };

  /* ensure log dir / files exist */
  if (!fs.existsSync(LOG_DIR))            fs.mkdirSync(LOG_DIR);
  if (!fs.existsSync(CLOSED_TRADES_FILE)) fs.writeFileSync(CLOSED_TRADES_FILE, "[]");

  const stratFile =
    strategy === "manual"
      ? path.join(LOG_DIR, "manual-trades.json")
      : path.join(LOG_DIR, `${strategy}.json`);

  if (!fs.existsSync(stratFile)) fs.writeFileSync(stratFile, "[]");

  /* per-strategy log */
  const stratArr = JSON.parse(fs.readFileSync(stratFile, "utf-8"));
  stratArr.push(entry);
  fs.writeFileSync(stratFile, JSON.stringify(stratArr, null, 2));

  // const closed = readJSONSafe(CLOSED_TRADES_FILE);
  // if (entry.txHash && closed.some(t => t.txHash === entry.txHash)) {
  //   console.warn("⚠️ Duplicate closed trade skipped:", entry.txHash);
  //   return;
  // }

  /* append to closed-trades only if we’re NOT already there */
  if (_side === "sell" && outputMint === SOL_MINT) {
    try {
      const closed = JSON.parse(fs.readFileSync(CLOSED_TRADES_FILE, "utf-8"));

      /* 🚫 skip duplicates (same txHash) */
      if (entry.txHash && closed.some(t => t.txHash === entry.txHash)) {
        console.warn("⚠️  Duplicate closed trade skipped:", entry.txHash);
      } else {
        closed.push(entry);
        fs.writeFileSync(CLOSED_TRADES_FILE, JSON.stringify(closed, null, 2));
        console.log("🔒 Added to closed-trades.json");
      }
    } catch (err) {
      console.error("❌ Closed-trade logging failed:", err.message);
    }
  }
  
  /* Optional Telegram push (kept unchanged) */
  try {
    const { sendAlert } = require("../../../telegram/alert"); // ✅ new system
    if (!simulated && success) {
      const short = (m) => `${m.slice(0, 4)}…${m.slice(-4)}`;
      const msg = `
      ${_side === "buy"
        ? "🚀 *Buy Executed*"
        : partial
          ? "💸 *Partial Sell*"
          : "💰 *Sell Executed*"}
      ━━━━━━━━━━━━━━━━━━━━
      📌 Strategy: *${strategy}*
      🔁 ${short(inputMint)} → ${short(outputMint)}
      💰 Entry: ${entryPrice ?? "N/A"} | Exit: ${exitPrice ?? "N/A"}
      ${gainLoss ? `📈 PnL: ${gainLoss}` : ""}
      🔗 [Solscan](https://solscan.io/tx/${txHash})
      `.trim();
      await sendAlert(chatId || "ui", msg, _side === "buy" ? "Buy" : "Sell");
    }
  } catch {
    // telegram module not installed – ignore
  }
}

module.exports = { logTrade, getTokenName };