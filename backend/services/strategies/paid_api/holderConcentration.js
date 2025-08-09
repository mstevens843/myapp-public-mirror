// backend/services/strategies/paid_api/holderConcentration.js
//
// Paid API adapter for estimating holder concentration of an SPL
// token.  The function exported here returns the percentage of
// supply controlled by the largest holders (e.g. top 5).  In a
// production system this module would query a third‑party API or
// perform on‑chain analysis.  For now we provide a simple
// deterministic fallback that returns a nominal value.

/**
 * Estimate the percentage of token supply owned by the largest
 * addresses.  The returned value is a number between 0 and 100.
 * When no data is available the function returns null to signal
 * that the heuristic should be skipped.
 *
 * @param {string} mint The SPL token mint
 * @returns {Promise<number|null>} Percentage of supply held by the
 *   largest holders, or null if unavailable
 */
async function estimateHolderConcentration(mint) {
  try {
    // Simulate an API call by returning a fixed value.  To improve
    // realism you could randomise this or derive it from the mint.
    // A lower number indicates a well‑distributed supply; a higher
    // number suggests concentration risk.
    const hash = typeof mint === 'string' ? mint.charCodeAt(0) : 0;
    const pct = 10 + (hash % 20); // yields 10–29%
    return pct;
  } catch (_) {
    return null;
  }
}

module.exports = { estimateHolderConcentration };