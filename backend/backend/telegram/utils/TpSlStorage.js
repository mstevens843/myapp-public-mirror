// utils/tpSlStorage.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const fs   = require("fs");
const path = require("path");
const { getCachedPrice } = require("../../utils/priceCache.dynamic");  // ✅ updated

const TP_SL_FILE      = path.join(__dirname, "../../data/tp-sl-settings.json");
const OPEN_TRADES_FILE = path.join(__dirname, "../../logs/open-trades.json");

/* ------------------------------------------------------------------ */
/*  ensure settings file exists AND is an *object*, not an empty array */
/* ------------------------------------------------------------------ */
if (!fs.existsSync(TP_SL_FILE)) {
  fs.writeFileSync(TP_SL_FILE, "{}");
} else {
  const txt = fs.readFileSync(TP_SL_FILE, "utf8").trim();
  if (txt === "[]" || txt === "") fs.writeFileSync(TP_SL_FILE, "{}");
}

/* ------------ helpers exported to the rest of the app ------------- */
function loadSettings() {
  const raw = JSON.parse(fs.readFileSync(TP_SL_FILE, "utf8"));

  // add missing "enabled" flags (legacy data)
  for (const userId in raw) {
    for (const mint in raw[userId]) {
      if (raw[userId][mint].enabled === undefined) {
        raw[userId][mint].enabled = true;
      }
    }
  }
  return raw;
}

function saveSettings(data) {
  fs.writeFileSync(TP_SL_FILE, JSON.stringify(data, null, 2));
}

/* add / replace one entry, used by Telegram AND by the Web API */
async function addTpSlEntry(chatId, mint, tp, sl) {
  const all = loadSettings();
  all[chatId] = all[chatId] || {};

  /* try to grab the entry price from open-trades.json first */
  let entryPrice = null;
  try {
    const openTrades = JSON.parse(fs.readFileSync(OPEN_TRADES_FILE, "utf8"));
    const trade      = openTrades.find(t => t.mint === mint);
    if (trade?.entryPrice) entryPrice = trade.entryPrice;
  } catch { /* silent – just fallback to market */ }

    /* fetch cached price if still missing */
  if (!entryPrice) {
    try {
      const cached = await getCachedPrice(mint);
      if (cached) entryPrice = cached;
    } catch {}
  }

  all[chatId][mint] = { tp, sl, enabled: true, ...(entryPrice ? { entryPrice } : {}) };
  saveSettings(all);
  return all;
}

module.exports = { loadSettings, saveSettings, addTpSlEntry };
