const prisma = require("../../../prisma/prisma");


async function registerTpSl(
  mint,
  { tp, sl, tpPct, slPct, walletId, userId, strategy = "unknown", entryPrice = null }
) {
  if (!tp && !sl) return;

  console.log(`📝 Registering TP/SL rule for ${mint} (${strategy})`);

  await prisma.tpSlRule.create({
    data: {
      id: uuid(),
      mint,
      walletId,
      userId,
      strategy,
      tp,
      sl,
      tpPercent: tpPct,
      slPercent: slPct,
      entryPrice,
      force: false,
      enabled: true,
      status: "active",
      failCount: 0,
    },
  });

  console.log(`✅ Created TP/SL rule in DB for ${mint}`);
}
