const { loadAllOrders, saveAllOrders } = require("./dcaManager");
const { performDcaBuy } = require("../../services/dcaExecutor");

const INTERVAL_MS = 60_000;
console.log("📉 Starting Telegram DCA monitor…");

function monitorDcaTg() {
  setInterval(async () => {
    const allOrders = loadAllOrders();

    for (const [uid, orders] of Object.entries(allOrders)) {
      for (const o of orders) {
        if ((o.completedBuys || 0) >= o.numBuys) {
          o.status = "completed";
          continue;
        }

        const last = o.lastBuyAt ? +o.lastBuyAt : +o.createdAt || 0;
        if ((Date.now() - last) / 3.6e6 < o.freqHours) continue;

        try {
          // ✅ Inject no-op updater to bypass web-only logic
          o.updateProgress = () => {};

          const res = await performDcaBuy(uid, o);
          if (res?.tx) {
            o.lastBuyAt = Date.now();
            o.executedCount = (o.executedCount || 0) + 1;
          }
        } catch (e) {
          console.error("TG DCA error:", e.message);
          o.missedCount = (o.missedCount || 0) + 1;
        }
      }
    }

    saveAllOrders(allOrders);
  }, INTERVAL_MS);
}

module.exports = { monitorDcaTg };
