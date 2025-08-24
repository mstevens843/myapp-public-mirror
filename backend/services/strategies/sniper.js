/* backend/services/strategies/sniper.js */
const fs = require("fs");
const prisma = require("../../prisma/prisma");
const { v4: uuid } = require("uuid");
const pLimit = require("p-limit");
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
const { getSafeQuote }         = require("./core/quoteHelper");
const { liveBuy, simulateBuy } = require("./core/tradeExecutorSniper");
const { passes, explainFilterFail } = require("./core/passes");
const { createSummary, tradeExecuted } = require("./core/alerts");
const runLoop                  = require("./core/loopDriver");
const { initTxWatcher }        = require("./core/txTracker");
/* misc utils still needed directly */
const { getWalletBalance, isAboveMinBalance } = require("../utils");
const { sendAlert }            = require("../../telegram/alerts");
const { getPriceAndLiquidity } = require("./paid_api/getTokenPrice");

/* ── fatal/diagnostics scaffolding (added) ─────────────────────────────── */
const FATAL_DELAY_MS = 80; // small delay so stdout/stderr flush before exit

function fatal(reason, err) {
  const msg = `[ERROR] ${reason}${err ? `: ${err?.stack || err?.message || String(err)}` : ""}`;
  // Human-readable line (forwarder will pick up "[ERROR]")
  try { console.error(msg); } catch {}
  // Machine line (optional; harmless if nobody parses it)
  try {
    const payload = {
      level: "fatal",
      reason: String(reason),
      error : err ? (err.stack || err.message || String(err)) : null,
      ts    : new Date().toISOString(),
    };
    console.log(JSON.stringify(payload));
  } catch {}
  setTimeout(() => process.exit(1), FATAL_DELAY_MS);
}

// Ensure NOTHING can kill the process silently
process.on("uncaughtException", (err) => fatal("uncaughtException", err));
process.on("unhandledRejection", (err) => fatal("unhandledRejection", err));

/* constants */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT  = "So11111111111111111111111111111111111111112";

