/** Simple Risk Manager Utility
 *  Provides basic safety checks for trade volume and balance constraints 
 * 
 * Fratures: 
 * - Mix daily trade volume enforcement
 * - Min wallet balance requirement
  */ 


/**
 * Checks if new trade will keep the bot under the daily limit. 
 */
function isWithinDailyLimit(tradeAmount, dailyTotal, maxPerDay) {
    return (dailyTotal + tradeAmount) <= maxPerDay; 
}

/** 
 * Ensures the wallet has enough balance to trade. 
 */
function isAboveMinBalance(currentBalance, minBalance) {
    return currentBalance >= minBalance; 
}


module.exports = {
    isWithinDailyLimit,
    isAboveMinBalance,
}