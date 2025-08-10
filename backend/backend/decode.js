const fs = require("fs");
const path = require("path");
const bs58 = require("bs58");

// Path to your default wallet file
const filePath = path.join(__dirname, "wallets", "default.txt");

try {
  // Read base58-encoded private key string
  const encoded = fs.readFileSync(filePath, "utf8").trim();

  // Decode to Uint8Array
  const decoded = bs58.decode(encoded);

  // Convert to array and print it
  const secretKeyArray = Array.from(decoded);
  if (process.env.LOG_LEVEL === 'debug') {
    console.log(
      "✅ Decoded secret key array:\n",
      JSON.stringify(secretKeyArray, null, 2)
    );
  }} catch (err) {
  console.error("❌ Failed to decode wallet key:", err.message);
}
