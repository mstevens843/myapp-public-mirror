const bs58 = require("bs58");
const { decrypt } = require("./encryption");
const { Keypair } = require("@solana/web3.js");

function loadKeypairFromEncrypted(privateKeyEncrypted) {
  if (!privateKeyEncrypted) throw new Error("❌ Missing encrypted private key");

  const decrypted = decrypt(privateKeyEncrypted);
  const secretKey = bs58.decode(decrypted);

  if (secretKey.length !== 64) {
    throw new Error("❌ Invalid secret key length after decryption");
  }

  return Keypair.fromSecretKey(secretKey);
}

module.exports = loadKeypairFromEncrypted;