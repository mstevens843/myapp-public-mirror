// backend/utils/encryption/armEncryption.js
//
// This module implements envelope encryption for the Arm‑to‑Trade feature.
// A random 256‑bit Data Encryption Key (DEK) encrypts the raw private key
// via AES‑256‑GCM; the DEK itself is encrypted (“wrapped”) under a Key
// Encryption Key (KEK) derived from the user’s passphrase using Argon2id.
// All encryption operations support optional Additional Authenticated
// Data (AAD) to bind ciphertexts to a specific user/wallet context.

const crypto = require('node:crypto');
const argon2 = require('argon2');

const IV_LEN   = 12;  // 96‑bit IV for GCM
const SALT_LEN = 16;  // 128‑bit salt for Argon2
const KEY_LEN  = 32;  // 256‑bit keys for KEK/DEK

function rand(len) {
  return crypto.randomBytes(len);
}
async function deriveKEK(passphrase, salt) {
  return argon2.hash(passphrase, {
    type: argon2.argon2id,
    salt,
    hashLength: KEY_LEN,
    raw: true,
    timeCost: 3,
    memoryCost: 2 ** 16,
    parallelism: 1,
  });
}
function aesGcmEncrypt(key, plaintext, aad = '') {
  const iv    = rand(IV_LEN);
  const cipher= crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct    = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag   = cipher.getAuthTag();
  return { ct, iv, tag };
}
function aesGcmDecrypt(key, { ct, iv, tag }, aad = '') {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}
function generateDEK() {
  return rand(KEY_LEN);
}
async function wrapDEK(dek, passphrase) {
  const salt = rand(SALT_LEN);
  const kek  = await deriveKEK(passphrase, salt);
  const { ct, iv, tag } = aesGcmEncrypt(kek, dek);
  kek.fill(0);
  return {
    dekCipher: ct.toString('base64'),
    dekIV   : iv.toString('base64'),
    dekTag  : tag.toString('base64'),
    salt    : salt.toString('base64'),
  };
}
async function unwrapDEK(wrapped, passphrase) {
  const salt   = Buffer.from(wrapped.salt, 'base64');
  const dekCt  = Buffer.from(wrapped.dekCipher, 'base64');
  const dekIV  = Buffer.from(wrapped.dekIV, 'base64');
  const dekTag = Buffer.from(wrapped.dekTag, 'base64');
  const kek    = await deriveKEK(passphrase, salt);
  try {
    return aesGcmDecrypt(kek, { ct: dekCt, iv: dekIV, tag: dekTag });
  } finally {
    kek.fill(0);
  }
}
function encryptPrivateKey(pkBuf, dek, aad) {
  const { ct, iv, tag } = aesGcmEncrypt(dek, pkBuf, aad);
  return {
    pkCipher: ct.toString('base64'),
    pkIV    : iv.toString('base64'),
    pkTag   : tag.toString('base64'),
  };
}
function decryptPrivateKey(blob, dek, aad) {
  const pkCt  = Buffer.from(blob.pkCipher, 'base64');
  const pkIV  = Buffer.from(blob.pkIV, 'base64');
  const pkTag = Buffer.from(blob.pkTag, 'base64');
  return aesGcmDecrypt(dek, { ct: pkCt, iv: pkIV, tag: pkTag }, aad);
}

module.exports = {
  generateDEK,
  wrapDEK,
  unwrapDEK,
  encryptPrivateKey,
  decryptPrivateKey,
};
