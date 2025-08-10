require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const { getCachedPrice } = require("../../utils/priceCache.dynamic");
const { sendBotAlert }          = require("../botAlerts");
const { performLimitBuy, performLimitSell } = require("../../services/limitExecutor");

const {
  readLimitOrdersFile,
  writeLimitOrdersFile
} = require("../utils/limitManager");

const INTERVAL_MS = 15_000;

async function monitorLimitTg() {
  console.log("📲 Starting monitorLimitTelegram...");

  setInterval(async () => {
    const allOrders = readLimitOrdersFile();

    for (const [userId, orders] of Object.entries(allOrders)) {
      if (userId === "web") continue;

      const updated = [];

      for (const order of orders) {
        if (order.status === "done") {
          updated.push(order);
          continue;
        }

        const target = order.targetPrice ?? order.price;
        const price = await getCachedPrice(order.token);
        if (!price) {
          updated.push(order); // skip if price totally fails
          continue;
        }

        if (!price) {
          updated.push(order);
          continue;
        }

        const shouldTrigger = (order.side === "buy" && price <= target)
                           || (order.side === "sell" && price >= target);
        if (!shouldTrigger) {
          updated.push(order);
          continue;
        }

        try {
          const tx = order.side === "buy"
            ? await performLimitBuy(order, userId)
            : await performLimitSell(order, userId);

          order.status = "done";
          order.executedAt = new Date().toISOString();
          updated.push(order);
        } catch (err) {
          console.error(`❌ Limit ${order.side} failed:`, err.message);
          await sendBotAlert(userId, `❌ Limit ${order.side} failed for ${order.token}: ${err.message}`, "Limit");

          order.failCount = (order.failCount || 0) + 1;
          if (order.failCount < 10) updated.push(order);
        }
      }

      allOrders[userId] = updated;
    }

    writeLimitOrdersFile(allOrders);
  }, INTERVAL_MS);
}

module.exports = { monitorLimitTg };
