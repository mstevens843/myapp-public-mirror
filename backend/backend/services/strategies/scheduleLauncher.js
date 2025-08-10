/* =====================================================================
 *  Scheduled Smart-Buy Strategy  (aka “scheduledHybrid”)
 *  -------------------------------------------------------
 *  • Time-triggered sniper-lite bot
 *  • Two modes:
 *      1. “interval”  – buys every N seconds, spending a SOL / USDC amount
 *      2. “limit”     – waits for USD price targets, spending USD amounts
 *  • For limit mode USD → SOL/USDC conversion happens *right* before buy
 *  • Now with richer, Sniper-style logs for a guided UX
 *  • 2025-08-03  — adds expiry-per-row, executed/expired tracking,
 *                  summary logging, and optional execution throttle
 *  • 2025-08-03b — + multi-hit ladder, fail-reset, balance guard,
 *                  Birdeye back-off, optional minPriceUsd
 * ===================================================================*/

const fs   = require("fs");
const uuid = require("uuid").v4;

/* ── deps ─────────────────────────────────────────────────────────── */
const prisma                     = require("../../prisma/prisma");
const { strategyLog }            = require("./logging/strategyLogger");
const { createSummary, tradeExecuted } = require("./core/alerts");
const runLoop                    = require("./core/loopDriver");
const wm                         = require("./core/walletManager");
const { getSafeQuote }           = require("./core/quoteHelper");
const { liveBuy, simulateBuy }   = require("./core/tradeExecutor");
const getTokenPrice              = require("./paid_api/getTokenPrice");
const guards                     = require("./core/tradeGuards");
const {
  lastTickTimestamps,
  runningProcesses,
} = require("../utils/strategy_utils/activeStrategyTracker");
const { fullCleanup } = require("./core/scheduleStrategyCleanup");

/* ── constants ────────────────────────────────────────────────────── */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT  = "So11111111111111111111111111111111111111112";
const MIN_BALANCE_SOL      = 0.05;      // hard floor for safety
const MIN_EXEC_GAP_MS      = 3_000;     // 🔒 anti-overlap throttle (configurable)

