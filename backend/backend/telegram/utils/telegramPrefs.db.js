// Uses Prisma instead of JSON – v2 (connects user relation properly)
const prisma = require("../../prisma/prisma");

/* one source of truth: strategy type keys */
const STRATEGIES = [
  "Breakout",
  "Sniper",
  "Scalper",
  "ChadMode",
  "DipBuyer",
  "DelayedSniper",
  "TrendFollower",
  "RotationBot",
  "PaperTrader",
  "Rebalancer",
  "StealthBot",
  "Scheduled",
];

const ALL_TYPES = [
  // core trade events
  "Buy",
  "Sell",
  "DCA",
  "Limit",
  "TP",
  "SL",
  ...STRATEGIES,
  "ScheduledLaunch",
  "Safety",
];

// default = everything EXCEPT Safety (opt-in only)
const DEFAULT_TYPES = ALL_TYPES.filter((t) => t !== "Safety");

exports.getPrefs = async (userId) => {
  const rec = await prisma.telegramPreference.findUnique({ where: { userId } });
  // Null chatId means “not connected”
  return (
    rec ?? {
      chatId: null,
      enabled: false,
      types: DEFAULT_TYPES,
    }
  );
}



exports.setPrefs = async (userId, patch) => {
  let sanitizedTypes;
  if (Array.isArray(patch.types)) {
    const set = new Set();
    for (const t of patch.types) {
      if (ALL_TYPES.includes(t)) set.add(t);
    }
    sanitizedTypes = Array.from(set);
  }

  const existing = await prisma.telegramPreference.findUnique({ where: { userId } });

  // ── 1) If they’re only trying to change toggles but have NEVER connected,
  //       bail – you can’t set prefs without a chatId on record.
  if (!existing && !patch.chatId)
    throw new Error("Telegram not connected – call /set-chat-id first.");

  // ── 2) If we’re disconnecting, allow chatId = null
  const newChatId = patch.chatId === null ? null : patch.chatId;

  return prisma.telegramPreference.upsert({
     where: { userId },
     update: {
      ...(sanitizedTypes ? { types: sanitizedTypes } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.chatId !== undefined ? { chatId: newChatId } : {}),
     },
     create: {
      chatId: newChatId,                    // ← required in create
       enabled: patch.enabled ?? true,
       types: sanitizedTypes ?? DEFAULT_TYPES,
       user: { connect: { id: userId } },
     },
   });
 };