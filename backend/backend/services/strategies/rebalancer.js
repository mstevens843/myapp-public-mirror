/** Rebalancer Strategy Module 
 * - Monitors wallet token balances. 
 * - Automatically swaps tokens to maintain a target ratio. 
 * - Great for maintaining long-term positions ( 60/40 split )
*/
const fs              = require("fs");
const prisma          = require("../../prisma/prisma");
const { PublicKey, Connection }   = require("@solana/web3.js");
const resolveFeed = require("./paid_api/tokenFeedResolver"); 
/* data helpers ---------------------------------------------------- */
const getTokenShortTermChange = require("./paid_api/getTokenShortTermChanges");
const { getTokenBalance }       = require("../../utils/marketData");
const { getMintDecimals }       = require("../../utils/tokenAccounts");
/* infra ----------------------------------------------------------- */
const { strategyLog } = require("./logging/strategyLogger");
const { createSummary, tradeExecuted }         = require("./core/alerts");
const wm                        = require("./core/walletManager");
const guards                    = require("./core/tradeGuards");
const { getSafeQuote } = require("./core/quoteHelper");
const { liveBuy, simulateBuy }  = require("./core/tradeExecutor");
const runLoop                   = require("./core/loopDriver");
const { initTxWatcher }         = require("./core/txTracker");
const { lastTickTimestamps,
        runningProcesses }      = require("../utils/strategy_utils/activeStrategyTracker");
const { getWalletBalance, isAboveMinBalance } = require("../utils"); 
const getTokenPrice = require("./paid_api/getTokenPrice");
const getSolPrice   = getTokenPrice.getSolPrice;
const SOL_MINT      = getTokenPrice.SOL_MINT;
const fetchLiveTokenBalances = require("./core/fetchLiveTokenBalances")
/* constants */
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// const SOL_MINT  = "So11111111111111111111111111111111111111112";
// on‑chain query that always grabs the correct UI amou


