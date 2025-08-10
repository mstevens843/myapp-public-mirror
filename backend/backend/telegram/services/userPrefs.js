const fs = require("fs");
const path = require("path");

const PREFS_FILE = path.join(__dirname, "../../data/userPrefs.json");

// ✅ Default settings per user
const defaultPrefs = {
  tpSlEnabled: true,
  safeMode: true,
  confirmBeforeTrade: true,
  alertsEnabled: true,
  autoBuy: {
    enabled: false,
    amount: 0.05, // Default to 0.05 SOL
  },
  slippage: 1.0, // ✅ Default slippage in percent

};

// 🔧 Load all prefs from disk
function loadAllPrefs() {
  try {
    if (!fs.existsSync(PREFS_FILE)) return {};
    const raw = fs.readFileSync(PREFS_FILE);
    return JSON.parse(raw);
  } catch (err) {
    console.error("❌ Failed to load user prefs:", err);
    return {};
  }
}

// 💾 Save all prefs back to disk
function saveAllPrefs(prefs) {
  try {
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
  } catch (err) {
    console.error("❌ Failed to save user prefs:", err);
  }
}

// ✅ Get prefs for one user (initialize if missing)
async function getUserPreferences(chatId) {
  const allPrefs = loadAllPrefs();

  const isAppUser = ["web", "default", "ui"].includes(chatId);
  const isNewUser = !allPrefs[chatId];

  // Initialize prefs if missing
  if (isNewUser) {
    allPrefs[chatId] = {
      ...defaultPrefs,
      alertsEnabled: !isAppUser,               // ⛔ disable alerts by default for app
      confirmBeforeTrade: !isAppUser,          // ✅ disable confirm in app (faster UX)
      safeMode: true,
      autoBuy: {
        enabled: false,
        amount: 0.05,                          // fallback (only for bot if ever used)
      },
    };
    saveAllPrefs(allPrefs);
  } else {
    // Inject missing fields (for backwards compat)
    if (!allPrefs[chatId].autoBuy) {
      allPrefs[chatId].autoBuy = { ...defaultPrefs.autoBuy };
    }
    if (allPrefs[chatId].slippage === undefined) {
      allPrefs[chatId].slippage = defaultPrefs.slippage;
    }
    if (allPrefs[chatId].confirmBeforeTrade === undefined) {
      allPrefs[chatId].confirmBeforeTrade = defaultPrefs.confirmBeforeTrade;
    }
    saveAllPrefs(allPrefs);
  }

  return allPrefs[chatId];
}

// ✅ Set/update a user's preferences
async function setUserPreferences(chatId, updates) {
  const allPrefs = loadAllPrefs();
  const current = allPrefs[chatId] || { ...defaultPrefs };
  allPrefs[chatId] = { ...current, ...updates };
  saveAllPrefs(allPrefs);
}

module.exports = {
  getUserPreferences,
  setUserPreferences,
};
