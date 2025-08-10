const prisma = require("../../../../prisma/prisma");
const { jobs } = require("./strategyScheduler");
const { STATUS } = require("./strategyScheduler");

const INTERVAL_MS = 60_000;
let tick = 0;

function monitorScheduler() {
  setInterval(async () => {
    tick++;
    const now = new Date();
    console.log(`\n🧠 [Scheduler Tick ${tick}] ${now.toLocaleTimeString()}`);
    if (!jobs.size) return console.warn("⚠️ No active scheduled jobs.");

    for (const [jobId, { mode, triggerTime }] of jobs.entries()) {
      const mins = Math.round((triggerTime - now) / 60_000);
      console.log(`  • ${mode} in ${mins} min @ ${triggerTime.toLocaleTimeString()}`);
    }

    // 🔥 Run cleanup once every 60 ticks (i.e., every hour)
    if (tick % 60 === 0) await cleanupOldSchedules();

  }, INTERVAL_MS);
}

async function cleanupOldSchedules() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

  const deleted = await prisma.scheduledStrategy.deleteMany({
    where: {
      status: { in: [STATUS.COMPLETED, STATUS.STOPPED] },
      finishedAt: { lt: cutoff },
    },
  });

  if (deleted.count > 0) {
    console.log(`🧹 [Scheduler] Cleaned up ${deleted.count} old scheduled strategies.`);
  }
}

module.exports = { monitorScheduler };
