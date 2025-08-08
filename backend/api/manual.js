const express = require("express");
const router = express.Router();
const validate = require("../middleware/validate");
const { csrfProtection } = require("../middleware/csrf");
const { buySchema } = require("./schemas/manual.schema");
const { performManualBuy, performManualSellByAmount, performManualSell } = require("../services/manualExecutor");
// const { getAvailableWalletLabels } = require("../services/utils/wallet/walletManager");
// const { getUserPreferences } = require("../telegram/services/userPrefs");
const { getUserPreferencesByUserId } = require("../services/userPrefs");
const { getSwapQuote } = require("../utils/swap");
const requireAuth = require("../middleware/requireAuth");      // ← default export
const prisma       = require("../prisma/prisma");    
const { v4: uuid } = require("uuid");

/**
 * @route POST /api/manual/buy
 * @desc Manually buy a token with X amount of SOL
 * @body { amountInSOL: number, mint: string, force?: boolean }
 * 
 * 
 */
// add right after your existing requires/imports
function isArmError(e) {
  return e?.status === 401 || e?.code === "AUTOMATION_NOT_ARMED" || /Automation not armed/i.test(e?.message || "");
}
function sendArm401(res, walletId) {
  return res.status(401).json({
    error: "Automation not armed",
    needsArm: true,
    walletId,
  });
}

async function getWallet(userId, walletLabel) {
  // ↪️  If caller omitted walletLabel → fall back to activeWalletId
  if (!walletLabel) {
    const { activeWalletId } = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeWalletId: true }
    });
    if (!activeWalletId) throw new Error("No active wallet set for user.");
    return prisma.wallet.findUnique({
      where: { id: activeWalletId },
      select: { id: true, label: true }
    });
  }

  // ↪️  Otherwise look it up by label (scoped to user)
  const w = await prisma.wallet.findFirst({
    where: { label: walletLabel, userId },
    select: { id: true, label: true }
  });
  if (!w) throw new Error(`Wallet '${walletLabel}' not found for user.`);
  return w;
}



// 🚫 Skip manual buy entirely for SOL <-> USDC conversions
const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";





// --- MANUAL BUY -----------------------------------------------------------
// Validate and protect manual buy requests. The order of middleware is important:
// 1) requireAuth ensures only authenticated users can access
// 2) csrfProtection enforces double‑submit cookies when session cookies are used
// 3) validate parses and validates the request body against the buySchema
router.post("/buy", requireAuth, csrfProtection, validate({ body: buySchema }), async (req, res) => {
  console.log("🔥 /manual/buy HIT with body:", req.body);

  let {
    amountInSOL,
    amountInUSDC,
    mint,
    force        = false,
    walletId,
    walletLabel,
    slippage     = 0.5,
    chatId       = null,
    context      = "default",
    strategy,
    skipLog,
    tp,
    sl,
    tpPercent,
    slPercent,
  } = req.body;

  /* ───────── Resolve wallet ───────── */
  let wallet;
  try {
    if (walletId) {
      wallet = await prisma.wallet.findFirst({
        where:  { id: walletId, userId: req.user.id },
        select: { id: true, label: true },
      });
      if (!wallet) throw new Error("Wallet not found.");
      if (!walletLabel) walletLabel = wallet.label;
    } else {
      wallet = await getWallet(req.user.id, walletLabel);
      if (!walletLabel) walletLabel = wallet.label;
    }
  } catch (e) {
    return res.status(403).json({ error: e.message });
  }

  /* ───────── Defaults / early skips ───────── */
  strategy = strategy || "manual";
  skipLog  = skipLog  || false;

  if (
    (amountInSOL  && mint === USDC_MINT) ||
    (amountInUSDC && mint === SOL_MINT)
  ) {
    console.log("🚫 SOL ↔ USDC conversion detected — skipping trade logs");
    skipLog = true;
  }

  /* ───────── Pref-based fallbacks ───────── */
  if (!amountInSOL && !amountInUSDC) {
    const prefs = await getUserPreferencesByUserId(req.user.id, context);
    if (prefs?.autoBuyEnabled) amountInSOL = prefs.autoBuyAmount;
  }

  /* ───────── Safety + confirmation guards ───────── */
  if (!force) {
    const safe = await isSafeToBuy(mint);
    if (!safe) return res.status(403).json({ error: "Token failed honeypot check." });
  }

  const prefsForConfirm = await getUserPreferencesByUserId(req.user.id, context);
  if (prefsForConfirm.confirmBeforeTrade && !force) {
    return res.status(403).json({ error: "🔒 Trade requires confirmation." });
  }

  if ((tp != null && tpPercent == null) || (sl != null && slPercent == null)) {
    return res.status(400).json({ error: "tpPercent/slPercent required when tp/sl set." });
  }

  /* ───────── Execute buy ───────── */
  let result;
  try {
    result = await performManualBuy({
      amountInSOL,
      amountInUSDC,
      mint,
      userId      : req.user.id,
      walletId    : wallet.id,
      walletLabel,
      slippage,
      strategy,
      context,
      tp,
      sl,
      tpPercent,
      slPercent, 
    });          
  } catch (e) {
    if (isArmError(e)) return sendArm401(res, wallet.id);
    throw e;
  }

  /* ───────── TP/SL rule creation ───────── */
  if (tp != null || sl != null) {
    console.log("📥 Creating new TP/SL rule:", { tp, sl, tpPercent, slPercent });

    await prisma.tpSlRule.create({
      data: {
        id        : uuid(),
        mint,
        walletId  : wallet.id,
        userId    : req.user.id,
        strategy,
        tp,
        sl,
        tpPercent,
        slPercent,
        entryPrice: result.entryPrice,
        force     : false,
        enabled   : true,
        status    : "active",
        failCount : 0,
      },
    });
    console.log(`✅ Created new independent TP/SL rule for ${mint}`);
  }

  return res.json({ success: true, result });

});




