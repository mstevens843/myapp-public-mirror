// backend/core/crypto/envelopeCrypto.js
// Envelope crypto for wallet keys: Argon2id KEK -> wraps random DEK -> wraps private key.
// AES-256-GCM, 12-byte IV, base64 payloads. We DO NOT trust any aad stored in the blob.
// Callers MUST supply AAD from context on unwrap/decrypt.

const crypto = require("crypto");
const argon2 = require("argon2");

const ALG = "AES-256-GCM";
const IV_LEN = 12;

function b64(buf){ return Buffer.isBuffer(buf) ? buf.toString("base64") : Buffer.from(buf).toString("base64"); }
function b64d(s){ return Buffer.from(s, "base64"); }
function randomBytes(n){ return crypto.randomBytes(n); }

async function deriveKEK(passphrase, salt, kdf={ m: 65536, t: 3, p: 1 }) {
  const hash = await argon2.hash(passphrase, {
    type: argon2.argon2id,
    memoryCost: kdf.m,
    timeCost: kdf.t,
    parallelism: kdf.p,
    salt,
    hashLength: 32,
    raw: true
  });
  return Buffer.from(hash);
}

function aesGcmEncrypt(key, plaintext, { iv, aad } = {}) {
  iv = iv || randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv, ct, tag };
}

function aesGcmDecrypt(key, iv, tag, ciphertext, { aad } = {}) {
  const d = crypto.createDecipheriv(ALG, key, iv);
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ciphertext), d.final()]);
}

// Encrypt a plaintext private key buffer with envelope pattern
async function encryptPrivateKey(privateKeyBuf, { passphrase, aad, kdf } = {}) {
  if (!Buffer.isBuffer(privateKeyBuf)) throw new Error("privateKeyBuf must be Buffer");
  if (!aad) throw new Error("encryptPrivateKey: aad required");
  const salt = randomBytes(16);
  const params = { m: 65536, t: 3, p: 1, ...(kdf || {}) };

  const KEK = await deriveKEK(passphrase, salt, params);
  const DEK = randomBytes(32);

  const { iv: iv1, ct: pkCipher, tag: tag1 } = aesGcmEncrypt(DEK, privateKeyBuf, { aad });
  const { iv: iv2, ct: dekCipher, tag: tag2 } = aesGcmEncrypt(KEK, DEK, { aad });

  // zeroize KEK/DEK
  KEK.fill(0);
  DEK.fill(0);

  return {
    v: 1,
    alg: ALG,
    kdf: { name: "argon2id", m: params.m, t: params.t, p: params.p, salt: b64(salt) },
    iv1: b64(iv1),
    tag1: b64(tag1),
    pkCipher: b64(pkCipher),
    iv2: b64(iv2),
    tag2: b64(tag2),
    dekCipher: b64(dekCipher),
    // keep a *hint* for observability, but callers MUST pass aad again on unwrap/decrypt
    aadHint: aad
  };
}

// Unwrap DEK using passphrase (for Arm). Returns DEK Buffer (caller must zeroize).
async function unwrapDEKWithPassphrase(blob, passphrase, aad) {
  if (!aad) throw new Error("unwrapDEKWithPassphrase: aad required");
  if (!blob || blob.v !== 1 || blob.alg !== ALG) throw new Error("Unsupported blob");
  const { kdf } = blob;
  const salt = b64d(kdf.salt);
  const KEK = await deriveKEK(passphrase, salt, kdf);
  try {
    const iv2 = b64d(blob.iv2), tag2 = b64d(blob.tag2), dekCipher = b64d(blob.dekCipher);
    const DEK = aesGcmDecrypt(KEK, iv2, tag2, dekCipher, { aad });
    KEK.fill(0);
    return DEK; // caller must zeroize later
  } catch {
    KEK.fill(0);
    throw new Error("Invalid passphrase or DEK unwrap failed");
  }
}

// Decrypt the private key using a DEK (from armed session)
function decryptPrivateKeyWithDEK(blob, DEK, aad) {
  if (!aad) throw new Error("decryptPrivateKeyWithDEK: aad required");
  const iv1 = b64d(blob.iv1), tag1 = b64d(blob.tag1), pkCipher = b64d(blob.pkCipher);
  const pk = aesGcmDecrypt(DEK, iv1, tag1, pkCipher, { aad });
  return pk; // caller must zeroize
}

module.exports = {
  encryptPrivateKey,
  unwrapDEKWithPassphrase,
  decryptPrivateKeyWithDEK,
  b64, b64d, randomBytes,
};
