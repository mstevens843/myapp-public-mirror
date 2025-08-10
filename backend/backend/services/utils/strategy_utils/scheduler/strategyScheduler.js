/* ========================================================================
 * strategyScheduler.js  – v2.4 ➜ v2.4.1
 * ------------------------------------------------------------------------
 * • Restores / schedules timed bot launches from ScheduledStrategy table
 * • Fires 5 min *before* launchISO for warm-up
 * • Tracks lifecycle in DB (pending → running → completed / stopped)
 * • Passes userId, walletId & startTime into the strategy config
 * ====================================================================== */

const crypto   = require("crypto");
let   schedule = null;
try { schedule = require("node-schedule"); } catch {/* optional dep */ }

const prisma                       = require("../../../../prisma/prisma");
const { startStrategy }            = require("../strategyLauncher");
const { validateScheduleLauncher } = require("../strategyValidator");
const { getCachedPrice }           = require("../../../../utils/priceCache.dynamic");

const { runningProcesses } = require("../activeStrategyTracker");
const { sendAlert }        = require("../../../../telegram/alerts"); // adjust path if needed

const jobs = new Map();

/* ─── constants ────────────────────────────────────────────────────── */
const PRELAUNCH_MIN = 5;                     // warm-up offset (minutes)
const PRELAUNCH_MS  = PRELAUNCH_MIN * 60_000;

/* DB status helpers */
const STATUS = {
  PENDING  : "pending",
  RUNNING  : "running",
  COMPLETED: "completed",
  STOPPED  : "stopped",
};

/* ──────────────────────────────────────────────────────────────────── */
/* 1. Boot-time restore                                                */
/* ──────────────────────────────────────────────────────────────────── */
async function init() {
  // only restore future-dated, still-pending schedules
  const rows = await prisma.scheduledStrategy.findMany({
    where: {
      status   : STATUS.PENDING,
      launchISO: { gt: new Date() },
    },
  });

  for (const row of rows) jobs.set(row.id, armJob(row));
  console.log(`📦 Restored ${jobs.size} scheduled strategies.`);
}

/* ──────────────────────────────────────────────────────────────────── */
/* 2. Create schedule (called by /schedule/create route)               */
/* ──────────────────────────────────────────────────────────────────── */
async function scheduleStrategy({
  name = null, mode = "", config = {}, launchISO,
  targetToken, limit, buyMode = "interval", userId, walletId,
}) {
  if (!mode || !launchISO) throw new Error("mode and launchISO are required");

  const errs = validateScheduleLauncher(config);
  if (errs.length) throw new Error(`Invalid ${mode} config:\n- ${errs.join("\n- ")}`);

  const launchTime = new Date(launchISO);
  if (Number.isNaN(launchTime)) throw new Error("launchISO is not a valid date");
  if (launchTime <= Date.now()) throw new Error("launchISO must be in the future");

  /* FK guard – wallet belongs to user */
  const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) throw new Error(`Wallet ${walletId} not found`);
  if (wallet.userId !== userId)
    throw new Error(`Wallet ${walletId} does not belong to user ${userId}`);

  const row = await prisma.scheduledStrategy.create({
    data: {
      name, mode: "scheduleLauncher", config,
      launchISO : launchTime,
      targetToken, limit, buyMode,
      status    : STATUS.PENDING,               // ← NEW
      user      : { connect: { id: userId   } },
      wallet    : { connect: { id: walletId } },
    },
  });

  jobs.set(row.id, armJob(row));
  return row.id;
}

/* ──────────────────────────────────────────────────────────────────── */
/* 3. Cancel schedule (before launch)                                  */
/* ──────────────────────────────────────────────────────────────────── */
// async function cancelSchedule(jobId) {
//   const meta = jobs.get(jobId);
//   if (!meta) return false;

//   meta.cancel();
//   jobs.delete(jobId);

//   // mark as stopped instead of deleting row
//   await prisma.scheduledStrategy.update({
//     where: { id: jobId },
//     data : { status: STATUS.STOPPED, finishedAt: new Date() },
//   });
//   return true;
// }
async function cancelSchedule(jobId) {
  const meta = jobs.get(jobId);
  if (meta) {
    meta.cancel();
    jobs.delete(jobId);
  }
  await prisma.scheduledStrategy.delete({ where: { id: jobId } });
  return true;
}


