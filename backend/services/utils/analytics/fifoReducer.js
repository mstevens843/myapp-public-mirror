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

  // Pull candidate rows (FIFO) for this wallet/mint/strategy (+label if set)
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

  /* ── Dust thresholds ───────────────────────────────── */
  const DUST_BPS = 100n; // 1.00% of the row's original size
  const pow10n = (d) => {
    let r = 1n;
    for (let i = 0; i < d; i++) r *= 10n;
    return r;
  };
  // ≈ 0.01 tokens in raw units (per-row decimals; floor to 1 unit for low decimals)
  const absDustRawFor = (d) => {
    const di = Number.isFinite(d) ? Number(d) : 9;
    return di <= 2 ? 1n : pow10n(di - 2);
  };

  /* ── Perform FIFO reductions ───────────────────────── */
  let still = tokToSell;
  const closedRows = [];

  await prisma.$transaction(async tx => {
    for (const r of rows) {
      if (still <= 0n) break;

      const rowOrigOut  = BigInt(r.outAmount);   // original size of this row before slicing
      const rowDecimals = r.decimals ?? decimals;

      const remainingTokBefore = rowOrigOut;
      const slice = remainingTokBefore < still ? remainingTokBefore : still;

      // Proportional cost basis to reduce for this slice
      const ratio    = Number(slice) / Number(r.outAmount);
      const costTrim = BigInt(Math.round(Number(r.inAmount) * ratio));

      console.log(`➡️ Taking ${Number(slice)/10**rowDecimals} tokens from row ${r.id} (had ${Number(remainingTokBefore)/10**rowDecimals})`);

      await tx.trade.update({
        where: { id: r.id },
        data: {
          closedOutAmount: { increment: costTrim },
          inAmount       : { decrement: costTrim },
          outAmount      : { decrement: slice },
          usdValue       : { decrement: Number(slice) / 10 ** rowDecimals * (r.entryPriceUSD || 0) }
        }
      });

      still -= slice;

      // Re-check row after trimming
      const updated     = await tx.trade.findUnique({ where: { id: r.id }});
      const residualTok = BigInt(updated.outAmount);
      const costRem     = BigInt(updated.inAmount); // remaining cost basis on row (if any)

      // Dust tests: relative (≤1% of original) OR absolute (~0.01 tokens)
      const isDustRel = (rowOrigOut > 0n) && (residualTok * 10_000n <= rowOrigOut * DUST_BPS);
      const isDustAbs = residualTok <= absDustRawFor(rowDecimals);

      if (residualTok === 0n || isDustRel || isDustAbs) {
        // 🔁 AUTO-CLOSE IN PLACE — do NOT create a closedTrade for dust
        console.log(`🧹 Dust sweep for row ${r.id} (left=${Number(residualTok)/10**rowDecimals}). Closing row.`);
        await tx.trade.update({
          where: { id: r.id },
          data: {
            outAmount : 0n,
            // move remaining cost basis into closedOutAmount
            ...(costRem > 0n ? { closedOutAmount: { increment: costRem }, inAmount: { decrement: costRem } } : {}),
            usdValue  : { decrement: Number(residualTok) / 10 ** rowDecimals * (r.entryPriceUSD || 0) },
            exitedAt  : new Date(),
            reasonCode: "dust_swept"
          }
        });
      } else {
        console.log(`ℹ️ Residual on row ${r.id} not dust: ${Number(residualTok)/10**rowDecimals}`);
      }

      // Record the normal (non-dust) slice as a closedTrade
      closedRows.push(await tx.closedTrade.create({
        data: {
          userId,
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
          slippage, decimals: rowDecimals,
          usdValue       : Number(slice) / 10 ** rowDecimals * exitPriceUSD,
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
