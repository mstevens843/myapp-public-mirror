// backend/armEncryption/resolveKeypair.js
"use strict";

const { Keypair } = require("@solana/web3.js");
const prisma = require("../prisma/prisma");
const { getDEK } = require("./armSessionManager");
const { decryptPrivateKeyWithDEK } = require("./envelopeCrypto"); // PROTECTED (argon2 KEK -> DEK)
const { decryptEnvelope } = require("./envelopeCryptoUnprotected"); // UNPROTECTED (HKDF(ENCRYPTION_SECRET, user.userId))

function aadFor(userId, walletId) { return `user:${userId}:wallet:${walletId}`; }
function zero(b) { try { if (b && typeof b.fill === "function") b.fill(0); } catch {} }

function requireServerSecret() {
  if (!process.env.ENCRYPTION_SECRET) {
    const e = new Error("ENCRYPTION_SECRET missing (required for unprotected envelope unwrap)");
    e.code = "ENV_MISSING";
    e.status = 500;
    throw e;
  }
}

/**
 * Unified signer resolver with NO base58/legacy fallback.
 * - Protected: needs armed DEK
 * - Unprotected: unwrap via HKDF(ENCRYPTION_SECRET, salt = user.userId)
 */
async function getKeypairForTrade(userId, walletId) {
  const w = await prisma.wallet.findFirst({
    where: { id: walletId, userId },
    select: {
      id: true,
      publicKey: true,
      isProtected: true,
      encrypted: true,
      privateKey: true,                // only to enforce refusal if present
      user: { select: { userId: true } } // <-- external stable userId for HKDF salt
    },
  });
  if (!w) throw new Error("Wallet not found");

  const aad = aadFor(userId, walletId);

  // -------- PROTECTED path (must be armed) --------
  if (w.isProtected) {
    if (!w.encrypted) {
      const e = new Error("Protected wallet missing encrypted blob");
      e.code = "ENCRYPTED_MISSING";
      e.status = 500;
      throw e;
    }
    const DEK = getDEK(userId, walletId);
    if (!DEK) {
      const e = new Error("Wallet not armed");
      e.code = "AUTOMATION_NOT_ARMED";
      e.status = 401;
      throw e;
    }
    const sk = decryptPrivateKeyWithDEK(w.encrypted, DEK, aad); // Buffer
    try { return Keypair.fromSecretKey(sk); }
    finally { zero(sk); zero(DEK); }
  }

  // -------- UNPROTECTED *new* path (HKDF server secret) --------
  requireServerSecret();
  if (w.encrypted) {
  // handle JSON column OR legacy stringified JSON
  const blob = typeof w.encrypted === "string" ? JSON.parse(w.encrypted) : w.encrypted;
  const core = blob?.data || blob;
    const raw = decryptEnvelope({
      envelope: core,
      userId  : w.user.userId,               // salt for HKDF
      serverSecret: process.env.ENCRYPTION_SECRET,
    });
    try { return Keypair.fromSecretKey(Uint8Array.from(raw)); }
    finally { zero(raw); }
  }

  // -------- Anything else is legacy/unsupported --------
  if (w.privateKey) {
    const e = new Error(
      "Legacy wallet format detected (privateKey present). Migration required: " +
      "migrate this wallet to envelope format (unprotected or protected) before trading."
    );
    e.code = "LEGACY_PRIVATEKEY_UNSUPPORTED";
    e.status = 400;
    throw e;
  }

  const e = new Error("Wallet secret unavailable (no envelope)");
  e.code = "SECRET_MISSING";
  e.status = 500;
  throw e;
}

module.exports = { getKeypairForTrade, aadFor };
