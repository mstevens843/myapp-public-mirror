// backend/services/cron/resetUsageJob.js
const prisma = require("../prisma/prisma");

async function subscriptionMonitor() {
  const now = new Date();
  

  const usersToReset = await prisma.user.findMany({
    where: {
      usageResetAt: { lte: now },
    },
  });

  if (usersToReset.length === 0) {
    console.log(`📆 No users to reset today.`);
    return;
  }

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;


  for (const user of usersToReset) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        usage: 0,
        usageResetAt: new Date(now.getTime() + THIRTY_DAYS_MS),
      },
    });

    console.log(`✅ Reset usage for user ${user.id} (${user.plan})`);
  }

  console.log(`🎯 Done: reset ${usersToReset.length} user(s)`);
}

module.exports = { subscriptionMonitor };
