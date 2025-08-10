/** Scalper Strategy Module
 * - Executes trades at regular intervals.
 * - Designed for fast in-n-out trades on volatile pairs. 
 * - Use pre-configuredd token pairs and trade size. 
/* backend/services/strategies/scalper.js
 * ────────────────────────────────────── */

/* Scalper v2 – parity with Sniper / Breakout / DipBuyer */
const fs = require("fs");
const prisma = require("../../prisma/prisma");
const { v4: uuid } = require("uuid");
const { PublicKey } = require("@solana/web3.js");
const pLimit        = require("p-limit");    
const resolveFeed = require("./paid_api/tokenFeedResolver"); 
/* ── paid-API helper ─────────────────────────────── */
const getTokenShortTermChange = require("./paid_api/getTokenShortTermChanges");
const { getWalletBalance, isAboveMinBalance } = require("../utils");
/* ── safety + logging ────────────────────────────── */
const { isSafeToBuyDetailed } = require("../utils/safety/safetyCheckers/botIsSafeToBuy");
const { logSafetyResults }    = require("./logging/logSafetyResults");
const { strategyLog }         = require("./logging/strategyLogger");
const { createSummary, tradeExecuted } = require("./core/alerts");

/* ── watchdog / status ───────────────────────────── */
const { lastTickTimestamps, runningProcesses }
      = require("../utils/strategy_utils/activeStrategyTracker");

/* ── core helpers (shared) ───────────────────────── */
const wm                       = require("./core/walletManager");
const guards                   = require("./core/tradeGuards");
const createCooldown           = require("./core/cooldown");
const { getSafeQuote } = require("./core/quoteHelper");
// Include extended executors for TWAP and atomic scalping
const {
  liveBuy,
  simulateBuy,
  executeTWAP,
  executeAtomicScalp,
} = require("./core/tradeExecutor");
const { passes, explainFilterFail } = require("./core/passes");
const runLoop                  = require("./core/loopDriver");
const { initTxWatcher }        = require("./core/txTracker");

// ----------------------------------------------------------------------
// Extended helper imports (signals + risk)
//
// The following modules are optional stubs for scalper mode.  They
// expose asynchronous signal generation and pure risk policies.  They
// will only be used when enabled via botCfg.useSignals or
// botCfg.executionShape.
const scalperSignals = require("./signals/scalper");
const scalperRisk    = require("./risk/scalperPolicy");

/* ──────────────────────────────────────────────── */

