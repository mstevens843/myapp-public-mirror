const mockOpenTrades = [
    {
      mint: "JUP0000000000000000000000000000000000000",
      entryPrice: 0.0012,
      inAmount: 1500000000, // 1.5 SOL
      strategy: "sniper",
      timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 mins ago
    },
    {
      mint: "BONK000000000000000000000000000000000000",
      entryPrice: 0.0000024,
      inAmount: 900000000, // 0.9 SOL
      strategy: "breakout",
      timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 mins ago
    },
    {
      mint: "WIF0000000000000000000000000000000000000",
      entryPrice: 0.0031,
      inAmount: 2000000000, // 2 SOL
      strategy: "chadMode",
      timestamp: new Date(Date.now() - 90 * 60 * 1000).toISOString(), // 1.5h ago
    },
  ];
  
  /**
   * Safely mock a current price for given token mint.
   * Applies small positive/negative fluctuation for realism.
   */
  export const getMockPrice = (mint) => {
    let base;
  
    if (mint.startsWith("BONK")) base = 0.0000029;
    else if (mint.startsWith("JUP")) base = 0.0015;
    else if (mint.startsWith("WIF")) base = 0.0026;
    else base = 0.001;
  
    const fluctuation = Math.random() * 0.0002 - 0.0001; // ±0.0001
    return Math.max(0.0000001, +(base + fluctuation).toFixed(8)); // prevent negative + round
  };
  
  export default mockOpenTrades;
  