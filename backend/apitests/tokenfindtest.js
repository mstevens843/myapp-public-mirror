// // tokenInfoTest.js
// const { getTokenPrice, getTokenPriceChange, getTokenVolume } = require("../utils/marketData");

// const testMint = "So11111111111111111111111111111111111111112"; // Wrapped SOL

// (async () => {
//   try {
//     const price = await getTokenPrice(testMint);
//     const change = await getTokenPriceChange(testMint);
//     const volume = await getTokenVolume(testMint);

//     console.log(`🪙 Token: ${testMint}`);
//     console.log(`💵 Price: $${price}`);
//     console.log(`📈 24h Change: ${(change * 100).toFixed(2)}%`);
//     console.log(`🔁 24h Volume: $${volume.toLocaleString()}`);
//   } catch (err) {
//     console.error("❌ Test failed:", err.message);
//   }
// })();
