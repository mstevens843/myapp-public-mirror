/*
 * Updated StealthBot strategy with optional auto-consolidation support.
 *
 * This module is based off of the upstream stealthBot implementation from
 * the public myapp repository.  The original behaviour has been preserved
 * exactly when no new configuration is supplied.  When the caller
 * specifies a `forwardDest` along with an `autoForward` mode the bot
 * will forward purchased tokens out of the burner wallets to a cold
 * wallet via the ghost utility.  See the README for configuration
 * examples and additional context.
 */

const { Connection, PublicKey } = require("@solana/web3.js");
const prisma                   = require("../../prisma/prisma");
const fs                       = require("fs");
const { strategyLog }          = require("./logging/strategyLogger");
const { emitHealth }           = require("./logging/emitHealth");
const { createSummary, tradeExecuted }        = require("./core/alerts");
const wm                       = require("./core/walletManager");
const guards                   = require("./core/tradeGuards");
const { getSafeQuote } = require("./core/quoteHelper");
const { liveBuy, simulateBuy } = require("./core/tradeExecutor");
const { isSafeToBuyDetailed } = 
  require("../utils/safety/safetyCheckers/botIsSafeToBuy");
const { logSafetyResults } = require("./logging/logSafetyResults");
const {
  lastTickTimestamps,
  runningProcesses,
}                               = 
  require("../utils/strategy_utils/activeStrategyTracker");
const { getWalletBalance, isAboveMinBalance } = require("../utils");

