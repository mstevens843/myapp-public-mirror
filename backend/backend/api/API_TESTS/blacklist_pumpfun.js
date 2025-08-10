const axios = require("axios");

// ✅ Real Pump.fun token that is NOT blacklisted (tested 4/30/2025)
const mint = "3DJk9vZsLZyJ1JwdBgqhCn22yDP45sERi49BLY8Su5KZ";

async function testPumpFunCheck(mint) {
  try {
    const res = await axios.get(`https://pump.fun/api/token/${mint}`);
    const token = res.data;

    if (!token) {
      console.warn("⚠️ No token data found");
      return;
    }

    const blacklistEnabled = !!token.blacklistEnabled;
    const tradingDisabled = !!token.tradingDisabled;
    const owner = token.owner;
    const renounced = owner === "Burn111111111111111111111111111111111111111";

    console.log("\n✅ Pump.fun Safety Check Results");
    console.log("Mint Address:   ", mint);
    console.log("----------------------------------");
    console.log("Blacklist Check:", !blacklistEnabled ? "✅ Passed" : "❌ Failed");
    console.log("Trading Open:   ", !tradingDisabled ? "✅ Passed" : "❌ Failed");
    console.log("Renounced:      ", renounced ? "✅ Yes" : "❌ No");
    console.log("Owner Address:  ", owner);
    console.log("----------------------------------\n");

  } catch (err) {
    console.error("❌ Error fetching Pump.fun data:", err.response?.data || err.message);
  }
}

testPumpFunCheck(mint);
