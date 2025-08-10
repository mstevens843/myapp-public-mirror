/* utils/getSafeQuote.js */
const { getSwapQuote } = require("../../../utils/swap");

async function getSafeQuote({
  inputMint,
  outputMint,
  amount,
  slippage,
  maxImpactPct = 0.15,
}) {
  // 🛑 PREVENT CIRCULAR SWAPS
  if (inputMint === outputMint) {
    return {
      ok: false,
      reason: "same-token",
      message: "Input and output mint are the same — skipping quote",
      inputMint,
      outputMint,
    };
  }

  let q;
  try {
    q = await getSwapQuote({ inputMint, outputMint, amount, slippage });
    console.log("🧪 Raw Jupiter quote received:", JSON.stringify(q, null, 2));
  } catch (err) {
    return {
      ok: false,
      reason: "quoteError",
      message: err.message || "unknown error",
      inputMint,
      outputMint,
    };
  }

  if (!q) {
    return {
      ok: false,
      reason: "no-route",
      message: "Jupiter returned null",
      inputMint,
      outputMint,
    };
  }

  const impact = parseFloat(q.priceImpactPct);
  if (isNaN(impact)) {
    return {
      ok: false,
      reason: "invalid-impact",
      message: `priceImpactPct is missing or not a number: ${q.priceImpactPct}`,
      inputMint,
      outputMint,
      rawQuote: q,
    };
  }

  if (impact > maxImpactPct) {
    return {
      ok: false,
      reason: "impact",
      message: `Impact ${impact.toFixed(4)} > max ${maxImpactPct}`,
      inputMint,
      outputMint,
      rawQuote: q,
      quoteDebug: {
        outAmount: q.outAmount,
        priceImpact: impact,
        routeCount: q.marketInfos?.length,
      },
    };
  }

  return { ok: true, quote: q };
}

module.exports = { getSafeQuote };
