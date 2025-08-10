/**
 * formatWalletOverview.js - Formats wallet breakdown for Telegram UI
 *
 * Used by: handleWallet.js
 * Depends on: getWalletOverview()
 */

function formatWalletOverview({ solBalance, totalValueUSD, tokens }) {
    let text = `*💰 Wallet Overview*\n\n`;
    text += `*SOL Balance:* ${solBalance} ◎\n`;
    text += `*Estimated Net Worth:* $${totalValueUSD}\n\n`;
    text += `*Top Holdings:*\n`;
  
    for (const token of tokens) {
      text += `• ${token.name}: ${token.amount.toLocaleString()} ($${token.valueUSD})\n`;
    }
  
    text += `\n_Only top tokens shown._`;
  
    const buttons = [
      [{ text: "Buy", callback_data: "buy" }, { text: "Sell", callback_data: "sell" }],
      [{ text: "Refresh", callback_data: "wallet" }, { text: "Settings", callback_data: "settings" }],
      [{ text: "🔙 Menu", callback_data: "menu" }]
    ];
  
    return { text, buttons };
  }
  
  module.exports = { formatWalletOverview };
  