import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const userId = "aa6c7d78-ce68-423d-a514-d54537d85f63"; // 🔥 replace with your actual userId

  // Use the last monthly as baseline
  let lastValue = 71.06;
  let lastSol = 36.15;
  let lastUsdc = 0;
  let lastTs = 1751439600000; // last monthly timestamp

  const dailySnapshots = [];

  // Generate 30 daily points forward
  for (let i = 1; i <= 30; i++) {
    // Advance timestamp by ~1 day (86,400,000 ms)
    const ts = lastTs + i * 86400000;

    // Randomized next values
    const netWorth = parseFloat((lastValue * (0.97 + Math.random() * 0.06)).toFixed(2));
    const sol = parseFloat((lastSol * (0.95 + Math.random() * 0.1)).toFixed(2));
    const usdc = parseFloat((lastUsdc * (0.95 + Math.random() * 0.1) + Math.random() * 2).toFixed(2));
    const openPositions = Math.max(1, Math.floor(5 + Math.random() * 5));

    // Build record
    dailySnapshots.push({
      userId,
      ts: BigInt(ts),
      date: new Date(ts).toISOString().slice(0,10),
      minute: "00:00",
      value: netWorth
    });

    // update last
    lastValue = netWorth;
    lastSol = sol;
    lastUsdc = usdc;
  }

  await prisma.netWorthHistory.createMany({ data: dailySnapshots });
  console.log("✅ Seeded NetWorthHistory with 30 fun volatile days!");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
