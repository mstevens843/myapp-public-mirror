// monitorDcaWeb.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const INTERNAL_AUTH = `Bearer ${process.env.INTERNAL_SERVICE_TOKEN || ""}`;

const prisma = require("../../prisma/prisma");
const { performDcaBuy } = require("../dcaExecutor");

const INTERVAL_MS = 60_000;
const MAX_MISSES  = 3; 
console.log("📉 Starting DB DCA monitor…");

async function monitorDcaWeb() {
  setInterval(async () => {
    console.log(`🔄 Checking DCA orders at ${new Date().toISOString()}`);
    try {
      const orders = await prisma.dcaOrder.findMany({
        where: { status: "active" },
        orderBy: { createdAt: "asc" }
      });

      for (const o of orders) {
        // skip logic
        const last = o.lastBuyAt ? +new Date(o.lastBuyAt) : +new Date(o.createdAt);
        const elapsedHours = (Date.now() - last) / 3.6e6;
        console.log(`[DCA ] ${o.id.slice(0,6)} elapsed=${elapsedHours.toFixed(2)}h freq=${o.freqHours}h miss#${o.missedCount || 0}`);

        if ((o.completedBuys || 0) >= o.numBuys) {
          await prisma.dcaOrder.update({
            where: { id: o.id },
            data: { status: "filled", filledAt: new Date() }
          });
          console.log(`✅ DCA ${o.id} marked as filled`);
          continue;
        }

        if (elapsedHours < o.freqHours) continue;

        try {
          console.log(`🚀 Attempting DCA ${o.id} with header: ${INTERNAL_AUTH.slice(0,10)}...`);
          const res = await performDcaBuy(o.userId, o, INTERNAL_AUTH);

          if (res?.tx) {
            await prisma.dcaOrder.update({
              where: { id: o.id },
              data: {
                lastBuyAt: new Date(),
                executedCount: (o.executedCount || 0) + 1,
                completedBuys: (o.completedBuys || 0) + 1,
                tx: res.tx
              }
            });
            console.log(`🚀 DCA ${o.id} executed, tx: ${res.tx}`);
          }
        } catch (err) {
          console.error(`❌ DCA ${o.id} failed:`, err.message);
          await prisma.dcaOrder.update({
            where: { id: o.id },
            data: { missedCount: (o.missedCount || 0) + 1 }
          });
          if ((o.missedCount || 0) + 1 >= MAX_MISSES) {
            await prisma.dcaOrder.update({
              where: { id: o.id },
              data: { status: "failed", filledAt: new Date() }
            });
            console.log(`🛑 DCA ${o.id} canceled after ${o.missedCount + 1} misses`);
          }
        }
      }
    } catch (err) {
      console.error("❌ monitorDcaWeb error:", err.message);
    }
  }, INTERVAL_MS);
}

module.exports = { monitorDcaWeb };



