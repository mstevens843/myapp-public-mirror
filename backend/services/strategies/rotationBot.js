/** Rotation Bot Strategy Module
 * - Rotates capital into the best performing token in a monitored list. 
 * 
 */


/* rotationBot.js  🚦 selects strongest-performer every rotation */

const { Connection, PublicKey } = require("@solana/web3.js");
const prisma                    = require("../../prisma/prisma");
const fs                        = require("fs");

/* data helpers ---------------------------------------------------- */
const getTokenShortTermChange   = require("./paid_api/getTokenShortTermChanges");
const fetchLiveTokenBalances    = require("./core/fetchLiveTokenBalances");
const getTokenPrice             = require("./paid_api/getTokenPrice");
const getSolPrice               = getTokenPrice.getSolPrice;
const SOL_MINT                  = getTokenPrice.SOL_MINT;

/* infra ----------------------------------------------------------- */
const { strategyLog }           = require("./logging/strategyLogger");
const { emitHealth }            = require("./logging/emitHealth");
const { createSummary, tradeExecuted }         = require("./core/alerts");
const wm                        = require("./core/walletManager");
const guards                    = require("./core/tradeGuards");
const { getSafeQuote }          = require("./core/quoteHelper");
const { liveBuy, simulateBuy }  = require("./core/tradeExecutor");
const createCooldown            = require("./core/cooldown");
const { initTxWatcher }         = require("./core/txTracker");
const {
  lastTickTimestamps,
  runningProcesses,
}                                = require("../utils/strategy_utils/activeStrategyTracker");
const { getWalletBalance, isAboveMinBalance } = require("../utils");

/* ───────────────── helper: auto-pick momentum window ─────────────── */
function pickMomentumWindow(rotMs) {
  if (rotMs <= 15 * 60_000)  return "5m";
  if (rotMs <= 30 * 60_000)  return "15m";
  if (rotMs <= 60 * 60_000)  return "30m";
  if (rotMs <= 4  * 60 * 60_000) return "1h";
  return "4h";
}

/* ───────────────── helper: find wallet keypair by label ──────────── */
const getWalletByLabel = (label) =>
  wm.all().find((kp) => kp.label === label);

