"use strict";

// backend/armEncryption/resolveKeypair.js
// Unified signer resolver for protected (envelope+DEK) and unprotected (legacy/base58) wallets.

const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");
const prisma = require("../prisma/prisma");
const { getDEK } = require("./armSessionManager");
const { decryptPrivateKeyWithDEK } = require("./envelopeCrypto");
const { decryptUtf8 } = require("../middleware/auth/encryption");

function aadFor(userId, walletId) {
  return `user:${userId}:wallet:${walletId}`;
}
function zero(buf) { try { if (buf && typeof buf.fill === "function") buf.fill(0); } catch {} }

async function getKeypairForTrade(userId, walletId) {
  const w = await prisma.wallet.findFirst({
    where: { id: walletId, userId },
    select: { id: true, publicKey: true, isProtected: true, encrypted: true, privateKey: true },
  });
  if (!w) throw new Error("Wallet not found");

  const aad = aadFor(userId, walletId);

  // Protected path → requires DEK from Arm session
  if (w.isProtected) {
    if (!w.encrypted) throw new Error("Protected wallet missing encrypted blob");
    const DEK = getDEK(userId, walletId);
    if (!DEK) {
      const e = new Error("Wallet not armed");
      e.status = 401;
      e.code = "AUTOMATION_NOT_ARMED";
      throw e;
    }
    const sk = decryptPrivateKeyWithDEK(w.encrypted, DEK, aad); // raw secret key bytes
    try { return Keypair.fromSecretKey(sk); }
    finally { zero(sk); zero(DEK); }
  }

  // Unprotected path → legacy storage in `privateKey`
  if (typeof w.privateKey === "string" && w.privateKey.trim()) {
    if (w.privateKey.includes(":")) {
      // "ivHex:tagHex:cipherHex" → decrypt to base58 string, then decode to bytes
      const secretB58 = decryptUtf8(w.privateKey, { aad }).trim();
      return Keypair.fromSecretKey(bs58.decode(secretB58));
    }
    // Plain base58 (older rows)
    return Keypair.fromSecretKey(bs58.decode(w.privateKey.trim()));
  }

  if (w.encrypted) {
    // inconsistent row: looks protected but flagged unprotected
    throw new Error("Wallet appears protected but isProtected=false; clear `encrypted` or re-protect");
  }

  throw new Error("Wallet secret unavailable");
}

module.exports = { getKeypairForTrade, aadFor };