/* ──────────────────────────────────────────────────────────────────── */
/* 4. Update schedule                                                  */
/* ──────────────────────────────────────────────────────────────────── */
async function updateSchedule({
  jobId, name, mode, config, launchISO, startTime,
  targetToken, limit,
}) {
  if (!jobs.has(jobId)) throw new Error("Job not found");

  const row = await prisma.scheduledStrategy.update({
    where: { id: jobId },
    data : {
      name,
      mode        : mode        ?? undefined,
      config      : config      ?? undefined,
      launchISO   : (launchISO ?? startTime)
                   ? new Date(launchISO ?? startTime)
                   : undefined,
      targetToken : targetToken ?? undefined,
      limit       : limit       ?? undefined,
    },
  });

  jobs.get(jobId).cancel();         // kill old timer
  jobs.set(jobId, armJob(row));     // arm fresh timer
  return jobId;
}

/* ──────────────────────────────────────────────────────────────────── */
/* helpers                                                             */
/* ──────────────────────────────────────────────────────────────────── */

/** create on-disk or node-schedule timer, incl. pre-launch offset */
function armJob(row) {
  const launchTime  = new Date(row.launchISO);
  const triggerTime = new Date(launchTime.getTime() - PRELAUNCH_MS);

  const run   = () => launchStrategy(row);
  const now   = Date.now();
  const delay = triggerTime.getTime() - now;

const job = schedule
  ? (delay <= 0
      ? schedule.scheduleJob(new Date(Date.now() + 100), run)
      : schedule.scheduleJob(triggerTime, run))
  : setTimeout(run, Math.max(100, delay));

  const meta = { ...row, triggerTime, job };
  meta.cancel = () => {
    if (schedule && typeof job.cancel === "function") job.cancel();
    else clearTimeout(job);
  };
  return meta;
}

/** async fire → enrich config → startStrategy() */
function launchStrategy(row) {
  (async () => {
    const { id: jobId, config, userId, walletId, launchISO } = row;
console.log(`⏰ [Scheduler] Pre-launch scheduleLauncher (job ${jobId})`);

    /* duplicate-launch guard (strengthened) */
    const mode = "scheduleLauncher";
    const botId = `${mode}-${jobId}`;
    if (runningProcesses[botId]) {
      console.warn(`⚠️  [Scheduler] Duplicate launch blocked for ${botId}`);

      /* mark as stopped so it’s cleaned up later, then drop timer */
      try {
        await prisma.scheduledStrategy.update({
          where: { id: jobId },
          data : { status: STATUS.STOPPED, finishedAt: new Date() },
        });
      } catch {/* ignore DB errors in guard */}
      jobs.delete(jobId);
      return;
    }

    /* mark DB → running */
    await prisma.scheduledStrategy.update({
      where: { id: jobId },
      data : { status: STATUS.RUNNING, startedAt: new Date() },
    });

    const enrichedCfg = {
      ...config,
      botId,
      userId,
      walletId,
      startTime: launchISO,
    };

    try {
      await startStrategy("scheduleLauncher", enrichedCfg, /*autoRestart=*/false);
      console.log(`🚀 [Scheduler] ${mode} started (job ${jobId})`);
       } catch (err) {
         console.error(
           `💥 [Scheduler] Failed to start ${mode}:`,
           err.message,
           err.details || ""
         );

      /* alert user on failure */
      try {
        await sendAlert(
          userId || "web",
          `❌ *Failed to start scheduled strategy*\n\n` +
          `• Mode: \`${mode}\`\n` +
          `• Time: ${new Date().toLocaleTimeString()}\n` +
          `• Reason: \`${err.message}\`\n` +
          `• Job ID: \`${jobId.slice(0, 8)}…\``
        );
      } catch {/* ignore */}
      /* mark DB → stopped on failure */
      await prisma.scheduledStrategy.update({
        where: { id: jobId },
        data : { status: STATUS.STOPPED, finishedAt: new Date() },
      });
    } finally {
      jobs.delete(jobId);           // remove timer; row persists for 7-day cleanup
    }
  })();
}

/* ──────────────────────────────────────────────────────────────────── */
module.exports = {
  init,
  scheduleStrategy,
  cancelSchedule,
  updateSchedule,
  jobs,
  STATUS,                           // export for external reference
};
