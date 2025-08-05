require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const crypto = require("crypto");

const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET;
console.log("🔐 ENCRYPTION_SECRET (raw):", ENCRYPTION_SECRET);
console.log("🔐 ENCRYPTION_SECRET length:", ENCRYPTION_SECRET?.length);
console.log("🧪 Buffer byte length:", Buffer.from(ENCRYPTION_SECRET || "").length);
const IV_LENGTH = 16;

function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_SECRET, "hex"), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return iv.toString("hex") + ":" + authTag + ":" + encrypted;
}

function decrypt(encryptedText) {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(ENCRYPTION_SECRET, "hex"), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

module.exports = { encrypt, decrypt };
