// /mock/sampleWatchlist.js

// const mockTokens = [
//     {
//       mint: "So11111111111111111111111111111111111111112",
//       addedAt: "2025-04-20T12:00:00Z",
//       safety: {
//         passed: true,
//         breakdown: {
//           birdeyeSafe: true,
//           pumpSafe: true,
//           solanaFMSafe: true,
//           simulationSafe: true,
//         },
//       },
//     },
//     {
//       mint: "FakeTokenABC111111111111111111111111111111",
//       addedAt: "2025-04-19T18:00:00Z",
//       safety: {
//         passed: false,
//         breakdown: {
//           birdeyeSafe: false,
//           pumpSafe: true,
//           solanaFMSafe: false,
//           simulationSafe: true,
//         },
//       },
//     },
//     {
//       mint: "RugPullXYZ999999999999999999999999999999",
//       addedAt: "2025-04-18T10:30:00Z",
//       safety: {
//         passed: false,
//         breakdown: {
//           birdeyeSafe: false,
//           pumpSafe: false,
//           solanaFMSafe: false,
//           simulationSafe: false,
//         },
//       },
//     },
//   ];
  
const mockTokens = [
    {
      mint: "So11111111111111111111111111111111111111112",
      addedAt: "2025-04-20T12:00:00.000Z",
      safety: {
        passed: true,
        breakdown: {
          honeypot: true,
          liquidity: true,
          blacklist: true,
          ownership: true,
          verified: true,
          tradingOpen: true,
          freezeAuthority: true,
          mintAuthorityOwned: true,
          topHolderRisk: true,
        },
      },
    },
    {
      mint: "Rug11111111111111111111111111111111111111111",
      addedAt: "2025-04-20T12:05:00.000Z",
      safety: {
        passed: false,
        breakdown: {
          honeypot: false,
          liquidity: true,
          blacklist: false,
          ownership: false,
          verified: true,
          tradingOpen: false,
          freezeAuthority: false,
          mintAuthorityOwned: false,
          topHolderRisk: true,
        },
      },
    },
    {
      mint: "JUPfakeTokenAddress9999999999999999999999999",
      addedAt: "2025-04-20T12:10:00.000Z",
      safety: {
        passed: false,
        breakdown: {
          honeypot: true,
          liquidity: false,
          blacklist: true,
          ownership: true,
          verified: false,
          tradingOpen: true,
          freezeAuthority: true,
          mintAuthorityOwned: true,
          topHolderRisk: false,
        },
      },
    },
  ];
    
  
  export default mockTokens;
  