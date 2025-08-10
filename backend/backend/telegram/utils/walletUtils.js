// const { getCurrentWallet, getWalletBalance } = require("../../services/utils/wallet/walletManager");
// const { getTokenBalance } = require("../../utils/marketData");
// const { getTokenPriceFromJupiter } = require("../../services/utils/math/priceUtils");

// /**
//  * ✅ Get full wallet breakdown (SOL + top tokens)
//  * Used for Telegram wallet view or future frontend expansion.
//  */
// async function getWalletOverview() {
//   const wallet = getCurrentWallet();
//   const solBalance = await getWalletBalance(wallet);

//   // 🧠 Define tracked tokens (edit or move to config later)
//   const tokensToTrack = [
//     { mint: "So11111111111111111111111111111111111111112", name: "SOL" },
//     { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", name: "USDC" },
//     { mint: "DezXH7mvdaH5P2GSN3sCfjFPAoWYr1jqF3M9Z7cW8yQz", name: "BONK" },
//     { mint: "SLERF_MINT_HERE", name: "SLERF" },
//     { mint: "FREN_MINT_HERE", name: "FREN" },
//   ];

//   const tokens = [];

//   for (const { mint, name } of tokensToTrack) {
//     const amount = await getTokenBalance(wallet.publicKey, mint);
//     const price = await getTokenPriceFromJupiter(mint);
//     tokens.push({
//       name: name?.replace(/[^\x20-\x7E]/g, "") || "Unknown",
//       amount,
//       valueUSD: +(amount * price).toFixed(2),
//     });
//   }

//   const solPrice = await getTokenPrice("So11111111111111111111111111111111111111112");
//   const totalValueUSD = tokens.reduce((sum, t) => sum + t.valueUSD, solBalance * solPrice);

//   return {
//     solBalance: +solBalance.toFixed(3),
//     totalValueUSD: +totalValueUSD.toFixed(2),
//     tokens,
//   };
// }

// module.exports = {
//   getWalletOverview,
// };
