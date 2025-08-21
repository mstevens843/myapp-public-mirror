/* Breakout v2 – parity-upgraded (Sniper/DipBuyer style) */
const fs = require("fs");
// const pLimit = require("p-limit");
// const limitBirdeye = pLimit(2);   // 2 concurrent
const pLimit = require("p-limit");
const prisma = require("../../prisma/prisma");
const { v4: uuid } = require("uuid");
/* paid API helpers */
const getTokenShortTermChange = require("./paid_api/getTokenShortTermChanges");
const getTokenCreationTime    = require("./paid_api/getTokenCreationTime");
const resolveTokenFeed        = require("./paid_api/tokenFeedResolver");

/* safety + logging */
const { isSafeToBuyDetailed } = require("../utils/safety/safetyCheckers/botIsSafeToBuy");
const { logSafetyResults }    = require("./logging/logSafetyResults");
const { strategyLog }         = require("./logging/strategyLogger");
const { lastTickTimestamps, runningProcesses }
      = require("../utils/strategy_utils/activeStrategyTracker");

/* ── core helpers ─────────────────────────────────────── */
const wm                       = require("./core/walletManager");
const guards                   = require("./core/tradeGuards");
const createCooldown           = require("./core/cooldown");
const { getSafeQuote } = require("./core/quoteHelper");
// Extend tradeExecutor imports with additional execution shapes.  These
// functions preserve the existing single-shot semantics when
// executionShape is undefined.
const {
  liveBuy,
  simulateBuy,
  executeTWAP,
  executeAtomicScalp,
} = require("./core/tradeExecutor");
const { passes, explainFilterFail }               = require("./core/passes");
const { createSummary, tradeExecuted }        = require("./core/alerts");
const runLoop                  = require("./core/loopDriver");
const { initTxWatcher }        = require("./core/txTracker");

/* misc utils still needed directly */
const {
  getWalletBalance,
  isAboveMinBalance,
} = require("../utils");
const registerTpSl       = require("./core/tpSlRegistry");
/* constants */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT  = "So11111111111111111111111111111111111111112";

// ----------------------------------------------------------------------
// Extended helper imports
//
// When additional execution shapes or risk policies are enabled for
// breakout mode, the modules below provide stub implementations.  They
// are optional: unless botCfg.useSignals or botCfg.executionShape are
// supplied by the UI, they will not impact performance.
const breakoutSignals = require("./core/signals/breakout");
const breakoutRisk    = require("./core/risk/breakoutPolicy");

