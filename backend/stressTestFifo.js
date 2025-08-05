const prisma = require("./prisma/prisma");
const { closePositionFIFO } = require("./services/utils/analytics/fifoReducer");
const { v4: uuid } = require("uuid");

async function main() {
  const userId = 1;
  const walletId = 6;
  const mint = "Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump";
  const walletLabel = "jup wallet";
  const strategy = "manual";
  const decimals = 6;

  console.log("\n🚀 Starting stress test");

  /* ── STEP 1: Simulate multiple buys ───────────────────── */
  for (let i = 0; i < 5; i++) {
    const outAmount = (Math.floor(Math.random() * 5) + 1) * 1_000_000;
    const inAmount = outAmount * 0.07;
    await prisma.trade.create({
      data: {
        mint,
        tokenName: "TestToken",
        entryPrice: 0.0004,
        entryPriceUSD: 0.065 + 0.01 * i,
        inAmount: BigInt(Math.floor(inAmount)),
        outAmount: BigInt(outAmount),
        closedOutAmount: BigInt(0),
        strategy,
        walletLabel,
        txHash: uuid(),
        unit: "sol",
        slippage: 1,
        decimals,
        usdValue: outAmount / 10 ** decimals * 0.065,
        type: "buy",
        side: "buy",
        botId: strategy,
        walletId
      }
    });
  }
  console.log("✅ Created 5 random buys");

  /* ── STEP 2: Run multiple random sells ───────────────── */
  for (let i = 0; i < 8; i++) {
    const percent = Math.random() * 0.5 + 0.1;
    console.log(`\n🔻 Sell #${i + 1}: trying to sell ~${(percent * 100).toFixed(1)}%`);

    try {
      const res = await closePositionFIFO({
        userId,
        mint,
        walletId,
        walletLabel,
        percent,
        strategy,
        triggerType: "manual",
        exitPrice: 0.000402 + 0.00001 * i,
        exitPriceUSD: 0.065 + 0.005 * i,
        txHash: uuid(),
        slippage: 1,
        decimals,
      });
      console.log("✅ Closed rows:", res.closedRows.length, "sold tokens:", res.soldTok / 10 ** decimals);
    } catch (err) {
      console.log("⚠️ Sell failed:", err.message);
    }
  }

  /* ── STEP 3: Verify final math ───────────────────────── */
  const openTrades = await prisma.trade.findMany({
    where: { mint, walletId, strategy, walletLabel }
  });
  const closedTrades = await prisma.closedTrade.findMany({
    where: { mint, walletId, strategy, walletLabel }
  });

  const totalOpen = openTrades.reduce((sum, r) => sum + BigInt(r.outAmount), 0n);
  const totalClosed = closedTrades.reduce((sum, r) => sum + BigInt(r.outAmount), 0n);

  // 🛠 The REAL initial buy total = sum of all originally purchased amounts
  const allTrades = await prisma.trade.findMany({
    where: { mint, walletId, strategy, walletLabel },
    select: { outAmount: true, closedOutAmount: true }
  });
  const allOriginalTotal = allTrades.reduce(
    (sum, r) => sum + BigInt(r.outAmount) + BigInt(r.closedOutAmount), 0n
  );
 
const totalBought = closedTrades.reduce((sum, r) => sum + BigInt(r.outAmount), 0n)
                 + openTrades.reduce((sum, r) => sum + BigInt(r.outAmount), 0n);

console.log("\n📊 Summary:");
console.log("Total Open Positions :", (Number(totalOpen) / 10 ** decimals).toFixed(6));
console.log("Total Closed Positions:", (Number(totalClosed) / 10 ** decimals).toFixed(6));
console.log("Open + Closed          :", (Number(totalOpen + totalClosed) / 10 ** decimals).toFixed(6));
console.log("Initial Bought         :", (Number(totalBought) / 10 ** decimals).toFixed(6));

if (Math.abs(Number((totalOpen + totalClosed) - totalBought)) < 10_000) {
  console.log("✅ Totals reconcile – math is solid.");
} else {
  console.log("❌ Totals DO NOT reconcile – investigate.");
}
}

main()
  .then(() => {
    console.log("\n✅ Stress test complete.");
    process.exit(0);
  })
  .catch((e) => {
    console.error("❌ Failed:", e);
    process.exit(1);
  });