/**
 * @route POST /api/manual/sell
 * @desc Manually sell a token by percentage of current holding
 * @body { percent: number (0-1), mint: string }
 */
/**
 * @route POST /api/manual/sell
 * @desc Manually sell a token by percent OR exact amount
 * @body { mint: string, percent?: number, amount?: number, walletLabel?: string, slippage?: number }
 */
router.post("/sell", requireAuth, async (req, res) => {
  try {
    let {
      percent,                
      amount,                 
      strategy    = "manual",
      mint,
      walletId, 
      walletLabel,
      slippage, 
      triggerType, 
      chatId      = null, 
      context      = "default",   
      force       = false,   
    } = req.body;

    if (!mint) {
      return res.status(400).json({ error: "Missing mint address." });
    }

    // ✅ Get wallet just once
    let wallet;
    try {
      if (walletId) {
        wallet = await prisma.wallet.findFirst({
          where : { id: walletId, userId: req.user.id },
          select: { id: true, label: true },
        });
        if (!wallet) throw new Error("Wallet not found.");
        if (!walletLabel) walletLabel = wallet.label;
      } else {
        wallet = await getWallet(req.user.id, walletLabel);   // old helper
        if (!walletLabel) walletLabel = wallet.label;
      }
    } catch (err) {
      return res.status(403).json({ error: err.message });
    }

    /* ───────────── 1. Amount-based sell ───────────── */
    if (amount && +amount > 0) {
let result;
try {
  result = await performManualSellByAmount({
    amount,
    mint,
    strategy,
    userId    : req.user.id,
    walletId  : wallet.id,
    walletLabel,
    slippage,
    context,
  });
} catch (e) {
  if (isArmError(e)) return sendArm401(res, wallet.id);
  throw e;
}
      return res.json({ success: true, result });
    }

    /* ───────────── 2. Percent-based fallback ───────────── */
    if (percent == null) {
      return res
        .status(400)
        .json({ error: "Missing sell percent or amount." });
    }

    percent = parseFloat(percent);
    if (percent > 1) percent /= 100;
    if (percent <= 0 || percent > 1) {
      return res.status(400).json({
        error: "Sell percent must be between 1 and 100 (or 0.01 – 1.0).",
      });
    }

let result;
try {
  result = await performManualSell({
    percent,
    mint,
    strategy,
    userId    : req.user.id,
    walletId  : wallet.id,
    walletLabel,
    slippage,
    triggerType,
    context, 
  });
} catch (e) {
  if (isArmError(e)) return sendArm401(res, wallet.id);
  throw e;
}

    return res.json({ success: true, result });
  } catch (err) {
    console.error("❌ Manual Sell Failed:", err.message || err);
    return res
      .status(500)
      .json({ error: err.message || "Manual sell failed." });
  }
});



/**
 * @route POST /api/manual/snipe
 * @desc Quick snipe trade: verify token + buy with preset SOL amount
 * @body { mint: string, amountInSOL: number (optional), force?: boolean }
 */
// router.post("/snipe", async (req, res) => {
//   const { mint, amountInSOL = 0.25, force = false } = req.body;

//   if (!mint) {
//     return res.status(400).json({ error: "Missing mint address." });
//   }

//   if (!force) {
//     const safe = await isSafeToBuy(mint);
//     if (!safe) {
//       return res.status(403).json({ error: "Token failed honeypot check." });
//     }
//   }

//   try {
//     const result = await performManualBuy(amountInSOL, mint);
//     return res.json({ success: true, result });
//   } catch (err) {
//     console.error("❌ Snipe failed:", err.message);
//     return res.status(500).json({ error: "Snipe failed." });
//   }
// });


//   router.get("/quote", async (req, res) => {
//   const { inputMint, outputMint, amount, slippage } = req.query;

//   if (!inputMint || !outputMint || !amount || !slippage) {
//     return res.status(400).json({ error: "Missing required params" });
//   }

//   try {
//     const quote = await getSwapQuote({
//       inputMint,
//       outputMint,
//       amount: parseInt(amount),
//       slippage: parseFloat(slippage),
//     });

//     if (!quote) return res.status(500).json({ error: "Quote failed" });

//     res.json({
//       outAmount: quote.outAmount,
//       outToken: quote.outTokenSymbol,
//       priceImpact: quote.priceImpactPct,
//     });
//   } catch (err) {
//     console.error("❌ /api/quote error:", err.message);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// });




module.exports = router;