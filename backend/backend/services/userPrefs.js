/**
 * userPrefs.js
 * ─────────────
 * DB‑backed user‑preference helper.
 * Replaces the old Telegram `getUserPreferences(chatId)`
 * so executors (and anything else) can grab prefs by User.id.
 */

const prisma = require("../prisma/prisma");

/**
 * getUserPreferencesByUserId(userId, context?)
 *
 * @param {string}  userId   – User.id (uuid in DB)
 * @param {string}  context  – prefs “namespace”; default = "default"
 * @returns {Promise<Object>}  plain prefs object ({} if none found)
 */
async function getUserPreferencesByUserId(userId, context = "default") {
  if (!userId) throw new Error("Missing userId for getUserPreferencesByUserId");

  const row = await prisma.userPreference.findUnique({
    where: { userId_context: { userId, context } },
  });

  return row || {};
}

module.exports = { getUserPreferencesByUserId };