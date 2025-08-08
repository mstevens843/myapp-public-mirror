// utils/solPrice.js

export async function solPrice(mint) {
  if (mint === "So11111111111111111111111111111111111111112") {
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
      const json = await res.json();
      return json.solana.usd;
    } catch (e) {
      console.warn("CoinGecko fallback failed", e.message);
      return null;
    }
  }

  // Otherwise use Birdeye
  try {
    const res = await fetch(`https://public-api.birdeye.so/public/price?address=${mint}`);
    const { data } = await res.json();
    return data.value;
  } catch (e) {
    console.warn("Birdeye fetch failed", e.message);
    return null;
  }
}

// 🆕 add this helper for use in the modal:
export async function getSolPrice() {
  return solPrice("So11111111111111111111111111111111111111112");
}
