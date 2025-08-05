/* stealthBot.js – simple “split buy” across many wallets
   - one target token
   - same SOL size for each wallet
   - fires every ROT_MS if loop ≠ false (can be 0 for “buy once”) */

const { Connection, PublicKey } = require("@solana/web3.js");
const prisma                   = require("../../prisma/prisma");
const fs                       = require("fs");
const { strategyLog }          = require("./logging/strategyLogger");
const { createSummary, tradeExecuted }        = require("./core/alerts");
const wm                       = require("./core/walletManager");
const guards                   = require("./core/tradeGuards");
const { getSafeQuote } = require("./core/quoteHelper");
const { liveBuy, simulateBuy } = require("./core/tradeExecutor");
const { isSafeToBuyDetailed } = require("../utils/safety/safetyCheckers/botIsSafeToBuy");
const { logSafetyResults } = require("./logging/logSafetyResults");
// const { initTxWatcher }        = require("./core/txTracker");
const {
  lastTickTimestamps,
  runningProcesses,
}                               = require("../utils/strategy_utils/activeStrategyTracker");
const { getWalletBalance, isAboveMinBalance } = require("../utils");

module.exports = async function stealthBot(cfg = {}) {
  if (!cfg.tokenMint) {
    console.error("stealthBot: cfg.tokenMint is required");
    return;
  }
  if (!Array.isArray(cfg.wallets) || !cfg.wallets.length) {
    console.error("stealthBot: cfg.wallets[] is required");
    return;
  }

  /* ───── basic constants ───── */
  const botId        = cfg.botId || "manual-stealth";
  const log          = strategyLog("stealthbot", botId, cfg);
  const summary      = createSummary("StealthBot", log, cfg.userId);

  /* ── load & decrypt wallets from DB (post‑migration) ── */
  const walletIdByLabel = {};
  try {
    const walletRows = await prisma.wallet.findMany({
      where: { userId: cfg.userId, label: { in: cfg.wallets.map(w => typeof w === "string" ? w : w.label) } },
      select: { id: true, label: true }
    });

    await wm.initRotationWallets(cfg.userId, walletRows.map(w => w.id));
    walletRows.forEach(w => walletIdByLabel[w.label] = w.id);
  } catch (err) {
    console.error("❌ stealthBot wallet bootstrap failed:", err.message);
    return;
  }

  const loadedWallets = wm.all();
  console.log(`✅ Loaded ${loadedWallets.length} wallets`);

  const conn         = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    "confirmed"
  );

  const ROT_MS        = +cfg.rotationInterval || 0;                 // 0 = run once
  const POS_LAMPORTS  = (+cfg.positionSize || 0.02) * 1e9;
  const SIZE_JITTER   = (+cfg.sizeJitterPct || 0) / 100;            // 0–1
  const DELAY_MIN_MS  = +cfg.delayMinMs || 0;
  const DELAY_MAX_MS  = +cfg.delayMaxMs || 0;                       // per-wallet delay
  const SLIPPAGE      = +cfg.slippage || 0.5;
  const MAX_IMPACT    = +cfg.maxSlippage || 0.25;
  const MAX_DAILY_SOL = +cfg.maxDailyVolume || 100;
  const TAKE_PROFIT   = +cfg.takeProfit || 0;
  const STOP_LOSS     = +cfg.stopLoss   || 0;
  const HALT_FAILS    = +cfg.haltOnFailures || 4;
  const DRY_RUN       = cfg.dryRun === true;
  const execTrade     = DRY_RUN ? simulateBuy : liveBuy;

  // initTxWatcher("StealthBot");

  let fails = 0,
      todaySol = 0,
      rounds = 0;

  async function tick() {
    try {
      const loaded = wm.all(); // get all loaded Keypairs
      log("info", `🧰 Loaded ${loaded.length} wallets:`);
      loaded.forEach((kp, idx) =>
        log("info", `   wallet-${idx + 1}: ${kp.publicKey.toBase58()}`)
      );

      lastTickTimestamps[botId] = Date.now();
      log("loop", `Tick  #${rounds + 1}`);

      for (const w of cfg.wallets) {
        const label  = typeof w === "string" ? w : w.label;
        log("debug", `Checking wallet: ${label}`);
        const wallet = wm.byLabel(label);
        if (!wallet) {
          log("warn", `[${label}] not loaded`);
          continue;
        }

        const hasBalance = await wm.ensureMinBalance(
          0.05,
          getWalletBalance,
          isAboveMinBalance,
          wallet
        );
        if (!hasBalance) {
          log("warn", `[${label}] low SOL — skip`);
          continue;
        }

        /* daily‑limit guard */
        guards.assertDailyLimit(POS_LAMPORTS / 1e9, todaySol, MAX_DAILY_SOL);

        /* random delay per wallet */
        if (DELAY_MAX_MS > 0) {
          const wait =
            Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS) + DELAY_MIN_MS;
          await new Promise((r) => setTimeout(r, wait));
        }

        /* per‑wallet spend with jitter */
        const jitterFactor = 1 + (Math.random() * 2 - 1) * SIZE_JITTER; // ±pct
        const spendLamports = Math.round(POS_LAMPORTS * jitterFactor);

        /* quote + buy */
        const { ok, quote } = await getSafeQuote({
          inputMint: "So11111111111111111111111111111111111111112", // SOL
          outputMint: cfg.tokenMint,
          amount: spendLamports,
          slippage: SLIPPAGE,
          maxImpactPct: MAX_IMPACT,
        });
        if (!ok) {
          summary.inc("quoteFail");
          continue;
        }

        if (!cfg.disableSafety && cfg.safetyChecks) {
          const safeRes = await isSafeToBuyDetailed(cfg.tokenMint, cfg.safetyChecks || {});
          if (logSafetyResults(cfg.tokenMint, safeRes, log, "stealthbot")) continue;
        }



        log("info", "[🚀 BUY ATTEMPT] Executing stealth split-buy…");
        await execTrade({
          quote,
          mint: cfg.tokenMint,
          meta: {
            strategy   : "Stealth Bot",
            walletId   : walletIdByLabel[label],     // 🆕  per‑wallet ID
            userId     : cfg.userId,
            slippage   : SLIPPAGE,
            category   : "stealthbot",
            tpPercent  : cfg.tpPercent ?? TAKE_PROFIT,
            slPercent  : cfg.slPercent ?? STOP_LOSS,
           tp         : cfg.takeProfit,
            sl         : cfg.stopLoss,
            openTradeExtras: { strategy: "stealth" },
          },
        });
        

        log(
          "info",
          `🥷 [${label}] bought ${(spendLamports / 1e9).toFixed(3)} SOL of ${cfg.tokenMint.slice(
            0,
            4
          )}…`
        );

       const statsLine =
          `[STATS] impact=${(quote.priceImpactPct * 100).toFixed(2)}% ` +
          `spentSOL=${(spendLamports / 1e9).toFixed(3)}`;
        log("info", statsLine);

        /* optional Telegram ping (comment out if you don’t want it) */
        await tradeExecuted({
          userId     : cfg.userId,
          mint       : cfg.tokenMint,
          wl         : label || "default",
          category   : "StealthBot",
          simulated  : DRY_RUN,
          amountFmt  : `${(spendLamports / 1e9).toFixed(3)} SOL`,
          impactPct  : null,                // add if available
          usdValue   : null,                // add if available
          entryPriceUSD : null,            
          tpPercent  : null,
          slPercent  : null,
        });
 
        todaySol += spendLamports / 1e9;
        summary.inc("buys"); 
        /* emit mini‑event for UI */
        process.emit("stealthbot:stat", {
          botId,
          wallet: label,
          spend: spendLamports,
          ts: Date.now(),
          ok: true,
        });
      }

      fails = 0;
      rounds++;
      summary.inc("rounds");
    } catch (err) {
      fails++;
      summary.inc("errors");
      log("error", err.message);
      if (fails >= HALT_FAILS) return hardStop("error limit reached");
    }

    if (cfg.loop === false || ROT_MS === 0) return hardStop("completed");
    setTimeout(tick, ROT_MS);
  }

  const hardStop = async (reason) => {
    /* treat “completed” as success, everything else as error */
    const lvl   = reason === "completed" ? "summary" : "error";
    const emoji = reason === "completed" ? "✅" : "🛑";

    log(lvl, `${emoji} StealthBot ${reason}`);

    /* pretty one-liner summary to console & Telegram */
    await summary.printAndAlert(
      reason === "completed"
        ? "StealthBot run completed"
        : `StealthBot halted: ${reason}`
    );
  }

  await tick();
  log("summary", "✅ StealthBot completed (single-shot)");
};

/* ─── CLI helper (unchanged) ─── */
if (require.main === module) {
  const fp = process.argv[2];
  if (!fp || !fs.existsSync(fp)) {
    console.error("Pass config path");
    process.exit(1);
  }
  module.exports(JSON.parse(fs.readFileSync(fp, "utf8")));
}