/* ─────────────────────────────────────────────────────────────────── */
module.exports = async function rotationBot(cfg = {}) {
  if (!Array.isArray(cfg.wallets) || !cfg.wallets.length) {
    console.error("rotationBot: cfg.wallets[] is required");
    return;
  }

  const botId = cfg.botId || "manual";
  const log   = strategyLog("rotationbot", botId, cfg);
  const sum   = createSummary("RotationBot",  log, cfg.userId);

  // Report a stopped status when the process exits.
  process.on('exit', () => {
    emitHealth(botId, { status: 'stopped' });
  });

  /* map: label → token-list */
const labelToTokens = Object.fromEntries(
  cfg.wallets.map((w) => {
    const label = typeof w === "string" ? w : w.label;
    const tokens = Array.isArray(w.tokens) ? w.tokens.map(String) : (cfg.tokens || []);
    return [label, tokens];
  })
);


  /* initialise wallets in walletManager */
  /* ── load & decrypt ALL wallets in one go ── */
  const walletIdByLabel = {};
  try {
const rows = await prisma.wallet.findMany({
  where : {
    userId: cfg.userId,
    label: { in: cfg.wallets.map(w => typeof w === "string" ? w : w.label) }
  },
  select: { id: true, label: true }
});

    await wm.initRotationWallets(cfg.userId, rows.map(r => r.id));
    rows.forEach(r => (walletIdByLabel[r.label] = r.id));
  } catch (err) {
    console.error("❌ rotationBot wallet bootstrap failed:", err.message);
    return;
  }
  console.log(`✅ Loaded ${wm.all().length} wallets for RotationBot`);

  /* ───── runtime constants ───── */
  const RPC_URL  = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const conn     = new Connection(RPC_URL, "confirmed");

  const ROT_MS        = +cfg.rotationInterval || 3_600_000;
const MIN_MOM = cfg.minMomentum != null ? +cfg.minMomentum / 100 : 0.02;
  // const POS_LAMPORTS  = (+cfg.positionSize || 0.02) * 1e9;
  const SLIPPAGE      = +cfg.slippage || 0.5;
  const MAX_IMPACT    = +cfg.maxSlippage || 0.15;
  const COOLDOWN_MS   = cfg.cooldown != null ? +cfg.cooldown * 1000 : 60_000;
  const MAX_OPEN      = +cfg.maxOpenTrades || 2;
  // const MAX_DAILY_SOL = +cfg.maxDailyVolume || 5;
  const HALT_FAILS    = +cfg.haltOnFailures || 4;
  const MAX_ROTATIONS = +cfg.maxRotations || 5;
  const TAKE_PROFIT   = +cfg.takeProfit || 0;
  const STOP_LOSS     = +cfg.stopLoss   || 0;
  const execTrade     = cfg.dryRun ? simulateBuy : liveBuy;

  initTxWatcher("RotationBot");
  const cd = createCooldown(COOLDOWN_MS);

  let fails = 0;
  let todaySol = 0;
  let rotations = 0;

  const rotationsByWallet = {};
  /* ───────────────── main loop ───────────────── */
  async function tick() {
    // Capture the start time for health metrics
    const _healthStart = Date.now();
    log("loop", `Tick @ ${new Date().toLocaleTimeString()}`);
    lastTickTimestamps[botId] = Date.now();
    let rotatedThisTick = false;

    if (fails >= HALT_FAILS) return hardStop("too many errors");

    try {
      guards.assertOpenTradeCap("rotationbot", botId, MAX_OPEN);

      /* decide momentum window once per tick */
      const PUMP_WIN =
        cfg.priceChangeWindow || pickMomentumWindow(ROT_MS);
      log(
        "info",
        `[CONFIG] Momentum window: ${PUMP_WIN} (${cfg.priceChangeWindow ? "manual" : "auto"})`
      );

      /* ─── per-wallet processing ─── */
      /* ─── each wallet ─── */
for (const walletEntry of cfg.wallets) {
  const label  = typeof walletEntry === "string" ? walletEntry : walletEntry.label;
  const wallet = wm.byLabel(label);
  if (!wallet) { log("error", `Wallet ${label} not loaded`); continue; }

  const cfgTokens = labelToTokens[label] ?? [];
  if (!cfgTokens.length) { log("warn", `[${label}] no tokens configured — skip`); continue; }

  /* ---------------- live balances ---------------- */
  const balances = await fetchLiveTokenBalances(wallet.publicKey.toString());
  const balMap   = Object.fromEntries(balances.map(b => [b.mint, b]));

  /* ------------ momentum ranking ----------------- */
  const ranked = [];
  for (const mint of cfgTokens) {
    if (cd.hit(mint) > 0) continue;           // per‑mint cooldown

    const stat = await getTokenShortTermChange(cfg.userId, mint, PUMP_WIN);
    const pct  = stat?.[`priceChange${PUMP_WIN}`] ??
                 stat?.priceChange5m ??
                 stat?.priceChange1m ?? 0;

    log("info", `🔍 [${label}] ${mint.slice(0,4)}… Δ ${(pct*100).toFixed(2)}%`);
    if (pct < MIN_MOM) continue;

    const price  = stat?.price
                || await getTokenPrice(cfg.userId, mint)
                || (mint === SOL_MINT ? await getSolPrice(cfg.userId) : 0);

    ranked.push({ mint, pct, price, symbol: stat.symbol });
  }

  if (!ranked.length) { sum.inc("noAction"); continue; }
  ranked.sort((a,b) => b.pct - a.pct);
  const best = ranked[0];                                         // ← winner
  // check if we're already fully in the winning token
const alreadyInBest = balances.every(b => b.mint === best.mint || b.amount < 0.000001);
if (alreadyInBest) {
  log("info", `[${label}] ✅ Already fully in ${best.symbol || best.mint.slice(0,4)} — skip rotation`);
  sum.inc("noAction");
  continue;
}

  /* -------------- decide sell candidates ------------- */
  const GAS_BUF    = cfg.gasBufferSol != null ? +cfg.gasBufferSol : 0.02;
  const dustLimit  = 0.000001;
  const sellList   = balances
      .filter(b => b.mint !== best.mint && b.amount > dustLimit);

  /* keep SOL gas */
  const solBal = balMap[SOL_MINT]?.amount ?? 0;
  // if (solBal - GAS_BUF <= dustLimit) {
  //   // remove SOL from sell list entirely if buffer would be breached
  //   const i = sellList.findIndex(b => b.mint === SOL_MINT);
  //   if (i !== -1) sellList.splice(i,1);
  // } else if (solBal > GAS_BUF) {
  //   // trim SOL balance so that exactly GAS_BUF remains
  //   const sellAmt   = +(solBal - GAS_BUF).toFixed(9);
  //   const decimals  = 9;
  //   sellList.push({ mint: SOL_MINT, amount: sellAmt, decimals });
  // }
 // 1️⃣ always nuke any pre‑existing SOL in sellList
 const idx = sellList.findIndex(b => b.mint === SOL_MINT);
 if (idx !== -1) sellList.splice(idx, 1);

 // 2️⃣ only add SOL back if there’s more than the buffer
 if (solBal > GAS_BUF + dustLimit) {
   const sellAmt  = +(solBal - GAS_BUF).toFixed(9);
   sellList.push({ mint: SOL_MINT, amount: sellAmt, decimals: 9 });
 }

  /* nothing to rotate? */
  if (!sellList.length) { sum.inc("noAction"); continue; }

  /* ---------------- execute every swap ---------------- */
  for (const s of sellList) {
    // convert to lamports / token units
    const lamports = Math.floor(s.amount * 10**s.decimals);
    if (lamports <= 0) continue;

    const { ok, quote } = await getSafeQuote({
      inputMint : s.mint,
      outputMint: best.mint,
      amount    : lamports,
      slippage  : SLIPPAGE,
      maxImpactPct: MAX_IMPACT,
    });
    if (!ok) { sum.inc("quoteFail"); continue; }

log("user",
      `[${label}] Rotating ${s.amount.toFixed(6)} ${s.mint.slice(0,4)} → ${best.symbol || best.mint.slice(0,4)}…`);

    await execTrade({
      quote,
      mint : best.mint,
      meta : {
        strategy : "Rotation Bot",
        walletId : walletIdByLabel[label],
        userId   : cfg.userId,
        slippage : SLIPPAGE,
        category : "rotationbot",
        tokenName: best.symbol || null, 
        tpPercent: cfg.tpPercent ?? TAKE_PROFIT,
        slPercent: cfg.slPercent ?? STOP_LOSS,
        tp       : cfg.takeProfit,
        sl       : cfg.stopLoss,
        openTradeExtras: { strategy:"rotationbot" },
      },
    });

    await tradeExecuted({
      userId    : cfg.userId,
      mint      : best.mint,
      tx        : txHash,
      wl        : label,
      category  : "Rotation Bot",
      simulated : !!cfg.dryRun,
      amountFmt : `${s.amount.toFixed(4)} ${s.mint === SOL_MINT ? "SOL" : "token"}`,
      impactPct : (quote?.priceImpactPct || 0) * 100,
    });
   
rotationsByWallet[label] = (rotationsByWallet[label] || 0) + 1;


 log("info",
      `💱 [${label}] Rotated ${s.amount.toFixed(6)} ${s.mint.slice(0,4)} → ${best.symbol || best.mint.slice(0,4)}`);
    rotatedThisTick = true;
  }
} // end wallet loop

      fails = 0;
    } catch (e) {
      if (/insufficient.*balance|lamports/i.test(e.message)) {
        return hardStop("insufficient SOL");
      }
      fails += 1;
      sum.inc("errors");
      log("error", e.message);
      if (fails >= HALT_FAILS) return hardStop("error limit reached");
    }

    
if (rotatedThisTick) {
  rotations += 1;
  sum.inc("rotations");
  log("info", `📊 Rotation interval completed — total ${rotations}/${MAX_ROTATIONS}`);
  log("info", "…awaiting next rotation interval");

  if (rotations >= MAX_ROTATIONS)
    return hardStop("max rotations reached");
} else {
  log("info", "…awaiting next rotation interval");
}

      // Emit health update before scheduling the next tick
      const _duration = Date.now() - _healthStart;
      emitHealth(botId, {
        lastTickAt: new Date().toISOString(),
        loopDurationMs: _duration,
        restartCount: 0,
        status: 'running',
      });
      reschedule();
  }

  const reschedule = () => {
    if (cfg.loop !== false) setTimeout(tick, ROT_MS);
  };

  const hardStop = async (reason) => {
    log("error", `🛑 RotationBot halted: ${reason}`);
    for (const label in rotationsByWallet) {
      const count = rotationsByWallet[label];
      if (count > 0) {
        log("info", `↪ [${label}] performed ${count} rotation${count > 1 ? "s" : ""}`);
      }
    }
    await sum.printAndAlert(`RotationBot halted: ${reason}`);
    if (runningProcesses[botId])
      runningProcesses[botId].finished = true;
  };

  await tick();
};

/* CLI helper --------------------------------------------------- */
if (require.main === module) {
  const fp = process.argv[2];
  if (!fp || !fs.existsSync(fp))
    return console.error("Pass config path");
  module.exports(JSON.parse(fs.readFileSync(fp, "utf8")));
}