module.exports = async function scalperStrategy(botCfg = {}) {
  const botId = botCfg.botId || "manual";
  const log   = strategyLog("scalper", botId, botCfg);
  const summary = createSummary("Scalper",  log, botCfg.userId);

  /* ── config ───────────────────────────────────── */
  const BASE_MINT  = botCfg.inputMint ||
    "So11111111111111111111111111111111111111112";
  // const mints  = await resolveFeed("scalper", cfg);
  // const TOKENS = mints.map((m) => new PublicKey(m));

  const POSITION_LAMPORTS = (+botCfg.scalpAmount || +botCfg.amountToSpend || 0.005) * 1e9;

  const ENTRY_THRESHOLD = (+botCfg.entryThreshold >= 1
    ? +botCfg.entryThreshold / 100
    : +botCfg.entryThreshold) || 0.005;                      // 0.5 %

  const VOLUME_THRESHOLD = +botCfg.volumeThreshold || 0;     // USD (0 = no filter)

  const SLIPPAGE     = +botCfg.slippage    || 0.2;
  const MAX_SLIPPAGE = +botCfg.maxSlippage || 0.05;          // tighter 5 %

  const INTERVAL_MS  = Math.round((+botCfg.interval || 10) * 1000);
  const COOLDOWN_MS = botCfg.cooldown != null ? +botCfg.cooldown * 1000 : 60_000;
  const TAKE_PROFIT  = +botCfg.takeProfit || 0;
  const STOP_LOSS    = +botCfg.stopLoss   || 0;

  const MAX_DAILY_SOL   = +botCfg.maxDailyVolume || 3;
  const MAX_OPEN_TRADES = +botCfg.maxOpenTrades  || 2;
  const MAX_TRADES      = +botCfg.maxTrades      || 9999;
  const HALT_ON_FAILS   = +botCfg.haltOnFailures || 5;

  const MIN_MARKET_CAP  = botCfg.minMarketCap != null ? +botCfg.minMarketCap : null;
  const MAX_MARKET_CAP  = botCfg.maxMarketCap != null ? +botCfg.maxMarketCap : null;

  const DRY_RUN         = botCfg.dryRun === true;
  const execBuy         = DRY_RUN ? simulateBuy : liveBuy;
  const MIN_BALANCE_SOL = 0.20;
  const VOLUME_SPIKE = +botCfg.volumeSpikeMultiplier || null;

  /* ── NEW (add-only): scalper-specific knobs ───── */
  const useSignals     = botCfg.useSignals === true;
  const maxHoldSeconds = +botCfg.maxHoldSeconds || 30;          // hard timeout
  const takeProfitPct  = botCfg.takeProfitPct != null ? +botCfg.takeProfitPct : 0.03; // +3%
  const stopLossPct    = botCfg.stopLossPct   != null ? +botCfg.stopLossPct   : 0.01; // -1%

  /* safety toggle */
  const SAFETY_DISABLED =
    botCfg.disableSafety === true ||
    (botCfg.safetyChecks && Object.values(botCfg.safetyChecks).every((v) => v === false));
  
  const snipedMints = new Set();

  /* ── bootstrap ───────────────────────────────── */
  log("info", `🔗 Loading single wallet from DB (walletId: ${botCfg.walletId})`);
  await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
  const cd = createCooldown(COOLDOWN_MS);
  initTxWatcher("Scalper");

  let todaySol = 0;
  let trades   = 0;
  let fails    = 0;

  // ── NEW (add-only): open position tracker (for hold-time / TP/SL) ──
  // shape: { entryPrice, entryTime, takeProfit, stopLoss, isLong }
  const openPositions = new Map();

  /* ── tick ────────────────────────────────────── */
  async function tick() {
    
    // 🔹 refresh token list every cycle
    const mints  = await resolveFeed("scalper", botCfg);
    const TOKENS = mints.map((m) => new PublicKey(m));

    const limitBirdeye = pLimit(2);        // 🔹 local concurrency limiter
    if (trades >= MAX_TRADES) return;
    log("loop", `\nScalper Tick @ ${new Date().toLocaleTimeString()}`);

    lastTickTimestamps[botId] = Date.now();

    // Optionally precompute scalper signals.  Wrap in try/catch to
    // prevent errors from bubbling into the main loop.  No
    // configuration is passed; the signal helper should inspect
    // cached microstructure state instead.
    if (botCfg?.useSignals) {
      try {
        scalperSignals({});
      } catch (_) {
        /* suppress errors from signal generator */
      }
    }

    /* NEW: stop instantly if we already blew past the fail cap */
    if (fails >= HALT_ON_FAILS) {
      log("error", "🛑 halted (too many errors)");
      await summary.printAndAlert("Scalper halted on errors");
      if (runningProcesses[botId]) runningProcesses[botId].finished = true;
      clearInterval(loopHandle);
      return;
    }

    try {
      guards.assertTradeCap(trades, MAX_TRADES);
      guards.assertOpenTradeCap("scalper", botId, MAX_OPEN_TRADES);

      if (!(await wm.ensureMinBalance(
              MIN_BALANCE_SOL, getWalletBalance, isAboveMinBalance))) {
        log("warn", "Balance below min – skipping");
        return;
      }
      const wallet = wm.current();

      for (const pk of TOKENS) {
        if (trades >= MAX_TRADES) break;
        const mint = pk.toBase58();
        const cooldownMs = cd.hit(mint);
        if (cooldownMs > 0) {
          log("info", `⏳ Skipping ${mint}, still in cooldown for ${(cooldownMs / 1000).toFixed(0)}s`);
          continue;
        }                  // still cooling

        log("info", `Token detected: ${mint}`);
        log("info", "Fetching price change + volume…");

        const pumpWin = botCfg.priceWindow  || "1m";
        const volWin  = botCfg.volumeWindow || "1h";

        const res = await limitBirdeye(() => passes(mint, {
          entryThreshold     : ENTRY_THRESHOLD,
          volumeThresholdUSD : VOLUME_THRESHOLD,
          pumpWindow         : pumpWin,
          volumeWindow       : volWin,
          volumeSpikeMult    : VOLUME_SPIKE,
          minMarketCap       : MIN_MARKET_CAP,
          maxMarketCap       : MAX_MARKET_CAP,
          fetchOverview: (mint) =>
            getTokenShortTermChange(null, mint, pumpWin, volWin),
        }));

        // log("info", `[CONFIG] volumeSpikeMult: ${VOLUME_SPIKE || "—"}`);

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

        const ov = res.overview;
        summary.inc("filters");

        /* safety checks */
        if (!SAFETY_DISABLED) {
          const safe = await isSafeToBuyDetailed(mint, botCfg.safetyChecks || {});
          if (logSafetyResults(mint, safe, log, "scalper")) {
            summary.inc("safetyFail"); continue;
          }
          summary.inc("safety");
        } else {
          log("info", "⚠️ Safety checks DISABLED");
        }

        // ── NEW (add-only): optional microstructure signal gate ──
        if (useSignals) {
          try {
            // In production you'd pass true microstructure snapshots; keep stub light.
            const samples = [{ price: ov?.price || 1, volume: 1 }];
            const fills   = [{ side: "buy", size: 1 }];
            // Attempt the primary signal using order book + VWAP.  When order book
            // data isn't available (generateScalperSignal returns null) fall back to a
            // pure VWAP/Keltner micro mean‑reversion gate (dev relative to VWAP).
            let sig = scalperSignals.generateScalperSignal(
              samples,
              samples[samples.length - 1].price,
              fills,
              ENTRY_THRESHOLD
            );
            if (!sig) {
              // compute deviation from VWAP; positive -> price above mean, negative -> below
              const dev = scalperSignals.meanReversionScore(samples, samples[samples.length - 1].price);
              // Use a loose threshold: if deviation within ±2*ENTRY_THRESHOLD treat as potential edge
              if (Math.abs(dev) <= ENTRY_THRESHOLD * 2) {
                if (dev < -ENTRY_THRESHOLD) sig = "long";
                else if (dev > ENTRY_THRESHOLD) sig = "short";
              }
            }
            if (!sig) {
              log("info", "Signal gate: no edge — skip");
              summary.inc("signalReject");
              continue;
            }
            log("info", `Signal gate: ${sig || "mean-revert"} OK`);
          } catch (e) {
            log("warn", `signal gen failed: ${e.message}`);
          }
        }

        guards.assertDailyLimit(POSITION_LAMPORTS / 1e9, todaySol, MAX_DAILY_SOL);

        /* quote */
        log("info", "Getting swap quote…");
        const result = await getSafeQuote({
          inputMint    : BASE_MINT,
          outputMint   : mint,
          amount       : POSITION_LAMPORTS,
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

          log("info", "[🚀 BUY ATTEMPT] Executing scalp buy…");

          log("warn", `❌ Quote failed: ${reason.toUpperCase()} — ${message}`);
          log("warn", `↳ Input: ${inputMint}`);
          log("warn", `↳ Output: ${outputMint}`);
          if (quoteDebug) log("warn", `↳ Debug: ${JSON.stringify(quoteDebug, null, 2)}`);
          if (rawQuote) log("warn", `↳ Raw Quote: ${JSON.stringify(rawQuote, null, 2)}`);
          
          summary.inc(reason);
          continue;
        }

        // NEW: declare quote locally (add-only fix)
        let quote = result.quote;
        log("info", `Quote impact ${(quote.priceImpactPct * 100).toFixed(2)} %`);

        // NEW: derive entry price & compute TP/SL using risk policy
        const entryPrice = quote.price;
        const { takeProfit, stopLoss } =
          scalperRisk.computeTpSl(entryPrice, takeProfitPct, stopLossPct);

        const meta = {
          strategy        : "Scalper",
          walletId        : botCfg.walletId,
          // publicKey: wallet?.publicKey || null,
          userId          : botCfg.userId,
          slippage        : SLIPPAGE,
          category        : "Scalper",
          tpPercent       : botCfg.tpPercent ?? TAKE_PROFIT,
          slPercent       : botCfg.slPercent ?? STOP_LOSS,
          tp              : botCfg.takeProfit,
          sl              : botCfg.stopLoss,
          openTradeExtras : { strategy: "scalper" },
          // NEW: optional execution shape (e.g. "ATOMIC").  When undefined
          // or falsy, the default single-shot swap will be used.
          // Coerce to empty string for downstream checks.
          executionShape : botCfg?.executionShape || "",
          // NEW: attach the scalper risk policy so future executors can
          // consult it between sub-orders.  Currently unused.
          riskPolicy     : scalperRisk,
        };

        let txHash;
        try {
          log("info", "[🚀 BUY ATTEMPT] Scalping token…");
          console.log("🔁 Sending to executor now…");

          if (snipedMints.has(mint)) {
            log("warn", `⚠️ Already sniped ${mint} — skipping duplicate`);
            continue;
          }
          snipedMints.add(mint);

          // Decide which executor to use based on the requested execution shape.
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

          summary.inc("execBuyFail");
          continue;
        }
        console.log("🎯 execBuy returned:", txHash);

        // NEW: track open position for max-hold/TP/SL enforcement
        // Store the token quantity (outAmount) so we know how much to sell later. Convert to BigInt for safety.
        openPositions.set(mint, {
          entryPrice,
          entryTime: Date.now(),
          takeProfit,
          stopLoss,
          isLong: true,
          quantity: quote && quote.outAmount != null ? BigInt(quote.outAmount) : 0n,
        });

        const buyMsg  = DRY_RUN
            ? `[🎆 BOUGHT SUCCESS] ${mint}`
            : `[🎆 BOUGHT SUCCESS] ${mint} Tx: https://solscan.io/tx/${txHash}`;
        log("info", buyMsg);

        /* console stats banner ─ same as legacy */
        const volKey   = `volume${botCfg.volumeWindow || "1h"}`;
        const statsLine =
          `[STATS] price=${(ov?.price ?? 0).toFixed(6)}, ` +
          `mcap=${(ov?.[volKey] ?? 0).toFixed(0)}, ` +
          `change5m=${((ov?.priceChange5m ?? 0) * 100).toFixed(2)}%`;
        log("info", statsLine);

        todaySol += POSITION_LAMPORTS / 1e9;
        trades++; 
        summary.inc("buys");
              
        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – scalper shutting down");
          await summary.printAndAlert("Scalper");
          log("summary", "✅ Scalper completed (max-trades reached)");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }

        /* stop if trade cap hit mid-loop */
        if (trades >= MAX_TRADES) break;
      }

      // ── NEW (add-only): evaluate open positions for exits (hold time / TP/SL) ──
      for (const [mint, pos] of openPositions) {
        const nowForce = scalperRisk.shouldForceClose(pos.entryTime, maxHoldSeconds);
        try {
          // Always fetch a fresh quote for the entire position amount to evaluate TP/SL and execute exit trades
          const sellResult = await getSafeQuote({
            inputMint    : mint,
            outputMint   : BASE_MINT,
            amount       : pos.quantity,
            slippage     : SLIPPAGE,
            maxImpactPct : MAX_SLIPPAGE,
          });
          if (!sellResult.ok) {
            // Could not get a valid sell quote; only remove if forced by time
            if (nowForce) {
              log("warn", `Force-closing ${mint} due to hold-time breach but sell quote unavailable: ${sellResult.reason}`);
              openPositions.delete(mint);
            }
            continue;
          }
          const sellQuote = sellResult.quote;
          // Quote.price reflects base per token; evaluate profit and stop levels
          const currentPrice = sellQuote.price;
          const hitTp = pos.takeProfit && currentPrice >= pos.takeProfit;
          const hitSl = pos.stopLoss  && currentPrice <= pos.stopLoss;
          if (nowForce || hitTp || hitSl) {
            const reason = nowForce
              ? `maxHold ${maxHoldSeconds}s`
              : hitTp ? "take profit" : "stop loss";
            log("info", `Exiting ${mint} (${reason}) @ ${currentPrice.toFixed(6)}`);
            // Choose executor based on configured executionShape; default to atomic scalp
            const exec = (botCfg?.executionShape || "") === "TWAP"
              ? executeTWAP
              : (botCfg?.executionShape || "") === "ATOMIC"
              ? executeAtomicScalp
              : (DRY_RUN ? simulateBuy : liveBuy);
            try {
              await exec({ quote: sellQuote, mint, meta: {
                strategy : "ScalperExit",
                walletId : botCfg.walletId,
                userId   : botCfg.userId,
                slippage : SLIPPAGE,
                category : "Scalper",
                executionShape: botCfg?.executionShape || "",
                riskPolicy: scalperRisk,
                position: pos,
              }});
              summary.inc("sells");
              openPositions.delete(mint);
            } catch (exitErr) {
              log("error", `❌ Exit trade failed for ${mint}: ${exitErr.message}`);
              // Do not delete the position so it can retry on next tick
            }
          }
        } catch (e) {
          // On unexpected errors, only enforce force-close by removing position
          log("error", `Exit evaluation failed for ${mint}: ${e.message}`);
          if (nowForce) openPositions.delete(mint);
        }
      }

      fails = 0;                                        // reset error streak
      /* 📍 End of tick() */
    } catch (err) {
      /* ────────────────────────────────────────────────
       * Hard-stop if the RPC or swap returns an
       * “insufficient lamports / balance” error.
       * This skips the normal retry counter and
       * shuts the bot down immediately.
       * ──────────────────────────────────────────────── */
      if (/insufficient.*lamports|insufficient.*balance/i.test(err.message)) {
        log("error", "🛑 Not enough SOL – scalper shutting down");
        await summary.printAndAlert("Sniper halted: insufficient SOL");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        return;                // <── bail right here
      }
      fails++;
      if (fails >= HALT_ON_FAILS) {
        log("error", "🛑 Error limit hit — scalper shutting down");
        await summary.printAndAlert("Sniper halted on errors");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        return;                       // bail out cleanly
      }
      summary.inc("errors");
      log("error", err?.message || String(err));
      await tradeExecuted({
        userId     : botCfg.userId,
        mint,
        tx         : txHash,
        wl         : botCfg.walletLabel || "default",
        category   : "Scalper",
        simulated  : DRY_RUN,
        amountFmt  : `${(POSITION_LAMPORTS / 1e9).toFixed(3)} ${BASE_MINT === "So11111111111111111111111111111111111111112" ? "SOL" : "USDC"}`,
        impactPct  : (quote?.priceImpactPct || 0) * 100,
      });
    }

    // ✅ moved outside catch
    if (trades >= MAX_TRADES) {
      log("info", "🎯 Trade cap reached – scalper shutting down");
      await summary.printAndAlert("Scalper");
      log("summary", "✅ Scalper completed (max-trades reached)");
      if (runningProcesses[botId]) runningProcesses[botId].finished = true;
      clearInterval(loopHandle);
      process.exit(0);
    }
  }
  

  // ── token-feed banner ───────────────────────────────
  const feedName = botCfg.overrideMonitored
    ? "custom token list (override)"
    : (botCfg.tokenFeed || "monitored tokens");
  log("info", `Token feed in use → ${feedName}`);

  /* scheduler */
  const loopHandle = runLoop(tick, botCfg.loop === false ? 0 : INTERVAL_MS, {
    label: "scalper",
    botId,
  });
};

/* ── CLI helper (dev) ────────────────────────────── */
if (require.main === module) {
  const fp = process.argv[2];
  if (!fp || !fs.existsSync(fp)) {
    console.error("❌ Pass config JSON path");
    process.exit(1);
  }
  module.exports(JSON.parse(fs.readFileSync(fp, "utf8")));
}



/** 
 * Additions: 
 * - Multi-wallet rotation
 * - Honeypot Protection Check
 * - Telegram trade alerts 
 * - Analytics Logging
 * - Clean error handling + structure
 */

/** 
 * Additions: 
 * - Multi-wallet rotation
 * - Honeypot Protection Check
 * - Telegram trade alerts 
 * - Analytics Logging
 * - Clean error handling + structure
 */