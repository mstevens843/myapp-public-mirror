require("dotenv").config(); // ← no path override needed
const bs58 = require("bs58");


if (process.env.LOG_LEVEL === 'debug') {
  console.log("🔍 PRIVATE_KEY from env:", process.env.PRIVATE_KEY);
}

try {
  const key = bs58.decode(process.env.PRIVATE_KEY.trim());
  if (process.env.LOG_LEVEL === 'debug') {
    console.log("✅ Key decoded, length:", key.length);
  }
} catch (e) {
  console.error("❌ PRIVATE_KEY is invalid:", e.message);
}