require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const INTERNAL_AUTH = `Bearer ${process.env.INTERNAL_SERVICE_TOKEN || ""}`;

const prisma = require("../../prisma/prisma");
const { performLimitBuy, performLimitSell } = require("../limitExecutor");
const getTokenPrice  = require("../../services/strategies/paid_api/getTokenPrice");
const getCachedPrice = require("../../utils/priceCache.static").getCachedPrice;

const INTERVAL_MS = 30_000;
const MAX_FAILS   = 3; 

console.log("🌐 Starting monitorLimitWeb...");

async function monitorLimitWeb() {
  setInterval(async () => {
    try {
      const orders = await prisma.limitOrder.findMany({
        where: { status: "open" },
        orderBy: { createdAt: "asc" }
      });

      for (const order of orders) {
        if ((order.failCount || 0) >= MAX_FAILS) {
          await prisma.limitOrder.update({
            where: { id: order.id },
            data : { status: "failed", failedAt: new Date() }
          });
          console.log(`🛑 Limit ${order.id} canceled after ${order.failCount} failures`);
          continue;
        }

        const targetPrice = order.targetPrice ?? order.price;
        const price = await getCachedPrice(order.token);
        if (!price) continue;

        console.log(`[LIMIT] ${order.side.toUpperCase()} ${order.mint.slice(0,4)}…  ` +
                    `price=$${price.toFixed(6)}  target=$${targetPrice}  ` +
                    `fail#${order.failCount || 0}`);

        const shouldTrigger =
          (order.side === "buy" && price <= targetPrice) ||
          (order.side === "sell" && price >= targetPrice);

        if (!shouldTrigger) continue;

        try {
          console.log(`🚀 Attempting LIMIT ${order.id} with header: ${INTERNAL_AUTH.slice(0,10)}...`);
          const tx = order.side === "buy"
            ? await performLimitBuy(order, INTERNAL_AUTH)
            : await performLimitSell(order, INTERNAL_AUTH);

          await prisma.limitOrder.update({
            where: { id: order.id },
            data: {
              status: "executed",
              executedAt: new Date(),
              tx
            }
          });

          console.log(`✅ LIMIT ${order.id} executed, tx: ${tx}`);

        } catch (err) {
          console.error(`❌ Limit ${order.side} failed:`, err.message);

          await prisma.limitOrder.update({
            where: { id: order.id },
            data : { failCount: { increment: 1 } }
          });

          if ((order.failCount || 0) + 1 >= MAX_FAILS) {
            await prisma.limitOrder.update({
              where: { id: order.id },
              data : { status: "failed", failedAt: new Date() }
            });
            console.log(`🛑 Limit ${order.id} canceled after ${order.failCount + 1} failures`);
          }
        }
      }
    } catch (err) {
      console.error("❌ monitorLimitWeb general error:", err.message);
    }
  }, INTERVAL_MS);
}

module.exports = { monitorLimitWeb };
