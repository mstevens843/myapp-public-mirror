// LAMPORT Conversion Utilities
// To handle normalized price comparisons, percent changes, or average deltas. 
// Used throughout all strategy and wallet logic for accurate math. 

// Converts SOL to lamports

const fetch = require("node-fetch");

// ----------------------
// Percent Change Math
// ----------------------

function getPercentageChange(oldPrice, newPrice) {
  return ((newPrice - oldPrice) / oldPrice);
}

function isPriceAboveThreshold(current, reference, threshold) {
  return getPercentageChange(reference, current) >= threshold;
}

// ----------------------
// Token Price Fetcher
// ----------------------

async function getTokenPriceFromJupiter(mint) {
  try {
        // Special case for SOL (Jupiter no longer includes price in token metadata)
        if (mint === "So11111111111111111111111111111111111111112") {
          const url = `https://lite-api.jup.ag/price/v2?ids=${mint}`;
          const res = await axios.get(url);
          return parseFloat(res.data?.data?.[mint]?.price) || 0;
        }
    
        // Default path for other tokens
        const token = await getTokenList(mint);
        return token?.price || 0;
      } catch (err) {
        console.warn(`⚠️ Failed to fetch price for ${mint}`);
        return 0;
      }
    }
    
// ----------------------
// Export
// ----------------------

module.exports = {
  getPercentageChange,
  isPriceAboveThreshold,
  getTokenPriceFromJupiter, // ✅ FIXED typo here
};