/* ──────────────────────────────────────────────────── */
module.exports = async function breakoutStrategy(botCfg = {}) {
  const limitBirdeye = pLimit(2);
  const botId = botCfg.botId || "manual";
  const log   = strategyLog("breakout", botId, botCfg);

  /* ── config ─────────────────────────────────────────── */
  const BASE_MINT        = botCfg.buyWithUSDC ? USDC_MINT : (botCfg.inputMint || SOL_MINT);
  const LIMIT_USD        = +botCfg.targetPriceUSD || null;
  const SNIPE_LAMPORTS   = (+botCfg.snipeAmount || +botCfg.amountToSpend || 0) *
                           (BASE_MINT === USDC_MINT ? 1e6 : 1e9);
  const ENTRY_THRESHOLD  = (+botCfg.entryThreshold >= 1
                              ? +botCfg.entryThreshold / 100
                              : +botCfg.entryThreshold) || 0.03;
  const VOLUME_THRESHOLD = +botCfg.volumeThreshold || 50_000;
  const SLIPPAGE         = +botCfg.slippage        || 1.0;
  const MAX_SLIPPAGE     = +botCfg.maxSlippage     || 0.15;
  const INTERVAL_MS      = Math.round((+botCfg.interval || 30) * 1_000);
  const TAKE_PROFIT      = +botCfg.takeProfit      || 0;
  const STOP_LOSS        = +botCfg.stopLoss        || 0;
  const MAX_DAILY_SOL    = +botCfg.maxDailyVolume  || 9999;
  const MAX_OPEN_TRADES  = +botCfg.maxOpenTrades   || 9999;
  const MAX_TRADES       = +botCfg.maxTrades       || 9999;
  const HALT_ON_FAILS    = +botCfg.haltOnFailures  || 3;
  const MIN_BALANCE_SOL = 0.05; 
  const MAX_TOKEN_AGE_MIN= botCfg.maxTokenAgeMinutes != null
                              ? +botCfg.maxTokenAgeMinutes
                              : null;
  const MIN_TOKEN_AGE_MIN= botCfg.minTokenAgeMinutes != null
                              ? +botCfg.minTokenAgeMinutes
                              : null;

  const MIN_MARKET_CAP   = botCfg.minMarketCap != null ? +botCfg.minMarketCap : null;
  const MAX_MARKET_CAP   = botCfg.maxMarketCap != null ? +botCfg.maxMarketCap : null;
  const DRY_RUN          = botCfg.dryRun === true;
  const execBuy = DRY_RUN ? simulateBuy : liveBuy;
  const COOLDOWN_MS    = botCfg.cooldown != null
    ? +botCfg.cooldown * 1000            // UI sends SECONDS
    : 60_000;                            // fallback: 60 000 ms 
    
  // ── universal mode extensions ─────────────────────────
  const DIP_THRESHOLD = +botCfg.dipThreshold || 0;  // < 0 triggers dip mode
  const dipMode = DIP_THRESHOLD > 0;

  const DELAY_MS = +botCfg.delayBeforeBuyMs || 0;
  const PRIORITY_FEE = +botCfg.priorityFeeLamports || 0;

  const VOLUME_SPIKE = +botCfg.volumeSpikeMult || 0;

  // ── NEW: volatility breakout options (feature-flagged) ─────────────────
  const useVolatilityBreakout = botCfg.useVolatilityBreakout === true;
  const volatilityOpts = {
    squeezeThreshold   : +botCfg.squeezeThreshold || 0.002, // 0.2% band width
    expansionMultiplier: +botCfg.expansionMultiplier || 2.0,
    squeezeLookback    : +botCfg.squeezeLookback || 10,     // last N candles
    minVolumeSurge     : +botCfg.minVolumeSurge || 2.0,     // × baseline
  };

  // ── NEW: additional gates (all optional) ───────────────────────────────
  const maxPriceImpactPct = (botCfg.maxPriceImpactPct != null)
    ? +botCfg.maxPriceImpactPct
    : null; // extra guard on top of maxImpactPct in quote
  const fakeoutCooldownMs = (botCfg.fakeoutCooldownMs != null)
    ? +botCfg.fakeoutCooldownMs
    : 30 * 60 * 1000; // default 30m
  const timeOfDayFilter = botCfg.timeOfDayFilter || null; // { start:"HH:MM", end:"HH:MM" }

  /* safety toggle */
const SAFETY_DISABLED =
  botCfg.safetyEnabled === false ||    // NEW explicit master toggle
  botCfg.disableSafety === true ||     // legacy support
  (botCfg.safetyChecks &&
   Object.keys(botCfg.safetyChecks).length > 0 &&
   Object.values(botCfg.safetyChecks).every(v => v === false));

  const snipedMints = new Set();

  /* ── bootstrap ─────────────────────────────────────── */
  log("info", `🔗 Loading single wallet from DB (walletId: ${botCfg.walletId})`);
  await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
  const cd        = createCooldown(COOLDOWN_MS);
  const summary   = createSummary("Breakout", log, botCfg.userId);
  let   todaySol  = 0;
  let   trades    = 0;
  let   fails     = 0;
  /* start background confirmation loop (non-blocking) */
  initTxWatcher("Breakout");

  /* ── tick ─────────────────────────────────────────── */
  async function tick() {
    if (trades >= MAX_TRADES) return;
    const pumpWin = botCfg.priceWindow  || "5m";
    const volWin  = botCfg.volumeWindow || "1h";
    
    log("loop", `\nBreakout Tick @ ${new Date().toLocaleTimeString()}`);
    lastTickTimestamps[botId] = Date.now();

    // If enabled by the UI, precompute custom breakout signals.  The
    // helper is synchronous and should be wrapped in a try/catch to
    // avoid disrupting the main loop.  Configuration is not passed
    // into the signal generator; it should operate on cached state.
    if (botCfg?.useSignals) {
      try {
        breakoutSignals({});
      } catch (_) {
        /* swallow errors silently to preserve loop integrity */
      }
    }

    /* NEW: stop instantly if we already blew past the fail cap */
    if (fails >= HALT_ON_FAILS) {
      log("error", "🛑 halted (too many errors)");
      await summary.printAndAlert("Breakout halted on errors");
      if (runningProcesses[botId]) runningProcesses[botId].finished = true;
      clearInterval(loopHandle);
      return;
    }

    try {
      guards.assertTradeCap(trades, MAX_TRADES);
      guards.assertOpenTradeCap("Breakout", botId, MAX_OPEN_TRADES);

      await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
      if (!(await wm.ensureMinBalance(MIN_BALANCE_SOL, getWalletBalance, isAboveMinBalance))) {
        log("warn", "Balance below min – skipping");
        return;
      }

      /* fetch token list via resolver */
      const targets = await resolveTokenFeed("Breakout", botCfg);
      summary.inc("scanned", targets.length);
      log("info", `Scanning ${targets.length} tokens…`);
      for (const mint of targets) {
        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – breakout shutting down");
          log("summary", "✅ Breakout completed (max-trades reached)");
          await summary.printAndAlert("Breakout");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }

        // Cooldown gate
        const cooldownMs = cd.hit(mint);
        if (cooldownMs > 0) {
          // log("info", `⏳ Skipping ${mint}, still in cooldown for ${(cooldownMs / 1000).toFixed(0)}s`);
          continue;
        }

        // NEW: rug blacklist gate
        if (typeof breakoutRisk.isBlacklisted === "function" && breakoutRisk.isBlacklisted(mint)) {
          log("info", `Skipping blacklisted mint ${mint}`);
          continue;
        }

        // NEW: fakeout cooldown gate
        if (typeof breakoutRisk.inFakeoutCooldown === "function" &&
            breakoutRisk.inFakeoutCooldown(mint, fakeoutCooldownMs)) {
          log("info", `Cooldown active for ${mint} after fakeout; skipping`);
          continue;
        }

        // NEW: optional time-of-day gate
        if (timeOfDayFilter && timeOfDayFilter.start && timeOfDayFilter.end) {
          const now   = new Date();
          const [sH, sM] = String(timeOfDayFilter.start).split(":").map(Number);
          const [eH, eM] = String(timeOfDayFilter.end).split(":").map(Number);
          const start = new Date(now); start.setHours(sH||0, sM||0, 0, 0);
          const end   = new Date(now); end.setHours(eH||23, eM||59, 59, 999);
          if (now < start || now > end) {
            log("info", `Outside trading window ${timeOfDayFilter.start}-${timeOfDayFilter.end} — skip`);
            continue;
          }
        }

        log("info", `Token detected: ${mint}`);
        log("info", "Fetching price change + volume…");

        const pumpWin = botCfg.priceWindow  || "30m";
        const volWin  = botCfg.volumeWindow || "1h";

        const res = await limitBirdeye(() =>
          passes(mint, {
            entryThreshold     : ENTRY_THRESHOLD,
            volumeThresholdUSD : VOLUME_THRESHOLD,
            pumpWindow         : pumpWin,
            volumeWindow       : volWin,
            limitUsd           : LIMIT_USD,
            minMarketCap       : MIN_MARKET_CAP,
            maxMarketCap       : MAX_MARKET_CAP,
            fetchOverview      : (mint) => getTokenShortTermChange(null, mint, pumpWin, volWin),
          })
        );

        if (!res.ok) {
          log("warn", explainFilterFail(res, { 
            avg: res.avg, 
            entryTh: ENTRY_THRESHOLD, pumpWin,
            volTh: VOLUME_THRESHOLD, volWin,
            minMarketCap: MIN_MARKET_CAP, maxMarketCap: MAX_MARKET_CAP,
            volumeSpikeMult: VOLUME_SPIKE,
          }));
          summary.inc(res.reason || "filterFail");
          continue;
        }

        const overview = res.overview;
        log("info", "Passed price/volume check");
        log("info", `[🎯 TARGET FOUND] ${mint}`);
        summary.inc("filters");

        /* safety checks */
        if (!SAFETY_DISABLED) {
          const safeRes = await isSafeToBuyDetailed(mint, botCfg.safetyChecks || {});
          if (logSafetyResults(mint, safeRes, log, "breakout")) {
            summary.inc("safetyFail");
            continue;
          }
          summary.inc("safety");
        } else {
          log("info", "⚠️ Safety checks DISABLED – proceeding un-vetted");
        }

        // NEW: Volatility/squeeze breakout confirmation (feature-flag)
        if (useVolatilityBreakout) {
          let candles = Array.isArray(overview?.candles) ? overview.candles : [];
          if (!candles.length) {
            try {
              const alt = await getTokenShortTermChange(null, mint, "5m", volWin);
              if (alt && Array.isArray(alt.candles)) candles = alt.candles;
            } catch (_) { /* ignore */ }
          }
          const volOk = breakoutSignals &&
                        typeof breakoutSignals.detectVolatilityBreakout === "function"
                        ? breakoutSignals.detectVolatilityBreakout(candles, volatilityOpts)
                        : true; // if helper absent, don’t block
          if (!volOk) {
            log("info", "Volatility breakout conditions not met — skip");
            summary.inc("volatilityReject");
            continue;
          }
        }

        /* daily cap */
        guards.assertDailyLimit(SNIPE_LAMPORTS / 1e9, todaySol, MAX_DAILY_SOL);

        /* quote */
        log("info", "Getting swap quote…");
        let quote;
        try {
          log("info", `🔍 Calling getSafeQuote — in: ${BASE_MINT}, out: ${mint}, amt: ${SNIPE_LAMPORTS}, slip: ${SLIPPAGE}, impact max: ${MAX_SLIPPAGE}`);
          const result = await getSafeQuote({
            inputMint    : BASE_MINT,
            outputMint   : mint,
            amount       : SNIPE_LAMPORTS,
            slippage     : SLIPPAGE,
            maxImpactPct : MAX_SLIPPAGE,
          });

          if (!result.ok) {
            const {
              reason = "quoteFail",
              message = "no message",
              inputMint,
              outputMint,
              rawQuote,
              quoteDebug
            } = result;

            log("warn", `❌ Quote failed: ${reason.toUpperCase()} — ${message}`);
            log("warn", `↳ Input: ${inputMint}`);
            log("warn", `↳ Output: ${outputMint}`);
            if (quoteDebug) log("warn", `↳ Debug: ${JSON.stringify(quoteDebug, null, 2)}`);
            if (rawQuote)   log("warn", `↳ Raw Quote: ${JSON.stringify(rawQuote, null, 2)}`);
          
            summary.inc(reason);
            continue;
          }
          quote = result.quote;

        } catch (err) {
          log("error", `❌ getSafeQuote() threw: ${err.message}`);
          summary.inc("quoteException");
          continue;
        }

        // NEW: extra price-impact guard (in addition to quote’s maxImpactPct)
        if (maxPriceImpactPct != null && quote?.priceImpactPct > maxPriceImpactPct) {
          log("warn", `❌ Impact ${ (quote.priceImpactPct*100).toFixed(2) }% > limit ${(maxPriceImpactPct*100).toFixed(2)}% — skip`);
          summary.inc("impactTooHigh");
          continue;
        }

        // chad mode (priority fee)
        if (PRIORITY_FEE > 0) {
          quote.prioritizationFeeLamports = PRIORITY_FEE;
          log("info", `Adding priority fee of ${PRIORITY_FEE} lamports`);
        }
               
        log("info", `Quote impact ${(quote.priceImpactPct * 100).toFixed(2)} %`);
        log("info", "[🚀 BUY ATTEMPT] Executing breakout buy…");

        /* build meta */
        const meta = {
          strategy        : "Breakout",
          walletId        : botCfg.walletId,
          // publicKey: wallet?.publicKey || null,
          userId          : botCfg.userId,
          slippage        : SLIPPAGE,
          category        : "Breakout",
          tpPercent       : botCfg.tpPercent ?? TAKE_PROFIT,
          slPercent       : botCfg.slPercent ?? STOP_LOSS,
          tp              : botCfg.takeProfit,
          sl              : botCfg.stopLoss,
          openTradeExtras : { strategy: "breakout" },
          // NEW: allow the UI to specify a custom execution shape; if
          // undefined or falsy, the tradeExecutor will default to the
          // standard single-shot swap.  Supported values include
          // "TWAP" and "ATOMIC" (case-insensitive).  We coerce
          // undefined to an empty string to aid downstream checks.
          executionShape : botCfg?.executionShape || "",
          // NEW: attach the breakout risk policy so future executors
          // can consult it between fills.  Unused by default.
          riskPolicy     : breakoutRisk,
        };

        /* 3️⃣  execute (or simulate) the buy */
        let txHash;
        try {
          console.log("🔁 Sending to execBuy now…");

          if (snipedMints.has(mint)) {
            log("warn", `⚠️ Already executed breakout ${mint} — skipping duplicate`);
            continue;
          }
          snipedMints.add(mint);

          // Choose an executor based on the requested execution shape.  When
          // unspecified, fall back to a dry run or live swap based on the
          // global DRY_RUN flag.  TWAP performs a simple laddered fill
          // while ATOMIC executes an immediate scalp.
          const exec = meta.executionShape === "TWAP"
            ? executeTWAP
            : meta.executionShape === "ATOMIC"
            ? executeAtomicScalp
            : (DRY_RUN ? simulateBuy : liveBuy);
          txHash = await exec({ quote, mint, meta });
          console.log("🎯 exec returned:", txHash);
        } catch (err) {
          const errMsg = err?.message || JSON.stringify(err) || String(err);

          // Log to structured logs
          log("error", "❌ execBuy failed:");
          log("error", errMsg);

          // Print directly to user terminal
          console.error("❌ execBuy FAILED [UX]:", errMsg);

          // Print error object raw (only in terminal)
          console.error("🪵 Full error object:", err);

          // NEW: register fakeout to enforce cooldown on this mint
          if (typeof breakoutRisk.recordFakeout === "function") {
            try { breakoutRisk.recordFakeout(mint); } catch (_) {}
          }

          summary.inc("execBuyFail");
          continue;
        }

        const buyMsg  = DRY_RUN
          ? `[🎆 BOUGHT SUCCESS] ${mint}`
          : `[🎆 BOUGHT SUCCESS] ${mint} Tx: https://solscan.io/tx/${txHash}`;
        log("info", buyMsg);

        /* console stats banner ─ same as legacy */
        const volKey   = `volume${botCfg.volumeWindow || "1h"}`;
        const statsLine =
          `[STATS] price=${(overview?.price ?? 0).toFixed(6)}, ` +
          `mcap=${(overview?.[volKey] ?? 0).toFixed(0)}, ` +
          `change5m=${((overview?.priceChange5m ?? 0) * 100).toFixed(2)}%`;
        log("info", statsLine);

        /* bookkeeping */
        todaySol += SNIPE_LAMPORTS / 1e9;
        trades++;
        summary.inc("buys");

        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – breakout shutting down");
          // ✅ print summary first
          await summary.printAndAlert("Breakout");
          // ✅ then mark completion after summary
          log("summary", "✅ Breakout completed (max-trades reached)");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }
        cd.hit(mint);                         // start cooldown

        /* stop if trade cap hit mid-loop */
        if (trades >= MAX_TRADES) break;
      }

      fails = 0; // reset error streak

    } catch (err) {
      /* ────────────────────────────────────────────────
       * Hard-stop if the RPC or swap returns an
       * “insufficient lamports / balance” error.
       * This skips the normal retry counter and
       * shuts the bot down immediately.
       * ──────────────────────────────────────────────── */
      if (/insufficient.*lamports|insufficient.*balance/i.test(err.message)) {
        log("error", "🛑 Not enough SOL – breakout shutting down");
        await summary.printAndAlert("Breakout halted: insufficient SOL");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        return;                // <── bail right here
      }

      /* otherwise count the failure and let the normal
         HALT_ON_FAILS logic decide */
      fails++;
      if (fails >= HALT_ON_FAILS) {
        log("error", "🛑 Error limit hit — breakout shutting down");
        await summary.printAndAlert("Breakout halted on errors");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        return;                       // bail out cleanly
      }
      summary.inc("errors");
      log("error", err?.message || String(err));
      await tradeExecuted({
        userId     : botCfg.userId,
        mint       : "unknown",
        tx         : undefined,
        wl         : botCfg.walletLabel || "default",
        category   : "Breakout",
        simulated  : DRY_RUN,
        amountFmt  : `${(SNIPE_LAMPORTS / 1e9).toFixed(3)} ${BASE_MINT === SOL_MINT ? "SOL" : "USDC"}`,
        impactPct  : 0,
      });
    }

    /* early-exit outside the for-loop */
    if (trades >= MAX_TRADES) {
      // ✅ summary before completion flag
      await summary.printAndAlert("Breakout");
      log("summary", "✅ Breakout completed (max-trades reached)");

      if (runningProcesses[botId]) runningProcesses[botId].finished = true;
      clearInterval(loopHandle);
      process.exit(0);
    }
  }

  // ── token-feed banner ───────────────────────────────
  const feedName = botCfg.overrideMonitored
    ? "custom token list (override)"
    : (botCfg.tokenFeed || "new listings");   // falls back to breakout default
  log("info", `Token feed in use → ${feedName}`);

  /* scheduler */
  const loopHandle = runLoop(tick, botCfg.loop === false ? 0 : INTERVAL_MS, {
    label: "breakout",
    botId,
  });
};

/* ── CLI helper ──────────────a───────────────────────── */
if (require.main === module) {
  const fp = process.argv[2];
  if (!fp || !fs.existsSync(fp)) {
    console.error("❌ Pass config JSON path");
    process.exit(1);
  }
  module.exports(JSON.parse(fs.readFileSync(fp, "utf8")));
}
