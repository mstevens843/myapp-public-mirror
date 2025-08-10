const fs   = require("fs");
const path = require("path");
const prisma = require("../../../prisma/prisma");

const {
  runningProcesses,
  lastConfigPaths,
} = require("../../utils/strategy_utils/activeStrategyTracker");
const { clearStrategyStatus } =
  require("../../utils/strategy_utils/strategyStatus");

/**
 * Completely wipes a bot from memory, disk, and DB.
 * @param {string} botId
 */
async function fullCleanup(botId) {
  // 1️⃣ in-memory status
  clearStrategyStatus(botId);

  // 2️⃣ runtime file
  const file = path.join(__dirname, "../../utils/runtime", `${botId}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);

  // 3️⃣ trackers
  delete runningProcesses[botId];
  delete lastConfigPaths[botId];

  // 4️⃣ DB row (fails silently if already gone)
  try {
    await prisma.strategyRunStatus.deleteMany({ where: { botId } });
  } catch (err) {
    console.warn(`[CLEANUP] DB delete failed for ${botId}:`, err.message);
  }

  console.log(`[CLEANUP] ✅ Bot ${botId} fully removed`);
}

module.exports = { fullCleanup };
