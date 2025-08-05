import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const userId = "aa6c7d78-ce68-423d-a514-d54537d85f63";  // 🔥 replace this with actual userId from your User table

  // 🚀 Seed PortfolioTracker
  await prisma.portfolioTracker.create({
    data: {
      userId,
      startTs: BigInt(1685387400000),
      lastMonthlyTs: BigInt(1751439600000)
    }
  });

  // 🚀 Seed NetWorthSnapshot monthly records
  const monthlySnapshots = [
    { ts: 1685786561488, netWorth: 8.72, sol: 6.1, usdc: 2.62, openPositions: 5 },
    { ts: 1688378561488, netWorth: 20.1, sol: 0.7, usdc: 0.3, openPositions: 4 },
    { ts: 1691056961488, netWorth: 54.1, sol: 0.7, usdc: 0.3, openPositions: 4 },
    { ts: 1693735361488, netWorth: 110.21, sol: 0.7, usdc: 0.3, openPositions: 2 },
    { ts: 1696327361488, netWorth: 250.21, sol: 0.7, usdc: 0.3, openPositions: 4 },
    { ts: 1699005761488, netWorth: 140.21, sol: 0.7, usdc: 0.3, openPositions: 1 },
    { ts: 1701597761488, netWorth: 210.15, sol: 10.71, usdc: 4.59, openPositions: 2 },
    { ts: 1704276161488, netWorth: 130.56, sol: 20.53, usdc: 8.8, openPositions: 2 },
    { ts: 1706954561488, netWorth: 150.46, sol: 26.17, usdc: 11.22, openPositions: 3 },
    { ts: 1709460161488, netWorth: 99.54, sol: 38.08, usdc: 16.32, openPositions: 3 },
    { ts: 1712138561488, netWorth: 69.06, sol: 48.34, usdc: 20.72, openPositions: 4 },
    { ts: 1714730561488, netWorth: 86.18, sol: 60.33, usdc: 25.85, openPositions: 2 },
    { ts: 1717408961488, netWorth: 80.46, sol: 56.32, usdc: 24.14, openPositions: 3 },
    { ts: 1720000961488, netWorth: 74.29, sol: 52, usdc: 22.29, openPositions: 1 },
    { ts: 1722679361488, netWorth: 68.83, sol: 48.18, usdc: 20.65, openPositions: 5 },
    { ts: 1725357761488, netWorth: 52.8, sol: 36.96, usdc: 15.84, openPositions: 5 },
    { ts: 1727949761488, netWorth: 44.1, sol: 30.87, usdc: 13.23, openPositions: 3 },
    { ts: 1730628161488, netWorth: 28.4, sol: 19.88, usdc: 8.52, openPositions: 3 },
    { ts: 1733220161488, netWorth: 44.32, sol: 31.02, usdc: 13.3, openPositions: 1 },
    { ts: 1735898561488, netWorth: 53.11, sol: 37.18, usdc: 15.93, openPositions: 5 },
    { ts: 1738576961488, netWorth: 69.89, sol: 48.92, usdc: 20.97, openPositions: 4 },
    { ts: 1740996161488, netWorth: 75.97, sol: 53.18, usdc: 22.79, openPositions: 2 },
    { ts: 1743674561488, netWorth: 84.25, sol: 58.97, usdc: 25.27, openPositions: 1 },
    { ts: 1746316800000, netWorth: 95.27, sol: 66.69, usdc: 28.58, openPositions: 5 },
    { ts: 1748934000000, netWorth: 105.67, sol: 72.45, usdc: 33.22, openPositions: 4 },
    { ts: 1751439600000, netWorth: 71.06, sol: 36.15, usdc: 0, openPositions: 40 }
  ];

  await prisma.netWorthSnapshot.createMany({
    data: monthlySnapshots.map(s => ({
      userId,
      ts: BigInt(s.ts),
      netWorth: s.netWorth,
      sol: s.sol,
      usdc: s.usdc,
      openPositions: s.openPositions
    }))
  });

  console.log("✅ Seeded PortfolioTracker and NetWorthSnapshot for user:", userId);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
