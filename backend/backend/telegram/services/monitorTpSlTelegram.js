require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { getCurrentWallet } = require("../../services/utils/wallet/walletManager");
const { getTokenAccountsAndInfo } = require("../../utils/tokenAccounts");
const { loadSettings, saveSettings } = require("../utils/TpSlStorage"); 
const { checkAndTriggerTpSl } = require("../../services/tpSlExecutor"); 

async function monitorTpSlTelegram() {
  const wallet = getCurrentWallet();
  const tokenAccounts = await getTokenAccountsAndInfo(wallet.publicKey);
  const tokenMap = Object.fromEntries(tokenAccounts.map(t => [t.mint, t.amount]));
  const settings = loadSettings();

  for (const chatId in settings) {
    for (const mint in settings[chatId]) {
      const config = settings[chatId][mint];
      if (!config.enabled) continue;
      const held = tokenMap[mint];
      if (!held || held <= 0) continue;

      const hit = await checkAndTriggerTpSl(mint, config, chatId);
      if (hit) {
        settings[chatId][mint].enabled = false;
        saveSettings(settings);
      }
    }
  }
}

module.exports = { monitorTpSlTelegram };
