require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const prisma = require("../../prisma/prisma");
const { checkAndTriggerTpSl } = require("../tpSlExecutor");
const { sendAlert } = require("../../telegram/alerts");

const INTERVAL_MS = 15_000;
let tick = 0;

console.log("📊 Starting Web TP/SL monitor…");

function monitorTpSlWeb() {
  console.log("📊 Web TP/SL monitor running...");

  setInterval(async () => {
    tick++;
    console.log(`\n🔁 [Tick ${tick}] TP/SL scan at ${new Date().toLocaleTimeString()}`);

    try {
      const rules = await prisma.tpSlRule.findMany({
        where: { enabled: true, status: "active" },
        orderBy: { createdAt: "asc" }
      });
      console.log("📦 Loaded TP/SL rules from DB:", rules.map(r => `${r.mint}/${r.strategy} [walletId: ${r.walletId}]`));

      for (const rule of rules) {
        if (!rule.mint) continue;
        if (!(rule.tp && rule.tpPercent > 0) && !(rule.sl && rule.slPercent > 0)) continue;

        console.log(`🔍 Checking ${rule.mint} on walletId: ${rule.walletId} (${rule.strategy})`);

        try {
          const res = await checkAndTriggerTpSl(rule);

          if (res?.triggered) {
            console.log(`🎯 TRIGGERED: ${rule.mint} — ${res.type.toUpperCase()} (${res.changePct.toFixed(2)}%)`);

            await sendAlert(
              rule.userId || "web",
              `🎯 *TP/SL Triggered*\n\n` +
              `• Token: \`${rule.mint}\`\n` +
              `• Type: *${res.type.toUpperCase()}*\n` +
              `• Change: ${res.changePct.toFixed(2)}%\n` +
              (res.txHash ? `[View Transaction](https://explorer.solana.com/tx/${res.txHash}?cluster=mainnet-beta)` : ""),
              res.type === "tp" ? "TP" : "SL"
            );
          }
        } catch (err) {
          console.error(`❌ TP/SL error for ${rule.mint}:`, err.message);
        }
      }
    } catch (err) {
      console.error("❌ monitorTpSlWeb general error:", err.message);
    }
  }, INTERVAL_MS);
}

module.exports = { monitorTpSlWeb };