module.exports = async function sniperStrategy(botCfg = {}) {
  console.log("🚀 sniperStrategy loaded", botCfg);
  const limitBirdeye = pLimit(2);
  const botId = botCfg.botId || "manual";
  const log   = strategyLog("sniper", botId, botCfg);

  // Optional verbose config echo for dev debugging
  if (process.env.STRATEGY_DEBUG === "1") {
    try { console.error("[DEBUG] Sniper boot config:", JSON.stringify(botCfg, null, 2)); } catch {}
  }

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
  const MIN_BALANCE_SOL  = 0.05;
  const MAX_TOKEN_AGE_MIN= botCfg.maxTokenAgeMinutes != null
                              ? +botCfg.maxTokenAgeMinutes
                              : null;
  const MIN_TOKEN_AGE_MIN= botCfg.minTokenAgeMinutes != null
                              ? +botCfg.minTokenAgeMinutes
                              : null;
  const MIN_MARKET_CAP   = botCfg.minMarketCap != null ? +botCfg.minMarketCap : null;
  const MAX_MARKET_CAP   = botCfg.maxMarketCap != null ? +botCfg.maxMarketCap : null;
  const DRY_RUN          = botCfg.dryRun === true;
  const execBuy          = DRY_RUN ? simulateBuy : liveBuy;
  const COOLDOWN_MS      = botCfg.cooldown != null
    ? +botCfg.cooldown * 1000            // UI sends SECONDS
    : 60_000;                            // fallback: 60 000 ms
  // ── universal mode extensions ─────────────────────────
  const DELAY_MS         = +botCfg.delayBeforeBuyMs || 0;
  const PRIORITY_FEE     = +botCfg.priorityFeeLamports || 0;
  const MIN_POOL_USD = botCfg.minPoolUsd != null ? +botCfg.minPoolUsd : 50_000;

  /* safety toggle */
  const SAFETY_DISABLED =
    botCfg.safetyEnabled === false ||                         // new: explicit enable flag
    botCfg.disableSafety === true ||                          // legacy flag
    (botCfg.safetyChecks &&
     Object.keys(botCfg.safetyChecks).length > 0 &&
     Object.values(botCfg.safetyChecks).every(v => v === false));

  const snipedMints = new Set();
  const cd        = createCooldown(COOLDOWN_MS);
  const summary   = createSummary("Sniper",  log, botCfg.userId);
  let   todaySol  = 0;
  let   trades    = 0;
  let   fails     = 0;

  /* start background confirmation loop (non-blocking) */
  log("info", `🔗 Loading single wallet from DB (walletId: ${botCfg.walletId})`);
  try {
    await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
  } catch (err) {
    return fatal("wallet init failed", err);
  }
  try {
    initTxWatcher("Sniper");
  } catch (err) {
    return fatal("tx watcher init failed", err);
  }

  /* ── tick ──────────────────────────────────────────── */
  async function tick() {
    /* hard-exit quick guard (handle leftover queued ticks) */
    if (trades >= MAX_TRADES) return; // nothing to do
    const pumpWin = botCfg.priceWindow  || "5m";
    const volWin  = botCfg.volumeWindow || "1h";

    log("loop", `\n Sniper Tick @ ${new Date().toLocaleTimeString()}`);
    lastTickTimestamps[botId] = Date.now();
    log("info", `[CONFIG] DELAY_MS: ${DELAY_MS}, PRIORITY_FEE: ${PRIORITY_FEE}, MAX_SLIPPAGE: ${MAX_SLIPPAGE}`);
    log("info", `[CONFIG] pumpWin: ${pumpWin}, volWin: ${volWin}`);

    if (fails >= HALT_ON_FAILS) {
      log("error", "🛑 halted (too many errors)");
      await summary.printAndAlert("Sniper halted on errors");
      if (runningProcesses[botId]) runningProcesses[botId].finished = true;
      clearInterval(loopHandle);
      return;
    }

    try {
      guards.assertTradeCap(trades, MAX_TRADES);
      guards.assertOpenTradeCap("sniper", botId, MAX_OPEN_TRADES);

      await wm.initWalletFromDb(botCfg.userId, botCfg.walletId);
      if (!(await wm.ensureMinBalance(MIN_BALANCE_SOL, getWalletBalance, isAboveMinBalance))) {
        log("warn", "Balance below min – skipping");
        return;
      }

      /* fetch token list via resolver */
      const targets = await resolveTokenFeed("sniper", botCfg);
      log("info", `💡 resolveTokenFeed returned:`, targets);

      summary.inc("scanned", targets.length);
      log("info", `Scanning ${targets.length} tokens…`);
      for (const mint of targets) {
        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – sniper shutting down");
          log("summary", "✅ Sniper completed (max-trades reached)");
          await summary.printAndAlert("Sniper");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }

        const cooldownMs = cd.hit(mint);
        if (cooldownMs > 0) {
          // log("info", `⏳ Skipping ${mint}, still in cooldown for ${(cooldownMs / 1000).toFixed(0)}s`);
          continue;
        }

        if (MIN_TOKEN_AGE_MIN != null) {
          const createdAtUnix = await getTokenCreationTime(mint, botCfg.userId);
          const ageMin = createdAtUnix
            ? Math.floor((Date.now()/1e3 - createdAtUnix) / 60)
            : null;
          if (ageMin != null && ageMin < MIN_TOKEN_AGE_MIN) {
            summary.inc("ageSkipped");
            log("warn", `Age ${ageMin}m < min – skip`);
            continue;
          }
        }

        /* token-age gate */
        if (MAX_TOKEN_AGE_MIN != null) {
          const createdAtUnix = await getTokenCreationTime(mint, botCfg.userId);
          const ageMin = createdAtUnix
            ? Math.floor((Date.now()/1e3 - createdAtUnix) / 60)
            : null;
          if (ageMin != null && ageMin > MAX_TOKEN_AGE_MIN) {
            summary.inc("ageSkipped");
            log("warn", `Age ${ageMin}m > max – skip`);
            continue;
          }
        }

        //  price / volume gate
        log("info", `Token detected: ${mint}`);
        log("info", "Fetching price change + volume…");

        let res;
        try {
          res = await limitBirdeye(() =>
            passes(mint, {
              entryThreshold     : ENTRY_THRESHOLD,
              volumeThresholdUSD : VOLUME_THRESHOLD,
              pumpWindow         : pumpWin,
              volumeWindow       : volWin,
              limitUsd           : LIMIT_USD,
              minMarketCap       : MIN_MARKET_CAP,
              maxMarketCap       : MAX_MARKET_CAP,
              dipThreshold       : null, // 🛡️ safely ignored inside passes
              volumeSpikeMult    : null,
              fetchOverview      : (mint) =>
                getTokenShortTermChange(null, mint, pumpWin, volWin),
            })
          );
        } catch (err) {
          log("error", `🔥 passes() crashed: ${err.stack || err}`);
          summary.inc("passesError");
          continue;
        }

        if (!res?.ok) {
          log("warn", explainFilterFail(
            {
              reason: res.reason,
              pct: res.pct,
              vol: res.vol,
              price: res.overview?.price,
              mcap: res.overview?.marketCap
            },
            {
              entryTh: ENTRY_THRESHOLD,
              pumpWin,
              volTh: VOLUME_THRESHOLD,
              volWin,
              limitUsd: LIMIT_USD,
              minMarketCap: MIN_MARKET_CAP,
              maxMarketCap: MAX_MARKET_CAP,
              dipThreshold: null,
              recoveryWindow: pumpWin,
              volumeSpikeMult: null
            }
          ));

          summary.inc(res.reason || "filterFail");
          continue;
        }

        const overview = res.overview;
        log("info", "✅ Passed price/volume/mcap checks");
        // ——— user-facing pass details:
        const vol = Number(res?.vol ?? overview?.[`volume${botCfg.volumeWindow || "1h"}`] ?? NaN);
        if (Number.isFinite(vol)) {
          const ok = vol >= VOLUME_THRESHOLD;
          log(ok ? "info" : "warn",
              `[SAFETY] Volume (${botCfg.volumeWindow || "1h"}): $${vol.toFixed(0)} ${ok ? "≥" : "<"} $${VOLUME_THRESHOLD.toFixed(0)} ${ok ? "✅ PASS" : "❌ FAIL"}`);
        }
        const pct = Number((res?.pct ?? overview?.priceChange5m ?? 0) * 100);
        const th  = Number(ENTRY_THRESHOLD * 100);
        log(pct >= th ? "info" : "warn",
            `[SAFETY] Pump (${botCfg.priceWindow || "5m"}): ${pct.toFixed(2)}% ${pct >= th ? "≥" : "<"} ${th.toFixed(2)}% ${pct >= th ? "✅ PASS" : "❌ FAIL"}`);

      /* Liquidity check (configurable) */
      try {
        const { liquidity = 0, updateUnixTime = 0 } = await getPriceAndLiquidity(botCfg.userId, mint);

        const liqNum = Number(liquidity);
        const minUsd = Number(MIN_POOL_USD);

        if (Number.isFinite(liqNum)) {
          if (liqNum >= minUsd) {
            log("info", `[SAFETY] Liquidity: $${liqNum.toFixed(0)} ≥ $${minUsd.toFixed(0)} ✅ PASS`);
          } else {
            log("warn", `[SAFETY] Liquidity: $${liqNum.toFixed(0)} < $${minUsd.toFixed(0)} ❌ FAIL — skip`);

            summary.inc("liqSkipped");
            continue;
          }
        } else {
          log("warn", `⚠️ Liquidity check returned non-finite value — skip`);
          summary.inc("liqCheckFail");
          continue;
        }
      } catch (e) {
        log("warn", `⚠️ Liquidity check failed (${e.message}) — skip`);
        summary.inc("liqCheckFail");
        continue;
      }

        log("info", `[🎯 TARGET FOUND] ${mint}`);
        summary.inc("filters");

        /* safety checks */
        log("info", "[SAFETY] Running safety checks…");
        if (!SAFETY_DISABLED) {
          const flags = botCfg.safetyChecks || {};
          const pretty = Object.entries(flags)
            .map(([k, v]) => `${k}:${v ? "ON" : "off"}`)
            .join(", ");
          log("info", `[SAFETY] Active checks → ${pretty || "none"}`);
          const safeRes = await isSafeToBuyDetailed(mint, botCfg.safetyChecks || {});
          if (logSafetyResults(mint, safeRes, log, "sniper")) {
            summary.inc("safetyFail");
            continue;
          }
          summary.inc("safety");
        } else {
          log("info", "⚠️ Safety checks DISABLED – proceeding un-vetted");
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

        // (priority fee)
        if (PRIORITY_FEE > 0) {
          quote.prioritizationFeeLamports = PRIORITY_FEE;
          log("info", `Adding priority fee of ${PRIORITY_FEE} lamports`);
        }

        quote.priceImpactPct = Number(quote.priceImpactPct);

        if (
          (quote.priceImpactPct !== 0 && !quote.priceImpactPct) ||
          typeof quote.priceImpactPct !== "number" ||
          isNaN(quote.priceImpactPct)
        ) {
          log("error", "❌ Invalid quote: priceImpactPct is missing or not a number");
          summary.inc("quoteFail");
          continue;
        }

        log("info", `Quote received – impact ${(quote.priceImpactPct * 100).toFixed(2)}%`);

        console.log("🐛 TP/SL CHECK:", {
          tp: botCfg.tp,
          sl: botCfg.sl,
          tpPercent: botCfg.tpPercent,
          slPercent: botCfg.slPercent
        });

        log("info", `[🐛 TP/SL DEBUG] tp=${botCfg.takeProfit ?? "null"}, sl=${botCfg.stopLoss ?? "null"}, tpPercent=${botCfg.tpPercent ?? "null"}, slPercent=${botCfg.slPercent ?? "null"}`);

        /* build meta */
        const meta = {
          strategy        : "Sniper",
          walletId        : botCfg.walletId,
          // publicKey: wallet?.publicKey || null,
          userId          : botCfg.userId,
          botId          : botId,
          slippage        : SLIPPAGE,
          category        : "Sniper",
          tpPercent       : botCfg.tpPercent ?? TAKE_PROFIT,
          slPercent       : botCfg.slPercent ?? STOP_LOSS,
          tp              : botCfg.takeProfit,
          sl              : botCfg.stopLoss,
          priorityFeeLamports: +botCfg.priorityFeeLamports || 0,
          openTradeExtras : { strategy: "sniper" },
              // pull through UI-configured Smart Exit when present
              ...(botCfg.smartExitMode ? { smartExitMode: String(botCfg.smartExitMode).toLowerCase() } : {}),
              ...(botCfg.smartExit     ? { smartExit: botCfg.smartExit } : {}),
              ...(botCfg.postBuyWatch  ? { postBuyWatch: botCfg.postBuyWatch } : {}),
            };

        /* execute or simulate */
        /* 3️⃣  execute (or simulate) the buy */
        let txHash;
        try {
          log("info", "[🚀 BUY ATTEMPT] Sniping token…");
          console.log("🔁 Sending to execBuy now…");

          if (snipedMints.has(mint)) {
            log("warn", `⚠️ Already sniped ${mint} — skipping duplicate`);
            continue;
          }
          snipedMints.add(mint);

          // txHash = await execBuy({ quote, wallet, mint, meta });
          txHash = await execBuy({ quote, mint, meta });
          console.log("🎯 execBuy returned:", txHash);
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
        /* 📍 Inside the token loop, after bookkeeping */
        todaySol += SNIPE_LAMPORTS / 1e9;
        trades++;
        summary.inc("buys");

        if (trades >= MAX_TRADES) {
          log("info", "🎯 Trade cap reached – sniper shutting down");
          // ✅ print summary first
          await summary.printAndAlert("Sniper");
          // ✅ then mark completion after summary
          log("summary", "✅ Sniper completed (max-trades reached)");
          if (runningProcesses[botId]) runningProcesses[botId].finished = true;
          clearInterval(loopHandle);
          process.exit(0);
        }
        cd.hit(mint); // start cooldown

        /* stop if trade cap hit mid-loop */
        if (trades >= MAX_TRADES) break;
      }

      fails = 0; // reset error streak
      /* 📍 End of tick() */
    } catch (err) {
      /* ────────────────────────────────────────────────
       * Hard-stop if the RPC or swap returns an
       * “insufficient lamports / balance” error.
       * This skips the normal retry counter and
       * shuts the bot down immediately.
       * ──────────────────────────────────────────────── */
      if (/insufficient.*lamports|insufficient.*balance/i.test(err.message)) {
        log("error", "🛑 Not enough SOL – sniper shutting down");
        await summary.printAndAlert("Sniper halted: insufficient SOL");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        return; // <── bail right here
      }

      /* otherwise count the failure and let the normal HALT_ON_FAILS logic decide */
      fails++;
      if (fails >= HALT_ON_FAILS) {
        log("error", "🛑 Error limit hit — sniper shutting down");
        await summary.printAndAlert("Sniper halted on errors");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(loopHandle);
        return; // bail out cleanly
      }
      summary.inc("errors");
      log("error", err?.message || String(err));

    }

    /* early-exit outside the for-loop */
    if (trades >= MAX_TRADES) {
      // ✅ summary before completion flag
      await summary.printAndAlert("Sniper");
      log("summary", "✅ Sniper completed (max-trades reached)");

      if (runningProcesses[botId]) runningProcesses[botId].finished = true;
      clearInterval(loopHandle);
      process.exit(0);
    }
  }

  // ── token-feed banner ───────────────────────────────
  const feedName = botCfg.overrideMonitored
    ? "custom token list (override)"
    : (botCfg.tokenFeed || "new listings");   // falls back to sniper default
  log("info", `Token feed in use → ${feedName}`);

  /* scheduler */
  const loopHandle = runLoop(tick, botCfg.loop === false ? 0 : INTERVAL_MS, {
    label: "sniper",
    botId,
  });
};

/* ── CLI helper ─────────────────────────────────────── */
if (require.main === module) {
  const fp = process.argv[2];
  if (!fp || !fs.existsSync(fp)) {
    fatal("missing config JSON path", new Error(String(fp)));
  } else {
    Promise.resolve()
      .then(() => module.exports(JSON.parse(fs.readFileSync(fp, "utf8"))))
      .catch((err) => fatal("sniper startup failed", err));
  }
}