// core/crypto/envelopeCryptoUnprotected.js
const crypto = require("crypto");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");

const ALG = "aes-256-gcm";
const IV_LEN = 12;

/* -------------------------- utils / helpers -------------------------- */

function secretToBytes(sec) {
  if (!sec) throw new Error("secret is required");
  if (Buffer.isBuffer(sec)) return sec;
  if (typeof sec !== "string") throw new Error("secret must be Buffer or string");
  // hex vs base58 heuristic
  return /^[0-9a-fA-F]+$/.test(sec) && sec.length % 2 === 0
    ? Buffer.from(sec, "hex")
    : Buffer.from(bs58.decode(sec));
}

function pubkeyFromSecret(secretBytes) {
  const kp = Keypair.fromSecretKey(Uint8Array.from(secretBytes));
  return kp.publicKey.toBase58();
}

function serverSecretToBytes(s) {
  if (!s) throw new Error("ENCRYPTION_SECRET is missing");
  return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 ? Buffer.from(s, "hex") : Buffer.from(s, "utf8");
}

// HKDF(ENCRYPTION_SECRET, salt=userId, info="wallet-kek") → 32-byte KEK
function deriveKEK(serverSecret, userId) {
  const ikm = Buffer.isBuffer(serverSecret) ? serverSecret : serverSecretToBytes(serverSecret);
  return crypto.hkdfSync("sha256", ikm, Buffer.from(userId), Buffer.from("wallet-kek"), 32);
}

function buildEnvelopeJson(core) {
  return {
    v: 1,
    scheme: "envelope",
    alg: "aes-256-gcm",
    kdf: { name: "hkdf-sha256", info: "wallet-kek", salt: "userId" },
    data: core, // { wrapped, kekWrappedDek }
  };
}

/* ---------------------------- core crypto ---------------------------- */

function encryptEnvelope({ walletKey, userId, serverSecret }) {
  const kek = deriveKEK(serverSecret, userId);
  const dek = crypto.randomBytes(32);

  // Encrypt walletKey with DEK
  const iv1 = crypto.randomBytes(IV_LEN);
  const cipher1 = crypto.createCipheriv(ALG, dek, iv1);
  const ct1 = Buffer.concat([cipher1.update(walletKey), cipher1.final()]);
  const tag1 = cipher1.getAuthTag();

  // Encrypt DEK with KEK
  const iv2 = crypto.randomBytes(IV_LEN);
  const cipher2 = crypto.createCipheriv(ALG, kek, iv2);
  const ct2 = Buffer.concat([cipher2.update(dek), cipher2.final()]);
  const tag2 = cipher2.getAuthTag();

  return {
    wrapped: { ct: ct1.toString("base64"), iv: iv1.toString("base64"), tag: tag1.toString("base64") },
    kekWrappedDek: { ct: ct2.toString("base64"), iv: iv2.toString("base64"), tag: tag2.toString("base64") },
  };
}

function decryptEnvelope({ envelope, userId, serverSecret }) {
  const kek = deriveKEK(serverSecret, userId);

  // Unwrap DEK
  const { ct: ct2, iv: iv2, tag: tag2 } = envelope.kekWrappedDek;
  const decipher2 = crypto.createDecipheriv(ALG, kek, Buffer.from(iv2, "base64"));
  decipher2.setAuthTag(Buffer.from(tag2, "base64"));
  const dek = Buffer.concat([decipher2.update(Buffer.from(ct2, "base64")), decipher2.final()]);

  // Unwrap wallet key
  const { ct, iv, tag } = envelope.wrapped;
  const decipher1 = crypto.createDecipheriv(ALG, dek, Buffer.from(iv, "base64"));
  decipher1.setAuthTag(Buffer.from(tag, "base64"));
  const walletKey = Buffer.concat([decipher1.update(Buffer.from(ct, "base64")), decipher1.final()]);

  return walletKey;
}

module.exports = {
  // primitives
  encryptEnvelope,
  decryptEnvelope,
  // utilities
  buildEnvelopeJson,
  secretToBytes,
  pubkeyFromSecret,
};
