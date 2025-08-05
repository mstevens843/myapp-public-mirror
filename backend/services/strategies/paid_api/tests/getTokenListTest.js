// testFreshList.js
const getFreshTokenList = require("../getFreshTokenList");

(async () => {
  const userId = "test-user"; // replace with actual test UUID if needed
  const tokens = await getFreshTokenList(userId, 20, 1000);
  console.log(`✅ Retrieved ${tokens.length} tokens:\n`);

  tokens.forEach((mint, idx) => {
    console.log(`${String(idx + 1).padStart(2, "0")}. ${mint}`);
  });
})();