/* ───────────────────────────────────────────────────────────────── */
module.exports = async function rebalancer(cfg = {}) {
  const botId = cfg.botId || "manual";
  const log   = strategyLog("rebalancer", botId, cfg);
  const sum   = createSummary("Rebalancer",  log, cfg.userId);
  let rebalances = 0;
  let AUTO_TOKENS = [];

  /* ----------- config ------------------------------------------- */
  let TARGET_MAP = cfg.targetAllocations ?? cfg.targetWeights ?? {};
  /* ── normalise targets: accept 50 or 0.5 ─────────────── */
if (Object.keys(TARGET_MAP).length) {
  const sum = Object.values(TARGET_MAP).reduce((a, b) => a + b, 0);
  const _pct = sum > 1.5 ? 100 : 1;          // if they look like “50 / 50”
  for (const k in TARGET_MAP) TARGET_MAP[k] = +(TARGET_MAP[k] / _pct).toFixed(4);
}
  const THRESH_PCT      = (+cfg.rebalanceThreshold >= 1
                           ? +cfg.rebalanceThreshold / 100
                           : +cfg.rebalanceThreshold) || 0.05;
  const SLIPPAGE        = +cfg.slippage || 0.5;
  const MAX_IMPACT      = +cfg.maxSlippage || 0.15;
  /* unified TP / SL */
  const TAKE_PROFIT     = +cfg.takeProfit || 0;
  const STOP_LOSS       = +cfg.stopLoss   || 0;  /* per-cycle trade limit (was “max_trades”) */
  const MAX_TRADES      =
        +cfg.maxTradesPerCycle      // ← new preferred field
     || +cfg.maxTrades              // ← legacy support
     || 4;                          // ← sane default
  const MAX_REBALANCES  = +cfg.maxRebalances || 4;
  const CYCLE_MS = +cfg.rebalanceInterval || 600000;
  const MAX_OPEN_TRADES = +cfg.maxOpenTrades || 2;
  const HALT_ON_FAILS   = +cfg.haltOnFailures || 3;
  // cache maps
  const DEC_CACHE = new Map();   // mint -> decimals
  const PX_CACHE  = new Map();   // mint -> {price, ts}
  const PX_TTL_MS = 30_000;      // 30-second cache
  const DRY_RUN         = cfg.dryRun === true;
  const execTrade       = DRY_RUN ? simulateBuy : liveBuy;
  const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const conn = new Connection(RPC_URL, "confirmed");

async function splBalanceUI(walletPk, mint) {
  const { value } = await conn.getTokenAccountsByOwner(
    walletPk,
    { mint: new PublicKey(mint) },
    "confirmed"
  );

  let total = 0;
  for (const acc of value) {
    try {
      const info = acc.account.data?.parsed?.info?.tokenAmount;
      if (!info) continue;

      total += parseFloat(info.amount) / 10 ** info.decimals;
    } catch (e) {
      log("warn", `⚠️ Bad SPL account skipped for ${mint.slice(0, 4)}`);
      continue;
    }
  }
  return total;
}


  async function getWalletTokenMints(owner) {
  const tokenAccounts = await conn.getParsedTokenAccountsByOwner(
    new PublicKey(owner),
    { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
  );

  return tokenAccounts.value
    .map(acc => {
      const info = acc.account.data.parsed.info;
      const uiAmt = parseFloat(info.tokenAmount.amount) / (10 ** info.tokenAmount.decimals);
      return { mint: info.mint, amount: uiAmt };
    })  
    .filter(t => t.amount > 0.1)  // skip dust
    .map(t => t.mint);
}



  await wm.initWalletFromDb(cfg.userId, cfg.walletId);
  initTxWatcher("Rebalancer");
  
  
if (cfg.autoWallet) {
  try {
    AUTO_TOKENS = await getWalletTokenMints(
      wm.current().publicKey.toString()
    );
    log("info", `Loaded ${AUTO_TOKENS.length} tokens from wallet.`);
  } catch (err) {
    log("error", `Failed to load wallet tokens: ${err.message}`);
    // fall back to TARGET_MAP so the bot can still run
    AUTO_TOKENS = [];
  }
}
  /* ✔️ only auto-equal **when the user did not supply targets**       */
  if (AUTO_TOKENS.length && (!TARGET_MAP || !Object.keys(TARGET_MAP).length)) {
      const equal = +(1 / AUTO_TOKENS.length).toFixed(4);
      TARGET_MAP = Object.fromEntries(AUTO_TOKENS.map(m => [m, equal]));
      log("info", `AutoWallet targetAllocations = ${JSON.stringify(TARGET_MAP)}`);
    }

  let fails = 0;
  let h; 

  /* ----------- main loop ---------------------------------------- */
  async function tick() {
     let didRebalance = false;
    log("loop", `Tick @ ${new Date().toLocaleTimeString()}`);
    lastTickTimestamps[botId] = Date.now();

log("info",
  `[CONFIG] Δ≥ ${(THRESH_PCT*100).toFixed(2)}%, ` +
  `ROT every ${(CYCLE_MS/60000).toFixed(1)} min, ` +
  `SLIPPAGE: ${SLIPPAGE}%, maxTrades/cycle: ${MAX_TRADES}`);

    try {
      guards.assertOpenTradeCap("rebalancer", botId, MAX_OPEN_TRADES);

      const wallet = wm.current();
      /* halt immediately if SOL too low */
      /* configurable safety floor (default 0.05 SOL)               */
      const MIN_SOL_SAFE = +cfg.minSolBalance || 0.05;
      if (!(await wm.ensureMinBalance(
        MIN_SOL_SAFE, getWalletBalance, isAboveMinBalance, wallet))) {
        log("error", "🛑 Wallet SOL balance below safe minimum – stopping bot");
        await sum.printAndAlert("Rebalancer halted: insufficient SOL");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(h);
        return;
      }

      /* 1️⃣  snapshot ------------------------------------------------ */
      /* always honour the user-supplied map if it exists            */
      let mints = Object.keys(TARGET_MAP).length
          ? Object.keys(TARGET_MAP).filter(m => TARGET_MAP[m] > 0)
          : AUTO_TOKENS;

// let balances = await Promise.all(
//   mints.map(mint =>
//     mint === SOL_MINT
//       ? getWalletBalance(wallet)            // lamports → SOL
//       : getTokenBalance(wallet.publicKey, mint)
//   )
// );
const liveBalances = await fetchLiveTokenBalances(wallet.publicKey.toString());
const balanceMap = Object.fromEntries(liveBalances.map(t => [t.mint, t.amount]));

let balances = mints.map(m => balanceMap[m] ?? 0);

async function getPx(mint) {
  const hit = PX_CACHE.get(mint);
  if (hit && Date.now() - hit.ts < PX_TTL_MS) return hit.price;

  let p = await getTokenPrice(cfg.userId, mint).catch(() => 0);

  if (!p) {
    if (mint === SOL_MINT) p = await getSolPrice(cfg.userId);
    if (mint === USDC_MINT) p = 1;
  }

  PX_CACHE.set(mint, { price: p, ts: Date.now() });
  return p;
}

      // const prices = await Promise.all(mints.map(getPx));

      //       if (over.decimals == null) {
      //   over.decimals = DEC_CACHE.get(over.mint) ??
      //                   await getMintDecimals(over.mint);
      //   DEC_CACHE.set(over.mint, over.decimals);
      // }
      let prices = await Promise.all(mints.map(getPx));
      if (prices.every(px => px === 0)) {
        log("warn", "⚠️ All token prices are zero – skipping tick (Birdeye down?)");
        return sum.inc("skipped.noPrices");
      }
        const validIdx = prices.map((p, i) => (p > 0 ? i : -1)).filter(i => i !== -1);
        mints    = validIdx.map(i => mints[i]);
        prices   = validIdx.map(i => prices[i]);
        balances = validIdx.map(i => balances[i]);

      const values = balances.map((bal, i) => bal * prices[i]);
      const total  = values.reduce((a, b) => a + b, 0);
      if (total === 0) return sum.inc("noAction");

      mints.forEach((m,i) =>
  log("debug", `BAL ${m.slice(0,4)} = ${balances[i]}  PX = ${prices[i]}`));

      /* 2️⃣  build deviation list ----------------------------------- */
      const devList = mints
        .map((m, i) => ({
          mint: m,
          curPct: values[i] / total,
          tgtPct: TARGET_MAP[m],
          price: prices[i],
          value: values[i],
          decimals: null,          // fill later if needed
        }))
        .filter((x) => Math.abs(x.curPct - x.tgtPct) > THRESH_PCT)
        .sort((a, b) => (b.curPct - b.tgtPct) - (a.curPct - a.tgtPct)); // over-weights first

        // log to see the math, check quality of life. 
        log("info", "Balance snapshot:");
        devList.length || mints.forEach((m,i) => {
          log("info",
            `• ${m.slice(0,4)} cur ${(values[i]/total*100).toFixed(2)}% ` +
            `tgt ${(TARGET_MAP[m]*100).toFixed(2)}%`);
        });

      if (!devList.length) return sum.inc("noAction");

      /* 3️⃣  execute swaps (over → under) --------------------------- */
        const overs = devList
          .filter(d => d.curPct > d.tgtPct)
          .map(d => ({ ...d, excessUsd: (d.curPct - d.tgtPct) * total }));

        const unders = devList
          .filter(d => d.curPct < d.tgtPct)
          .map(d => ({ ...d, deficitUsd: (d.tgtPct - d.curPct) * total }));

        let trades = 0;

        for (const over of overs) {
          if (trades >= MAX_TRADES) break;
          log("info", "Max trades reached — exiting rebalance loop.");

          /* ensure decimals cached */
          if (over.decimals == null) {
            over.decimals =
              DEC_CACHE.get(over.mint) ?? (await getMintDecimals(over.mint));
            DEC_CACHE.set(over.mint, over.decimals);
          }

          let excessLeft = over.excessUsd;

          for (const under of unders) {
            if (excessLeft <= 0 || trades >= MAX_TRADES) break;
            if (under.deficitUsd <= 0) continue;   // this one already fixed

            /* move USD proportionally: min(excess, deficit) */
            const moveUsd = Math.min(excessLeft, under.deficitUsd);

            /* respect user-defined min trade size */
            if (moveUsd < (cfg.minTradeUsd || 5)) {
              under.deficitUsd -= moveUsd;
              excessLeft       -= moveUsd;
              continue;
            }

            /* convert USD -> over token qty -> lamports */
            const overQty      = moveUsd / over.price;
            // const lamportsFrom = Math.floor(overQty * 10 ** over.decimals);
            let lamportsFrom = Math.floor(overQty * 10 ** over.decimals);

            // ⛽️ Leave SOL gas buffer
            if (over.mint === SOL_MINT) {
              const solBalance = balances[mints.indexOf(SOL_MINT)] ?? 0;
              if (solBalance - overQty < 0.02) {
                log("warn", `[${over.mint.slice(0, 4)}] Not enough SOL to rebalance — preserving gas.`);
                continue;
              }

              const safeQty = Math.max(0, solBalance - 0.02);
              const cappedQty = Math.min(overQty, safeQty);
              lamportsFrom = Math.floor(cappedQty * 10 ** over.decimals);
              log("debug", `Adjusted SOL sell size to leave gas buffer: ${cappedQty.toFixed(4)} SOL`);
            }

            guards.assertOpenTradeCap("rebalancer", botId, MAX_OPEN_TRADES);

            log(
              "info",
              `Swap ${over.mint.slice(0, 4)}→${under.mint.slice(0, 4)} ` +
                `${overQty.toFixed(6)} ${over.symbol || "SOL"} ($${moveUsd.toFixed(
                  2
                )})`
            );

            const { ok, quote } = await getSafeQuote({
              inputMint: over.mint,
              outputMint: under.mint,
              amount: lamportsFrom,
              slippage: SLIPPAGE,
              maxImpactPct: MAX_IMPACT,
            });
            if (!ok) {
              sum.inc("quoteFail");
              continue;
            }

            quote.prioritizationFeeLamports = +cfg.priorityFeeLamports || 0;


            const meta = {
              strategy : "Rebalancer",
              category : "Rebalancer",
              walletId : cfg.walletId,
              userId   : cfg.userId,
              slippage : SLIPPAGE,
              tpPercent: cfg.tpPercent ?? TAKE_PROFIT,
              slPercent: cfg.slPercent ?? STOP_LOSS,
              tp       : cfg.takeProfit,
              sl       : cfg.stopLoss,
              openTradeExtras: { strategy: "rebalancer" },
            };

            log("info", "[🚀 BUY ATTEMPT] Rebalancing...");
            await execTrade({ quote, mint: under.mint, meta });
             didRebalance = true; 

             
            log(
              "info",
              `[STATS] swapped ≈${overQty.toFixed(6)} ${over.symbol || "SOL"} ` +
                `($${moveUsd.toFixed(2)})  pxFrom=${over.price.toFixed(
                  4
                )}  pxTo=${under.price.toFixed(4)}`
            );

            const buyMsg = DRY_RUN
              ? `[🎆 REBALANCE SUCCESS] ${over.mint.slice(0, 4)}→${under.mint.slice(0, 4)}`
              : `[🎆 REBALANCE SUCCESS] ${over.mint.slice(0, 4)}→${under.mint.slice(
                  0, 4 )} confirmed on-chain`; log("info", buyMsg);

            const statsLine =
              `[STATS] moved≈$${moveUsd.toFixed(2)} ` +
              `(${overQty.toFixed(6)} ${over.symbol || "SOL"})`; log("info", statsLine);

            /* update running tallies so remaining overs/unders stay accurate */
            excessLeft        -= moveUsd; under.deficitUsd  -= moveUsd; trades++;
          }
        }

       if (!didRebalance) {
        sum.inc("noAction");
        return;                           // nothing counted → don’t touch max
        }
      fails = 0;

        rebalances++;
        sum.inc("rebalances");
      
        if (rebalances >= MAX_REBALANCES) {
        log("info", "🎯 Trade cap reached – rebalancer shutting down");
        await sum.printAndAlert("Rebalancer");
        log("summary", "✅ Rebalancer completed (max-rebalances reached)");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(h);
        process.exit(0);
      }
    } // ✅ <-- FIXED: close try
    catch (e) {
      /* hard-stop on any insufficient-balance failure */
      if (/insufficient.*lamports|insufficient.*balance/i.test(e.message)) {
        log("error", "🛑 Not enough SOL – rebalancer shutting down");
        await sum.printAndAlert("Rebalancer halted: insufficient SOL");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(h);
        return;
      }
      fails++;
      if (fails >= HALT_ON_FAILS) {
        log("error", "🛑 Error limit hit — rebalancer shutting down");
        await sum.printAndAlert("Rebalancer halted on errors");
        if (runningProcesses[botId]) runningProcesses[botId].finished = true;
        clearInterval(h);
        return;
      }
      sum.inc("errors");
      log("error", e?.message || String(e));
            await tradeExecuted({
              userId     : cfg.userId,
              mint,
              tx         : txHash,
              wl         : cfg.walletLabel || "default",
              category   : "Rebalancer",
              simulated  : DRY_RUN,
              amountFmt  : `${(SNIPE_LAMPORTS / 1e9).toFixed(3)} ${BASE_MINT === SOL_MINT ? "SOL" : "USDC"}`,
              impactPct  : (quote?.priceImpactPct || 0) * 100,
            });
          }


  }


/* schedule loop */
/* schedule loop – let runLoop handle the very first tick */
h = runLoop(tick, CYCLE_MS, { label:"rebalancer", botId, immediate:true });
runningProcesses[botId] = { proc:h, mode:"rebalancer" };
};

/* CLI helper */
if (require.main === module) {
  const fp = process.argv[2];
  if (!fp || !fs.existsSync(fp)) {
    console.error("Pass config JSON"); process.exit(1);
  }
  module.exports(JSON.parse(fs.readFileSync(fp, "utf8")));
}





/** Additions
 * Multi-wallet Support
 * - Honeypot Guard
 * - Telegram Alerts
 * - Trade Logging
 * - Configurable tokens
 */

/** Additions 04/17 
 * Feature	Status
targetAllocations	✅ Any token mix
rebalanceThreshold	✅ Prevents unnecessary trades
minTradeSize	✅ Avoids dust rebalancing
dryRun	✅ Supported
maxTradesPerCycle	✅ Respects limit
haltOnFailures	✅ Prevents chaos
.env removed	✅ All config-driven
 */