/* ===================================================================*/
module.exports = async function scheduleLauncher(botCfg = {}) {
  const botId   = botCfg.botId || `manual-scheduled-${uuid()}`;
  const log     = strategyLog("scheduleLauncher", botId, botCfg);
  const summary = createSummary("Scheduled", log, botCfg.userId);

  /* ── resolve timing ────────────────────────────────────────────── */
  const isRestart     = botCfg.isRestart === true;
  const START_TIME_MS = botCfg.startTime ? new Date(botCfg.startTime).getTime() : NaN;
  const NOW_MS        = Date.now();
  const WARMUP_OFFSET = 10 * 60 * 1_000;
  const READY_TIME_MS = START_TIME_MS - WARMUP_OFFSET;

  if (!isRestart && (Number.isNaN(START_TIME_MS) || START_TIME_MS <= NOW_MS)) {
    log("error", "startTime missing or in the past – aborting");
    throw new Error("Invalid startTime for scheduled bot");
  }

  /* ── mode detection ────────────────────────────────────────────── */
  const MODE_LIMIT    = Array.isArray(botCfg.limitConfigs) && botCfg.limitConfigs.length > 0;
  const MODE_INTERVAL = !MODE_LIMIT;
  log("info", `🗓️ Scheduler launch started – mode: ${MODE_LIMIT ? "LIMIT" : "INTERVAL"}`);

  /* ── shared config ─────────────────────────────────────────────── */
  const BASE_MINT    = botCfg.buyWithUSDC ? USDC_MINT : SOL_MINT;
  const OUTPUT_MINT  = botCfg.outputMint;   
  const SLIPPAGE     = +botCfg.slippage      || 1.0;
  const MAX_SLIPPAGE = +botCfg.maxSlippage   || 0.25;
  const HALT_ON_FAILS= +botCfg.haltOnFailures|| 3;
  const PRIORITY_FEE = +botCfg.priorityFeeLamports || 0;
  const DRY_RUN      = botCfg.dryRun === true;
  const execBuy      = DRY_RUN ? simulateBuy : liveBuy;
  const EXEC_GAP_MS  = +botCfg.minExecGapMs || MIN_EXEC_GAP_MS;

  log("info", `[CONFIG] OUTPUT_MINT=${OUTPUT_MINT}, SLIPPAGE=${SLIPPAGE}, MAX_SLIPPAGE=${MAX_SLIPPAGE}, PRIORITY_FEE=${PRIORITY_FEE}`);

  /* (INTERVAL_MS is set later – needs LIMIT_CFGS for dynamic) */

 let AMOUNT_LAMPORTS_INTERVAL = null;
 if (MODE_INTERVAL) {
   const perTradeAmount = (+botCfg.amountToSpend || 0) / (+botCfg.maxTrades || 1);
   AMOUNT_LAMPORTS_INTERVAL = Math.round(
     perTradeAmount * (BASE_MINT === USDC_MINT ? 1e6 : 1e9)
   );
  if (!AMOUNT_LAMPORTS_INTERVAL || AMOUNT_LAMPORTS_INTERVAL < 10_000) {
     log("error", `Per-trade amount too low (${perTradeAmount}) – aborting`);
     throw new Error("Per-trade amount too small...");
   }
 }


  /* ── limit-mode specifics ─────────────────────────────────────── */
  const LIMIT_CFGS = MODE_LIMIT
    ? botCfg.limitConfigs
        .map(({ price, amount, expiresInHours, minPriceUsd }) => {
          const now      = Date.now();
          const expiryMs = expiresInHours ? now + expiresInHours * 3_600_000 : null;
          return {
            priceUsd      : +price,
            amountUsd     : +amount,
            minPriceUsd   : minPriceUsd != null ? +minPriceUsd : null, // optional low-bound
            expiryAt      : expiryMs,
            hit           : false,
            executedAt    : null,
            txSig         : null,
            expired       : false,
          };
        })
        .filter(c => !Number.isNaN(c.priceUsd) && !Number.isNaN(c.amountUsd))
    : [];

    /* ——— global safety floor (lowest non-null minPriceUsd) ——— */
const PRICE_FLOOR =
  LIMIT_CFGS.reduce(
    (acc, cfg) =>
      cfg.minPriceUsd != null && cfg.minPriceUsd < acc ? cfg.minPriceUsd : acc,
    Infinity
  ); // Infinity = no floor set

  const MAX_TRADES = MODE_LIMIT ? LIMIT_CFGS.length : (+botCfg.maxTrades || 1);

  const maxExpiryHrs = Math.max(
    ...LIMIT_CFGS.map(cfg =>
      cfg.expiryAt ? (cfg.expiryAt - Date.now()) / 3_600_000 : 1
    )
  );

  /* ── interval-mode specifics (dynamic for LIMIT) ─────────────── */
  const INTERVAL_MS = MODE_LIMIT
    ? maxExpiryHrs <= 1   ? 20_000
      : maxExpiryHrs <= 6 ? 60_000
      : maxExpiryHrs <=12 ? 300_000
      : maxExpiryHrs <=24 ? 600_000
      : 900_000
    : Math.round((+botCfg.interval || 30) * 1_000);

  if (MODE_INTERVAL) log("info", `⏳ Interval countdown set to ${(INTERVAL_MS/1000).toFixed(0)} s`);

  /* ── bookkeeping ─────────────────────────────────────────────── */
  let trades = 0, fails = 0, lastExecutionTime = 0;
  let consecutivePriceFails = 0;   // 🔄 back-off counter

  /* ── warm-up phase / wallet init ─────────────────────────────── */
  if (!isRestart && NOW_MS < READY_TIME_MS) {
    const ms = READY_TIME_MS - NOW_MS;
    log("info", `🕓 Warm-up phase — waiting ${(ms/1000/60).toFixed(1)} min`);
    await new Promise(r => setTimeout(r, ms));
  }
  await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);

  /* ── start countdown to launch ───────────────────────────────── */
  const keepAlive = setInterval(() => {
    lastTickTimestamps[botId] = Date.now();
  }, 15_000);

  if (!isRestart) {
    const msToLaunch = START_TIME_MS - Date.now();
    if (msToLaunch > 0) {
      log("info", `⌛ Launching in ${(msToLaunch/1000).toFixed(1)} s…`);
      await new Promise(r => setTimeout(r, msToLaunch));
    }
  }
  log("info", `🚀 Scheduled Smart-Buy ACTIVE (${MODE_LIMIT ? "LIMIT" : "INTERVAL"} mode)`);

  /* ── tick loop ───────────────────────────────────────────────── */
  async function tick() {
    if (trades >= MAX_TRADES) return finish("max-trades reached");
    if (fails  >= HALT_ON_FAILS) return finish("error cap hit");
    if (Date.now() - lastExecutionTime < EXEC_GAP_MS) return;

    lastTickTimestamps[botId] = Date.now();
    log("loop", `Tick @ ${new Date().toLocaleTimeString()} (trade #${trades + 1})`);

    /* ───────────── LIMIT MODE ───────────── */
    if (MODE_LIMIT) {
      /* expire rows */
      for (const cfg of LIMIT_CFGS) {
        if (!cfg.hit && !cfg.expired && cfg.expiryAt && Date.now() >= cfg.expiryAt) {
          cfg.expired = true;
          summary.inc("expired");
          log("summary", `[SUMMARY] Limit @$${cfg.priceUsd} – Expired ❌`);
        }
      }

      /* price fetch with back-off */
      const curUsd = await getTokenPrice(botCfg.userId, OUTPUT_MINT);
      if (curUsd == null) {
        consecutivePriceFails++;
        const delay = Math.min(consecutivePriceFails, 5) * 5_000;
        log("warn", `Price unavailable – back-off ${delay/1000}s`);
        await new Promise(r => setTimeout(r, delay));
        fails++;
        return;
      }
      consecutivePriceFails = 0;

      /* ——— rug-safety hard stop ——— */
      if (PRICE_FLOOR !== Infinity && curUsd < PRICE_FLOOR) {
        log(
          "warn",
          `⛔ Price $${curUsd.toFixed(6)} breached safety floor $${PRICE_FLOOR} — HARD STOP`
        );
        await finish("price breach – possible rug");      // logs + cleanup
        return;                                           // ensure no further logic runs
      }
      log("info", `💲 Current price: $${curUsd.toFixed(6)}`);

      const activeTiers = LIMIT_CFGS
        .filter(c =>
          !c.hit &&
          !c.expired &&
          (c.minPriceUsd == null || curUsd >= c.minPriceUsd)
        )
        .map(c => `$${c.priceUsd}`)
        .join(", ");

      log("info", `📈 Awaiting targets at or below: ${activeTiers || "(none)"}`);

      const nextTier = LIMIT_CFGS
  .filter(c => !c.hit && !c.expired)
  .sort((a, b) => a.priceUsd - b.priceUsd)[0];

if (nextTier) {
  log("info", `🔭 Nearest target: $${nextTier.priceUsd} (need drop of ~$${(curUsd - nextTier.priceUsd).toFixed(6)})`);
}

      /* match all eligible tiers */
      const targets = LIMIT_CFGS
        .filter(c =>
          !c.hit &&
          !c.expired &&
          curUsd <= c.priceUsd &&
          (c.minPriceUsd == null || curUsd >= c.minPriceUsd)
        )
        .sort((a, b) => b.priceUsd - a.priceUsd);

      if (targets.length === 0) {
        log("info", "Awaiting target…");
        return;
      }

      for (const cfg of targets) {
        if (trades >= MAX_TRADES) break;
        // if (Date.now() - lastExecutionTime < EXEC_GAP_MS) break;
           // new: respect the throttle, but stay in the loop
           const sinceLast = Date.now() - lastExecutionTime;
           if (sinceLast < EXEC_GAP_MS) {
             await new Promise(r => setTimeout(r, EXEC_GAP_MS - sinceLast));
           }


        cfg.hit = true;
        log("info", `🎯 Target $${cfg.priceUsd} reached – attempting buy`);

        /* lamports calc */
        let lamports;
        if (BASE_MINT === SOL_MINT) {
          const solUsd = await getTokenPrice(botCfg.userId, SOL_MINT);
          if (!solUsd) { log("error", "SOL/USD price unavailable"); fails++; cfg.hit = false; continue; }
          lamports = Math.round((cfg.amountUsd / solUsd) * 1e9);
        } else {
          lamports = Math.round(cfg.amountUsd * 1e6);
        }
        if (lamports <= 0) {
          log("error", "Calculated lamports ≤ 0 – skipping");
          cfg.hit = false;
          fails++;
          continue;
        }

        /* balance guard */
        const bal = await wm.getSpendableBalance?.(botCfg.walletId, BASE_MINT);
        if (bal != null && bal < lamports + 5_000) {
          log("warn", "💸 Insufficient balance – skipping this ladder step");
          cfg.hit = false;
          continue;
        }

        await executeTrade(lamports, curUsd, cfg);
      }

      return;
    }

    /* ───────────── INTERVAL MODE ───────────── */
    log("info", `⏱️ Countdown ${(INTERVAL_MS/1000).toFixed(0)} s elapsed – attempting buy`);
    await executeTrade(AMOUNT_LAMPORTS_INTERVAL, null, null);
  }

  /* ── trade helper ───────────────────────── */
  async function executeTrade(amountLamports, priceAtTrigger = null, cfgRef = null) {
    guards.assertOpenTradeCap?.("scheduled", botId, 9999);

    log("info", `🔍 Fetching quote – in: ${BASE_MINT}, out: ${OUTPUT_MINT}, lamports: ${amountLamports}`);
    let qr;
    try {
      qr = await getSafeQuote({
        inputMint    : BASE_MINT,
        outputMint   : OUTPUT_MINT,
        amount       : amountLamports,
        slippage     : SLIPPAGE,
        maxImpactPct : MAX_SLIPPAGE,
      });
    } catch (err) {
      log("error", `Quote error: ${err.message}`);
      if (cfgRef) cfgRef.hit = false;          // allow retry
      fails++; summary.inc("quoteFail"); return;
    }

    if (!qr.ok) {
      log("warn", `Quote rejected – ${qr.reason || qr.message}`);
      if (cfgRef) cfgRef.hit = false;
      fails++; summary.inc("quoteFail"); return;
    }

    const quote = qr.quote;
    log("info", `Quote received – priceImpact ${(quote.priceImpactPct*100).toFixed(2)}%`);

    if (PRIORITY_FEE > 0) {
      quote.prioritizationFeeLamports = PRIORITY_FEE;
      log("info", `Adding priority fee of ${PRIORITY_FEE} lamports`);
    }

    const MODE_NAME = MODE_LIMIT ? "Limit" : "Interval";


    try {
      const meta = {
        strategy : `Scheduled-${MODE_NAME}`,
        walletId : botCfg.walletId,
        userId   : botCfg.userId,
        slippage : SLIPPAGE,
        category : "Scheduled",
        tpPercent: botCfg.tpPercent,
        slPercent: botCfg.slPercent,
        tp       : botCfg.takeProfit,
        sl       : botCfg.stopLoss,
        priorityFeeLamports: PRIORITY_FEE,
        botId,
        openTradeExtras: { strategy: "scheduled" },
      };

      log("info", "[🚀 BUY ATTEMPT] Executing trade…");
      const txHash = await execBuy({ quote, mint: OUTPUT_MINT, meta });

      const usdPrice =
        priceAtTrigger ?? (OUTPUT_MINT ? await getTokenPrice(botCfg.userId, OUTPUT_MINT) : null);

      const spentFmt = BASE_MINT === SOL_MINT
        ? `${(amountLamports/1e9).toFixed(3)} SOL`
        : `${(amountLamports/1e6).toFixed(2)} USDC`;

      log("info", `[🎆 BOUGHT SUCCESS] – ${OUTPUT_MINT} at ~$${(usdPrice||0).toFixed(6)} for ${spentFmt}`);

      trades++; summary.inc("buys");
       if (runningProcesses[botId]) {
         runningProcesses[botId].tradesExecuted = trades;   // 🔥 keep UI in sync
       }

      lastExecutionTime = Date.now();
      if (cfgRef) {
        cfgRef.executedAt = new Date();
        cfgRef.txSig      = txHash;
      }

      await tradeExecuted({
        userId       : botCfg.userId,
        mint         : OUTPUT_MINT,
        amountFmt    : spentFmt,
        usdValue     : usdPrice
          ? ((BASE_MINT === SOL_MINT
              ? amountLamports/1e9
              : amountLamports/1e6) * usdPrice).toFixed(2)
          : null,
        entryPriceUSD: usdPrice,
        impactPct    : quote.priceImpactPct * 100,
        wl           : botCfg.walletLabel || "default",
        tx           : txHash,
        category     : "Scheduled",
        simulated    : DRY_RUN,
        botId,
      });

      log("summary", `✅ Trade ${trades}/${MAX_TRADES} executed`);

      if (trades >= MAX_TRADES) await finish("max-trades reached");
    } catch (err) {
      log("error", `execBuy failed: ${err.message}`);
      if (cfgRef) cfgRef.hit = false;
      fails++; summary.inc("execBuyFail"); summary.inc("errors");
    }
  }

  /* ── finish helper ───────────────────────── */
  async function finish(reason) {
    if (MODE_LIMIT) {
      LIMIT_CFGS.forEach(c => {
        const status = c.hit
          ? `Executed ✅ (Spent: $${c.amountUsd})`
          : c.expired
            ? "Expired ❌"
            : "Not hit ❌";
        log("summary", `[SUMMARY] Limit @$${c.priceUsd} – ${status}`);
      });
    }

    log("info", `🛑 Scheduled bot finished – ${reason}`);
    await summary.printAndAlert("Scheduled Smart-Buy");

    clearInterval(loopHandle);
    clearInterval(keepAlive);
    if (runningProcesses[botId]) runningProcesses[botId].finished = true;
    delete lastTickTimestamps[botId];

    try { await prisma.strategyRunStatus.deleteMany({ where: { botId } }); } catch {}
    await fullCleanup(botId);
    try { await prisma.$disconnect(); } catch {}

    try {
      const jobId = botId.replace("scheduleLauncher-", "");
      await prisma.scheduledStrategy.update({
        where: { id: jobId },
        data : { status: "completed", finishedAt: new Date() },
      });
    } catch {}

    process.exit(0);
  }

  /* ── kick-off loop ───────────────────────── */
  const loopHandle = runLoop(tick, INTERVAL_MS, { label: "scheduled", botId });
  runningProcesses[botId] = { mode: "scheduled", proc: loopHandle };
};

/* ── CLI helper ───────────────────────────── */
if (require.main === module) {
  const fp = process.argv[2];
  if (!fp || !fs.existsSync(fp)) {
    console.error("❌ Usage: node scheduleLauncher.js <path/to/config.json>");
    process.exit(1);
  }
  module.exports(JSON.parse(fs.readFileSync(fp, "utf8")));
}