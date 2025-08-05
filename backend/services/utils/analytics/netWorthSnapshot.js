/**********************************************************************
 Net‑worth poller – one pass per user, aggregates *all* their wallets
 • Keeps the last 35 daily rows (NetWorthHistory)
 • Stores a monthly snapshot every ≥30 days (NetWorthSnapshot)
 • PortfolioTracker drives the 30‑day logic
 *********************************************************************/
require("dotenv").config();

const axios            = require("axios");
const cron             = require("node-cron");
const { PrismaClient } = require("@prisma/client");
const prisma           = new PrismaClient();

/* everything below is BigInt‑friendly */
const ONE_DAY = 86_400_000n;   // milliseconds per day – BigInt
const KEEP_DAYS = 35n;         // rows we keep in history            (BigInt not required here,
                               // but keeping it consistent doesn’t hurt)

/* -------------------------------------------------- *
 * 1️⃣  Helper – sum every wallet belonging to a user
 * -------------------------------------------------- */
async function getUserNetWorth(userId) {
  const { data } = await axios.get(
    `${process.env.API_BASE}/api/internalJobs/positions?userId=${userId}`,
    { headers: { Authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN}` } }
  );

  return {
    netWorth : +data.netWorth.toFixed(2),
    sol      : data.sol?.valueUSD  ?? 0,
    usdc     : data.usdc?.valueUSD ?? 0,
  };
}

/* -------------------------------------------------- *
 * 2️⃣  Write daily + maybe‑monthly rows for 1 user
 * -------------------------------------------------- */
async function writeSnapshots(userId, netWorth, sol, usdc) {
  const ts  = BigInt(Date.now());          // current time as BigInt
  const dateOnly = new Date(Number(ts)).toISOString().slice(0, 10);   // YYYY‑MM‑DD
  const minute   = new Date(Number(ts)).toISOString().slice(11, 16);  // HH:MM

  /* ---------- daily / rolling history ---------- */
  await prisma.netWorthHistory.upsert({
    where: { userId_date: { userId, date: dateOnly } },
    update: { ts, value: netWorth },
    create: { userId, ts, date: dateOnly, minute, value: netWorth },
  });

  /* keep only the most‑recent 35 daily rows */
  await prisma.$executeRawUnsafe(`
    DELETE FROM "NetWorthHistory"
    WHERE "userId" = '${userId}'
      AND id NOT IN (
        SELECT id FROM "NetWorthHistory"
        WHERE "userId" = '${userId}'
        ORDER BY ts DESC
        LIMIT ${KEEP_DAYS}
      );
  `);

  console.log(`💾 [${userId}] Daily snapshot: $${netWorth}`);

  /* ---------- monthly snapshot logic ---------- */
  let tracker = await prisma.portfolioTracker.findFirst({ where: { userId } });

  if (!tracker) {
    tracker = await prisma.portfolioTracker.create({
      data: { userId, startTs: ts, lastMonthlyTs: ts },
    });

    await prisma.netWorthSnapshot.create({
      data: { userId, ts, netWorth, sol, usdc, openPositions: 0 },
    });
    console.log(`📦 [${userId}] First monthly snapshot`);
    return;
  }

  /* compare BigInts only */
  if (ts - tracker.lastMonthlyTs >= 30n * ONE_DAY) {
    /* new monthly snapshot */
    await prisma.netWorthSnapshot.create({
      data: { userId, ts, netWorth, sol, usdc, openPositions: 0 },
    });

    /* bump tracker */
    await prisma.portfolioTracker.update({
      where: { id: tracker.id },
      data : { lastMonthlyTs: ts },
    });
    console.log(`📦 [${userId}] Rolling monthly snapshot`);
  }
}

/* -------------------------------------------------- *
 * 3️⃣  Main loop – every user, every midnight
 * -------------------------------------------------- */
async function pollNetWorth() {
  const users = await prisma.user.findMany({ select: { id: true } });

  for (const { id } of users) {
    try {
      const { netWorth, sol, usdc } = await getUserNetWorth(id);
      await writeSnapshots(id, netWorth, sol, usdc);
    } catch (err) {
      console.warn(`⚠️  pollNetWorth user ${id}:`, err.message);
    }
  }
}

/* -------------------------------------------------- *
 * 4️⃣  Schedule
 * -------------------------------------------------- */
function startNetworthCron() {
  pollNetWorth();                              // immediate first run
  cron.schedule("0 0 * * *", pollNetWorth);    // every local midnight
}

module.exports = { startNetworthCron };
