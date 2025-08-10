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
// Token Price Fetcher (v2, working version)
// ----------------------

async function getTokenPriceFromJupiter(mint) {
  const url = `https://lite-api.jup.ag/price/v2?ids=${mint}`;

  try {
    const res = await fetch(url);
    const text = await res.text();

    // Fallback in case of HTML or plain-text error
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      throw new Error("Response not JSON");
    }

    if (data?.data?.[mint]?.price) {
      return parseFloat(data.data[mint].price);
    }

    throw new Error("No price in response");
  } catch (err) {
    console.warn(`⚠️ Failed to fetch price for ${mint}: ${err.message}. Using fallback.`);
    return 0.001; // fallback price
  }
}

// ----------------------
// Export
// ----------------------

module.exports = {
  getPercentageChange,
  isPriceAboveThreshold,
  getTokenPriceFromJupiter,
};