// Bring in ghost helpers for forwarding tokens
const ghost = require("./core/ghost");

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

  // Report a stopped status when the process exits so the health
  // monitor knows this bot is no longer running.
  process.on('exit', () => {
    emitHealth(botId, { status: 'stopped' });
  });

  /* ───── auto-forward settings ───── */
  // forwardDest: base58 address to consolidate into
  // autoForward: "onEachBuy" | "onFinish" | "off" (default)
  // solFloorLamports: leave this many lamports in each wallet when forwarding
  const forwardDest       = cfg.forwardDest || null;
  const autoForward       = cfg.autoForward || "off";
  const solFloorLamports  = +cfg.solFloorLamports || 0;

  // NEW: optionally forward *all* SPL positions (not just the bought mint)
  // before USDC and SOL. Keep false to preserve legacy behaviour.
  const forwardAllSpl     = cfg.forwardAllSpl === true;

  /* ── load & decrypt wallets from DB (post-migration) ── */
  const walletIdByLabel = {};
  try {
    const walletRows = await prisma.wallet.findMany({
      where: { userId: cfg.userId, label: { in: cfg.wallets.map(w => typeof w === "string" ? w : w.label) } },
      select: { id: true, label: true }
    });

    await wm.initRotationWallets(cfg.userId, walletRows.map(w => w.id));
    walletRows.forEach(w => walletIdByLabel[w.label] = w.id);
  } catch (err) {
    console.error("❌ stealthBot wallet bootstrap failed:", err.message);
    return;
  }

  const loadedWallets = wm.all();
  console.log(`✅ Loaded ${loadedWallets.length} wallets`);

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

  // NEW: per-wallet slippage jitter to de-cluster signatures (e.g., 0.25 = 0.25%)
  const SLIPPAGE_JITTER   = (+cfg.slippageJitterPct || 0) / 100;

  let fails = 0,
      todaySol = 0,
      rounds = 0;

  async function forwardAllForWallet(wallet) {
    // Skip if no destination specified or autoForward is off
    if (!forwardDest) return;
    const destPub = new PublicKey(forwardDest);
    try {
      // Randomize delay up to 3 seconds to avoid MEV clustering
      const jitter = Math.random() * 3000;
      await new Promise(r => setTimeout(r, jitter));

      // ── SPL positions first ─────────────────────────────
      if (forwardAllSpl) {
        try {
          const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
          // sweep every SPL token account with non-zero balance (ghost sweeps amount=0)
          const tokenAccts = await conn.getParsedTokenAccountsByOwner(
            wallet.publicKey,
            { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
          );
          for (const ta of tokenAccts.value) {
            const mint = ta.account.data.parsed.info.mint;
            const uiAmt = +ta.account.data.parsed.info.tokenAmount.uiAmount;
            if (!uiAmt) continue;
            if (mint === USDC_MINT) continue; // handle USDC next
            if (mint === cfg.tokenMint) {
              // still sweep the bought token first for priority
              const tx1 = await ghost.forwardTokens(conn, mint, wallet, destPub, 0);
              log("info", `Auto-forward SPL ${mint.slice(0,6)}… tx=${tx1 || "n/a"}`);
            } else {
              const txX = await ghost.forwardTokens(conn, mint, wallet, destPub, 0);
              log("info", `Auto-forward SPL ${mint.slice(0,6)}… tx=${txX || "n/a"}`);
            }
          }
        } catch (e) {
          log("warn", `forwardAllSpl scan failed: ${e.message}`);
        }
      } else {
        // legacy: forward the purchased token only
        const tx0 = await ghost.forwardTokens(conn, cfg.tokenMint, wallet, destPub, 0);
        log("info", `Auto-forward SPL (bought) tx=${tx0 || "n/a"}`);
      }

      // ── USDC second ─────────────────────────────────────
      const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
      const txU = await ghost.forwardTokens(conn, USDC_MINT, wallet, destPub, 0);
      log("info", `Auto-forward USDC tx=${txU || "n/a"}`);

      // ── SOL last, leave floor ──────────────────────────
      const bal = await conn.getBalance(wallet.publicKey);
      const amountToSend = bal - solFloorLamports;
      if (amountToSend > 0) {
        const txS = await ghost.forwardTokens(
          conn,
          "So11111111111111111111111111111111111111112",
          wallet,
          destPub,
          amountToSend
        );
        log("info", `Auto-forward SOL ${(amountToSend/1e9).toFixed(4)} tx=${txS || "n/a"}`);
      }
      log("info", `Auto-forwarded funds from ${wallet.publicKey.toBase58()}`);
    } catch (err) {
      log("error", `autoForward error: ${err.message}`);
    }
  }

  async function tick() {
    // Capture loop start for health metrics
    const _healthStart = Date.now();
    try {
      const loaded = wm.all(); // get all loaded Keypairs
      log("info", ` Loaded ${loaded.length} wallets:`);
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

        /* daily-limit guard */
        guards.assertDailyLimit(POS_LAMPORTS / 1e9, todaySol, MAX_DAILY_SOL);

        /* random delay per wallet */
        if (DELAY_MAX_MS > 0) {
          const wait = Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS) + DELAY_MIN_MS;
          await new Promise((r) => setTimeout(r, wait));
        }

        /* per-wallet spend with jitter */
        const jitterFactor = 1 + (Math.random() * 2 - 1) * SIZE_JITTER; // ±pct
        const spendLamports = Math.round(POS_LAMPORTS * jitterFactor);

        // NEW: per-wallet slippage jitter
        const slippageForWallet = Math.max(
          0,
          SLIPPAGE * (1 + (Math.random() * 2 - 1) * SLIPPAGE_JITTER)
        );

        /* quote + buy */
        const { ok, quote } = await getSafeQuote({
          inputMint: "So11111111111111111111111111111111111111112", // SOL
          outputMint: cfg.tokenMint,
          amount: spendLamports,
          slippage: slippageForWallet,
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

        log("info", "[ BUY ATTEMPT] Executing stealth split-buy…");
        await execTrade({
          quote,
          mint: cfg.tokenMint,
          meta: {
            strategy   : "Stealth Bot",
            walletId   : walletIdByLabel[label],
            userId     : cfg.userId,
            slippage   : slippageForWallet,
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
          ` [${label}] bought ${(spendLamports / 1e9).toFixed(3)} SOL of ${cfg.tokenMint.slice(0, 4)}…`
        );

        const statsLine =
          `[STATS] impact=${(quote.priceImpactPct * 100).toFixed(2)}% ` +
          `spentSOL=${(spendLamports / 1e9).toFixed(3)} ` +
          `slip=${slippageForWallet}%`;
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

        // Auto-forward after each buy if requested
        if (autoForward === "onEachBuy" && forwardDest) {
          await forwardAllForWallet(wallet);
        }
      }

      fails = 0;
      rounds++;
      summary.inc("rounds");
    } catch (err) {
      fails++;
      summary.inc("errors");
      log("error", err.message);
      if (fails >= HALT_FAILS) {
        // Emit health before halting due to too many errors
        const _duration = Date.now() - _healthStart;
        emitHealth(botId, {
          lastTickAt: new Date().toISOString(),
          loopDurationMs: _duration,
          restartCount: 0,
          status: 'running',
        });
        return hardStop("error limit reached");
      }
    }

    if (cfg.loop === false || ROT_MS === 0) {
      // Emit health before completing single-shot run
      const _duration = Date.now() - _healthStart;
      emitHealth(botId, {
        lastTickAt: new Date().toISOString(),
        loopDurationMs: _duration,
        restartCount: 0,
        status: 'running',
      });
      return hardStop("completed");
    }
    // Emit health before scheduling next iteration
    {
      const _duration = Date.now() - _healthStart;
      emitHealth(botId, {
        lastTickAt: new Date().toISOString(),
        loopDurationMs: _duration,
        restartCount: 0,
        status: 'running',
      });
    }
    setTimeout(tick, ROT_MS);
  }

  const hardStop = async (reason) => {
    /* treat “completed” as success, everything else as error */
    const lvl   = reason === "completed" ? "summary" : "error";
    const emoji = reason === "completed" ? "✅" : "";

    log(lvl, `${emoji} StealthBot ${reason}`);

    /* pretty one-liner summary to console & Telegram */
    await summary.printAndAlert(
      reason === "completed"
        ? "StealthBot run completed"
        : `StealthBot halted: ${reason}`
    );

    // Forward any remaining funds when the run finishes
    if (autoForward === "onFinish" && forwardDest) {
      for (const w of cfg.wallets) {
        const label  = typeof w === "string" ? w : w.label;
        const wallet = wm.byLabel(label);
        if (wallet) await forwardAllForWallet(wallet);
      }
    }
  };

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
