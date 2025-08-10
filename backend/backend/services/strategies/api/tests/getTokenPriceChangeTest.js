const axios = require("axios");
require("dotenv").config({ path: __dirname + "/../../../../.env" });

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const mint = "So11111111111111111111111111111111111111112"; // SOL

(async () => {
  try {
    const { data } = await axios.get("https://public-api.birdeye.so/defi/price", {
      params: {
        address: mint,
        include_liquidity: true,
      },
      headers: {
        "x-chain": "solana",
        "X-API-KEY": BIRDEYE_API_KEY,
        accept: "application/json",
      },
    });

    console.dir(data, { depth: null });
  } catch (err) {
    console.error("❌ Raw fetch failed:", err.response?.status, err.response?.data || err.message);
  }
})();