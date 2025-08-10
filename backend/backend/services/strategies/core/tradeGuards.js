/**
 * tradeGuards.js
 * Reusable caps & safety checks shared by all strategies (DB-powered).
 * -------------------------------------------------------
 */

const prisma = require("../../../prisma/prisma");
const { isWithinDailyLimit } = require("../../utils");

/**
 * Throws an Error if cap is breached – caller decides try/catch or early-return.
 */
function assertDailyLimit(amountSol, todayTotalSol, maxDaily) {
  if (!maxDaily) return;  // no cap configured
  if (!isWithinDailyLimit(amountSol, todayTotalSol, maxDaily)) {
    throw new Error(`Daily cap reached (${todayTotalSol.toFixed(2)} / ${maxDaily} SOL)`);
  }
}

/**
 * Checks current open trades in DB by strategy+user+wallet.
 * Throws if cap exceeded.
 */
async function assertOpenTradeCap(strategy, userId, walletId, cap) {
  if (!cap) return;

  const openCount = await prisma.trade.count({
    where: {
      strategy,
      userId,
      walletId,
      outAmount: { gt: 0 },  // means position is still open
    },
  });

  if (openCount >= cap) {
    throw new Error(`Max open trades (${cap}) reached`);
  }
}

/**
 * Simple total trades counter for in-process logic.
 */
function assertTradeCap(made, cap) {
  if (cap && made >= cap) {
    throw new Error(`Max trades (${cap}) reached`);
  }
}

module.exports = {
  assertDailyLimit,
  assertOpenTradeCap,
  assertTradeCap,
};
