// services/strategies/MonitorTpSl.web.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });

const prisma = require("../../prisma/prisma");
const { checkAndTriggerTpSl } = require("../tpSlExecutor");
const { sendAlert } = require("../../telegram/alerts");

// NEW: reuse the existing sell path used by TP/SL + manual
const { performManualSell } = require("../manualExecutor");
// NEW: price function for the optional min-PnL gate
const getTokenPrice = require("./paid_api/getTokenPrice");

const INTERVAL_MS = 15_000;
let tick = 0;

console.log("📊 Starting Web TP/SL monitor…");

function shortMint(m) { return `${m.slice(0,4)}…${m.slice(-4)}`; }
function secs(ms) { return Math.floor(ms / 1000); }

async function scanAndTriggerSmartExitTime() {
  // We’ll support both shapes:
  //  A) extras.smartExit.mode == "time"
  //  B) legacy extras.smartExitMode == "time"
  // For simplicity + performance, do two small queries (or you can OR them).
  const select = {
    id: true, mint: true, walletId: true, userId: true, strategy: true,
    walletLabel: true, entryPriceUSD: true, createdAt: true, timestamp: true,
    decimals: true, inputMint: true, outputMint: true, inAmount: true, outAmount: true,
    extras: true,
  };

  const [rowsNew, rowsLegacy] = await Promise.all([
    prisma.trade.findMany({
      where: {
        exitedAt: null,
        extras: { path: ["smartExit","mode"], equals: "time" }
      },
      select,
      orderBy: { timestamp: "asc" }
    }),
    prisma.trade.findMany({
      where: {
        exitedAt: null,
        extras: { path: ["smartExitMode"], equals: "time" }
      },
      select,
      orderBy: { timestamp: "asc" }
    }),
  ]);

  // De-dupe if the same row appears in both lists
  const map = new Map();
  for (const r of [...rowsNew, ...rowsLegacy]) map.set(r.id, r);
  const rows = [...map.values()];
  if (!rows.length) return;

  for (const r of rows) {
    // Normalize config (new nested structure preferred; fall back to legacy keys)
    const mode = r.extras?.smartExit?.mode ?? r.extras?.smartExitMode ?? "off";
    if (mode !== "time") continue;

    const maxHoldSec =
      r.extras?.smartExit?.time?.maxHoldSec ??
      r.extras?.timeMaxHoldSec ??
      0;
    if (!Number.isFinite(+maxHoldSec) || +maxHoldSec <= 0) continue;

    const minPnLGate =
      r.extras?.smartExit?.time?.minPnLBeforeTimeExitPct ??
      r.extras?.timeMinPnLBeforeTimeExitPct ??
      null;

    // Anchor to DB time so FE countdown == BE countdown
    const buyTs = new Date(r.timestamp || r.createdAt).getTime();
    const remaining = (+maxHoldSec) - secs(Date.now() - buyTs);
    if (remaining > 0) continue; // not due yet

    // Optional: enforce min PnL gate if provided
    if (minPnLGate != null && Number.isFinite(+minPnLGate) && +minPnLGate !== 0) {
      try {
        if (!r.entryPriceUSD) {
          console.warn(`[SE] skip ${shortMint(r.mint)}: missing entryPriceUSD for gate check`);
          continue;
        }
        const px = await getTokenPrice(r.userId, r.mint);
        if (!px || !Number.isFinite(+px)) {
          console.warn(`[SE] skip ${shortMint(r.mint)}: price unavailable`);
          continue;
        }
        const pnlPct = ((+px - +r.entryPriceUSD) / +r.entryPriceUSD) * 100;
        if (pnlPct < +minPnLGate) {
          console.log(`[SE] hold ${shortMint(r.mint)}: PnL ${pnlPct.toFixed(2)}% < gate ${minPnLGate}%`);
          continue;
        }
      } catch (err) {
        console.warn(`[SE] gate check failed for ${shortMint(r.mint)}:`, err.message);
        continue; // don’t fire if we can’t validate the gate
      }
    }

    // Idempotency: recheck still open right before selling
    const stillOpen = await prisma.trade.findFirst({
      where: { id: r.id, exitedAt: null },
      select: { id: true }
    });
    if (!stillOpen) continue;

    console.log(`🚀 [SE] TIME trigger → selling 100% for ${shortMint(r.mint)} (wallet ${r.walletId})`);

    try {
      await performManualSell({
        percent     : 1,
        mint        : r.mint,
        walletId    : r.walletId,
        userId      : r.userId,
        strategy    : r.strategy,
        walletLabel : r.walletLabel,
        triggerType : "smart_time",
        slippage    : 0.5
      });

      // Optional: alert (performManualSell alerts by default; add one here if you want a Smart-Exit specific tag)
      // await sendAlert(r.userId, `⏰ Smart-Exit TIME executed for ${shortMint(r.mint)}`, "SMART-EXIT");

    } catch (err) {
      console.error(`❌ [SE] sell failed for ${shortMint(r.mint)}:`, err.message);
      // Don’t crash; next tick will retry while it’s still open
    }
  }
}

function monitorTpSlWeb() {
  console.log("📊 Web TP/SL monitor running...");

  setInterval(async () => {
    tick++;
    console.log(`\n🔁 [Tick ${tick}] TP/SL + Smart-Exit scan at ${new Date().toLocaleTimeString()}`);

    try {
      // ── TP/SL scan (existing)
      const rules = await prisma.tpSlRule.findMany({
        where: { enabled: true, status: "active" },
        orderBy: { createdAt: "asc" }
      });
      console.log("📦 Loaded TP/SL rules:", rules.map(r => `${r.mint}/${r.strategy} [walletId:${r.walletId}]`));

      for (const rule of rules) {
        if (!rule.mint) continue;
        if (!(rule.tp && rule.tpPercent > 0) && !(rule.sl && rule.slPercent > 0)) continue;

        try {
          const res = await checkAndTriggerTpSl(rule);
          if (res?.triggered) {
            console.log(`🎯 TRIGGERED: ${rule.mint} — ${res.type.toUpperCase()} (${res.changePct.toFixed(2)}%)`);
            await sendAlert(
              rule.userId || "web",
              `🎯 *TP/SL Triggered*\n\n` +
              `• Token: \`${rule.mint}\`\n` +
              `• Type: *${res.type.toUpperCase()}*\n` +
              `• Change: ${res.changePct.toFixed(2)}%`,
              res.type === "tp" ? "TP" : "SL"
            );
          }
        } catch (err) {
          console.error(`❌ TP/SL error for ${rule.mint}:`, err.message);
        }
      }

      // ── Smart-Exit TIME scan (new)
      await scanAndTriggerSmartExitTime();

    } catch (err) {
      console.error("❌ monitorTpSlWeb general error:", err.message);
    }
  }, INTERVAL_MS);
}

module.exports = { monitorTpSlWeb };
