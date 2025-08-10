const { Prisma } = require("@prisma/client");
const prisma     = require("../../../prisma/prisma");
const { v4: uuid } = require("uuid");

module.exports.closePositionFIFO = async function closePositionFIFO(opts) {
  const {
    userId, walletId, mint, walletLabel = "",
    percent, amountSold, removedAmount,
    strategy, triggerType,
    exitPrice, exitPriceUSD,
    txHash, slippage, decimals = 9,
  } = opts;
  if (!exitPrice || !exitPriceUSD) throw new Error("exitPrice + exitPriceUSD required");

  // let rows = await prisma.trade.findMany({
  //   where  : { mint, walletId, strategy, walletLabel },
  //   orderBy: { timestamp: "asc" }
  // });
  let rows = await prisma.trade.findMany({
    where  : {
      mint,
      walletId,
      strategy,
      ...(walletLabel && walletLabel !== "default" ? { walletLabel } : {})
    },
    orderBy: { timestamp: "asc" }
  });
  rows = rows.filter(r => BigInt(r.outAmount) > 0n);

  if (!rows.length) throw new Error("No matching open trades.");

  /* ── Calculate total to sell ───────────────────────── */
  const totalTok = rows.reduce((sum, r) => sum + BigInt(r.outAmount), 0n);
  const pctNum = percent != null ? (percent > 1 ? percent / 100 : percent) : null;
  const tokToSell = removedAmount != null
    ? BigInt(removedAmount)
    : amountSold != null
      ? BigInt(amountSold)
      : pctNum != null
        ? (totalTok * BigInt(Math.round(pctNum * 1_000_000))) / 1_000_000n
        : 0n;

  if (tokToSell <= 0n) throw new Error("Invalid sell amount.");

  console.log(`🧮 Will sell ~${Number(tokToSell)/10**decimals} tokens out of ${Number(totalTok)/10**decimals}`);

  /* ── Perform FIFO reductions ──────────────────────── */
  const dustRaw = BigInt(Math.round(10 ** decimals * 0.01));
  let still = tokToSell;
  const closedRows = [];

  await prisma.$transaction(async tx => {
    for (const r of rows) {
      if (still <= 0n) break;

      const remainingTok = BigInt(r.outAmount);
      const slice = remainingTok < still ? remainingTok : still;

      const ratio = Number(slice) / Number(r.outAmount);
      const costTrim = BigInt(Math.round(Number(r.inAmount) * ratio));

      console.log(`➡️ Taking ${Number(slice)/10**decimals} tokens from row ${r.id} (had ${Number(remainingTok)/10**decimals})`);

      await tx.trade.update({
        where: { id: r.id },
        data: {
          closedOutAmount: { increment: costTrim },
          inAmount       : { decrement: costTrim },
          outAmount      : { decrement: slice },
          usdValue       : { decrement: Number(slice) / 10 ** decimals * r.entryPriceUSD }
        }
      });

      still -= slice;

      const updated = await tx.trade.findUnique({ where: { id: r.id }});
      const residualTok = BigInt(updated.outAmount);

      if (residualTok === 0n || residualTok < dustRaw) {
        console.log(`⚠️ Removing dust row ${r.id}, left=${Number(residualTok)/10**decimals}`);
        await tx.trade.delete({ where: { id: r.id } });
      }

      closedRows.push(await tx.closedTrade.create({
        data: {
          mint,
          tokenName      : r.tokenName,
          entryPrice     : r.entryPrice,
          entryPriceUSD  : r.entryPriceUSD,
          inAmount       : costTrim,
          outAmount      : slice,
          closedOutAmount: costTrim,
          exitPrice, exitPriceUSD,
          strategy, walletLabel,
          txHash         : txHash ? `${txHash}-${uuid()}` : uuid(),
          unit           : r.unit,
          slippage, decimals,
          usdValue       : Number(slice) / 10 ** decimals * exitPriceUSD,
          type           : "sell",
          side           : "sell",
          botId          : r.botId,
          triggerType,
          exitedAt       : new Date(),
          walletId       : r.walletId
        }
      }));
    }
  });

  console.log(`✅ Finished: actually sold ${(Number(tokToSell - still) / 10 ** decimals).toFixed(6)} tokens`);


  // 🔥 SMART REBALANCE of TP/SL allocations
const rules = await prisma.tpSlRule.findMany({
  where: {
    userId,
    walletId,
    mint,
    strategy,
    enabled: true
  }
});

if (rules.length > 0) {
  const originalSum = rules.reduce((acc, r) => acc + (r.sellPct ?? r.tpPercent ?? r.slPercent ?? 0), 0);
  
  // Now recalc actual allocation left after this sell
  // e.g. if you sold 25% out of total 100%, that's 25% of total, remove proportionally
  const soldFraction = Number(tokToSell - still) / Number(totalTok);
  const newRuleSum = originalSum * (1 - soldFraction);

  console.log(`📊 Original TP/SL rule sum: ${originalSum}%`);
  console.log(`📉 Sold fraction of total: ${(soldFraction*100).toFixed(2)}%`);
  console.log(`🧮 New effective rule sum: ${newRuleSum.toFixed(2)}%`);

  if (newRuleSum > 0) {
    for (const r of rules) {
      const orig = r.sellPct ?? r.tpPercent ?? r.slPercent ?? 0;
      const newAlloc = +(orig / newRuleSum * 100).toFixed(2);

      console.log(`🔄 Rule ${r.id}: ${orig}% → ${newAlloc}%`);

      await prisma.tpSlRule.update({
        where: { id: r.id },
        data: {
          sellPct: newAlloc,
          tpPercent: newAlloc,
          slPercent: newAlloc,
          updatedAt: new Date()
        }
      });
    }
  } else {
    console.log("⚠️ Effective rule sum zero, skipping rebalance.");
  }
}

  // ✅ AFTER your FIFO reductions, disable matching TP/SL rules
const stillOpen = await prisma.trade.findMany({
  where: {
    walletId,
    mint,
    strategy,
    outAmount: { gt: 0 }
  }
});

if (stillOpen.length === 0) {
  console.log(`🧹 No open trades left for ${mint}, deleting TP/SL rules...`);
  await prisma.tpSlRule.deleteMany({
    where: {
      userId,
      walletId,
      mint,
      strategy
    }
  });
}
  return { closedRows, soldTok: Number(tokToSell - still) };
};
