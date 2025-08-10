const path = require("path");
const fs = require("fs");

const PREFS_FILE = path.join(__dirname, "../../data/telegramPrefs.json");

// Load preferences from file
function loadPrefs() {
  try {
    if (!fs.existsSync(PREFS_FILE)) return {};
    const raw = fs.readFileSync(PREFS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    // if the file was accidentally an array → reset to object
    return typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.error("Failed to load Telegram preferences:", err);
    return {};
  }
}

// Save preferences to file
function savePrefs(prefs) {
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
  } catch (err) {
    console.error("Failed to save Telegram preferences:", err);
  }
}

// Get preferences for a specific chat ID
function getTelegramPrefs(chatId) {
  const prefs = loadPrefs();
  const isTGid = /^[1-9]\d{8,10}$/.test(String(chatId));

  // never create a record for non-numeric ids
  if (!isTGid) return prefs[chatId] ?? { enabled: false, target: null, types: ["Buy", "Sell", "DCA", "Limit", "TP", "SL"
    , "Breakout", "Sniper", "ChadMode", "DipBuyer", 
          "Delayed Sniper", "TrendFollower", "RotationBot", "PaperTrader", "Rebalancer" 
  ] };

  if (!prefs[chatId]) {
  prefs[chatId] = {
    enabled : true,
    target  : Number(chatId),
    types   : [
      "Buy", "Sell", "DCA", "Limit", "TP", "SL",
      "Breakout", "Sniper", "Scalper", "ChadMode", "DipBuyer",
      "DelayedSniper", "TrendFollower", "RotationBot", "PaperTrader", "Rebalancer", "StealthBot"
    ],
  };
  savePrefs(prefs);
}
  return prefs[chatId];
}

// Set/update preferences for a chat ID
function setTelegramPrefs(chatId, newPrefs) {
  const prefs = loadPrefs();
  prefs[chatId] = { ...(prefs[chatId] || {}), ...newPrefs };
  savePrefs(prefs);
}

module.exports = {
  getTelegramPrefs,
  setTelegramPrefs,
};
