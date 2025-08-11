/*
 * tca.js
 *
 * Simple trade cost analysis (TCA) helper for Paper Trader.  Given a
 * mid‑price at decision time, a set of fill records and accrued fees
 * this function computes the realised average fill price, total
 * slippage in basis points and decomposes the fee breakdown.  The
 * resulting object can be used to display a breakdown to users or
 * feed into performance dashboards.
 */

/**
 * Compute a basic trade cost analysis.  The midPrice should be the
 * token price at the time of decision and fills should be an array
 * containing objects with a `price` and optional `amountOut`.  When
 * amounts are provided the average is weighted accordingly.  Fees
 * include both the priority fee lamports and any additional costs
 * passed in.
 *
 * @param {object} params
 * @param {number} params.midPrice - the price at decision time
 * @param {Array<{price:number, amountOut:number}>} params.fills
 * @param {number} params.priorityFeeLamports - lamports paid for
 *   prioritisation
 * @param {number} params.totalFeeLamports - total lamports charged
 */
function computeTca({ midPrice, fills, priorityFeeLamports = 0, totalFeeLamports = 0 }) {
  if (!Array.isArray(fills) || fills.length === 0) {
    return {
      midPrice: midPrice || 0,
      fillPrice: midPrice || 0,
      slippageBps: 0,
      priorityFeeLamports,
      totalFeeLamports,
    };
  }
  // Weighted average by amountOut if provided
  let sumPrice = 0;
  let sumQty = 0;
  fills.forEach((f) => {
    const qty = typeof f.amountOut === "number" && isFinite(f.amountOut) ? f.amountOut : 1;
    sumQty += qty;
    sumPrice += (f.price || 0) * qty;
  });
  const fillPrice = sumQty > 0 ? sumPrice / sumQty : fills[0].price;
  const slippageBps = midPrice > 0 ? ((fillPrice - midPrice) / midPrice) * 10_000 : 0;
  return {
    midPrice,
    fillPrice,
    slippageBps,
    priorityFeeLamports,
    totalFeeLamports,
  };
}

module.exports = { computeTca };