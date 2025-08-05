// testTokenList.js

const { fetchCachedTokenList } = require("../tokenListCache");

(async () => {
  console.log("🔁 Running token list fetch test...");

  try {
    const list = await fetchCachedTokenList();
    console.log(`✅ Success: Got ${list.length} mints`);
    if (list.length > 0) {
      console.log("🔹 First 5 tokens:");
      console.log(list.slice(0, 5));
    } else {
      console.log("⚠️ No tokens returned.");
    }
  } catch (err) {
    console.error("❌ Error during test:", err.message);
  }
})();
