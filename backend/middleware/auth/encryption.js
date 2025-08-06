// backend/middleware/auth/encryption.js
const crypto = require("crypto");

const ALG = "aes-256-gcm";
const IV_LEN = 12; // 96-bit recommended for GCM

// Newest first; add ENCRYPTION_SECRET_OLD for rotation
const KEY_HEXES = [
  process.env.ENCRYPTION_SECRET,
  process.env.ENCRYPTION_SECRET_OLD || null,
].filter(Boolean);

if (KEY_HEXES.length === 0) {
  throw new Error("ENCRYPTION_SECRET is required");
}

const KEYS = KEY_HEXES.map((hex, i) => {
  if (!/^[0-9a-fA-F]{64}$/.test(hex || "")) {
    throw new Error(`Invalid ENCRYPTION_SECRET[${i}] – must be 64 hex chars (32 bytes hex).`);
  }
  return Buffer.from(hex, "hex");
});

const KIDS = Object.freeze(KEYS.map((_, i) => `k${i}`));

function _encryptBuffer(buf, { aad = "" } = {}) {
  if (!Buffer.isBuffer(buf)) throw new Error("encrypt: input must be Buffer");
  const key = KEYS[0];
  const kid = KIDS[0];
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "AES-256-GCM",
    kid,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
    // NOTE: we do NOT store aad here; callers must supply the expected AAD on decrypt()
  };
}

function encrypt(input, opts = {}) {
  // Accept string or Buffer; return payload object
  if (Buffer.isBuffer(input)) return _encryptBuffer(input, opts);
  return _encryptBuffer(Buffer.from(String(input), "utf8"), opts);
}

function decrypt(payload, { aad = "" } = {}) {
  try {
    // Back-compat for legacy "ivHex:tagHex:cipherHex"
    if (typeof payload === "string" && payload.includes(":")) {
      return _decryptLegacy(payload);
    }

    const { v, alg, kid, iv, tag, ct } = payload || {};
    if (v !== 1 || alg !== "AES-256-GCM") throw new Error("bad-format");
    const keyIdx = KIDS.indexOf(kid);
    if (keyIdx < 0) throw new Error("bad-kid");
    const key = KEYS[keyIdx];

    const ivB  = Buffer.from(iv,  "base64");
    const tagB = Buffer.from(tag, "base64");
    const ctB  = Buffer.from(ct,  "base64");

    const d = crypto.createDecipheriv(ALG, key, ivB);
    if (aad) d.setAAD(Buffer.from(aad));
    d.setAuthTag(tagB);

    const pt = Buffer.concat([d.update(ctB), d.final()]);
    // copy out & zeroize temp buffer
    const out = Buffer.from(pt);
    pt.fill(0);
    return out;
  } catch {
    // Uniform error to avoid oracle behavior
    throw new Error("Decryption failed");
  }
}

function decryptUtf8(payload, opts = {}) {
  const buf = decrypt(payload, opts);
  try {
    return buf.toString("utf8");
  } finally {
    buf.fill(0);
  }
}

function _decryptLegacy(s) {
  const [ivHex, tagHex, encHex] = s.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ct = Buffer.from(encHex, "hex");

  for (const key of KEYS) {
    try {
      const d = crypto.createDecipheriv(ALG, key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]);
    } catch {
      // try next key
    }
  }
  throw new Error("Decryption failed");
}

module.exports = { encrypt, decrypt, decryptUtf8 };
