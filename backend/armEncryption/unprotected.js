// services/wallets/unprotected.js
// Tiny service layer that injects process.env + Prisma, and calls pure crypto.

const prismaDefault = require("../prisma/prisma");
const {
  encryptEnvelope,
  decryptEnvelope,
  buildEnvelopeJson,
  secretToBytes,
  pubkeyFromSecret,
} = require("./envelopeCryptoUnprotected");

const SERVER_SECRET = process.env.ENCRYPTION_SECRET;
function ensureServerSecret() {
  if (!SERVER_SECRET) throw new Error("ENCRYPTION_SECRET missing");
}

/**
 * Create a new UNPROTECTED wallet row.
 * args: { prismaClient?, dbUserId, aadUserId, label, secretKey, publicKey? }
 * returns: { id, publicKey, label, isProtected }
 */
async function createUnprotectedWallet({
  prismaClient = prismaDefault,
  dbUserId,
  aadUserId,
  label,
  secretKey,
  publicKey: suppliedPub,
}) {
  ensureServerSecret();
  if (!prismaClient) throw new Error("prisma client not available");
  if (!dbUserId || !aadUserId || !label || !secretKey)
    throw new Error("dbUserId, aadUserId, label, secretKey required");

  const secretBytes = secretToBytes(secretKey);
  const publicKey = suppliedPub || pubkeyFromSecret(secretBytes);

  const core = encryptEnvelope({ walletKey: Buffer.from(secretBytes), userId: aadUserId, serverSecret: SERVER_SECRET });
  const envelope = buildEnvelopeJson(core);

  const wallet = await prismaClient.wallet.create({
    data: {
      userId: dbUserId,          // FK → User.id
      label,
      publicKey,
      encrypted: envelope,       // JSON column
      isProtected: false,
      encryptionVersion: 1,
      passphraseHash: null,
      passphraseHint: null,
      privateKey: null,          // never store plaintext
    },
    select: { id: true, publicKey: true, label: true, isProtected: true },
  });

  return wallet;
}

/**
 * Unlock an UNPROTECTED wallet and return the raw secret key (Buffer).
 * args: { prismaClient?, dbUserId, aadUserId, walletId?, publicKey? }
 * returns: { walletId, secretKey }
 */
async function unlockUnprotectedWallet({
  prismaClient = prismaDefault,
  dbUserId,
  aadUserId,
  walletId,
  publicKey,
}) {
  ensureServerSecret();
  if (!prismaClient) throw new Error("prisma client not available");
  if (!dbUserId) throw new Error("dbUserId required");
  if (!walletId && !publicKey) throw new Error("walletId or publicKey required");

  const where = walletId ? { id: Number(walletId) } : { publicKey };
  const wallet = await prismaClient.wallet.findFirst({
    where: { ...where, userId: dbUserId },
    select: { id: true, encrypted: true, isProtected: true },
  });
  if (!wallet) throw new Error("Wallet not found for user");
  if (wallet.isProtected) throw new Error("Wallet is protected; use protected unlock path");

  const core = wallet.encrypted?.data || wallet.encrypted;
  const rawKey = decryptEnvelope({ envelope: core, userId: aadUserId, serverSecret: SERVER_SECRET });
  return { walletId: wallet.id, secretKey: rawKey };
}

/**
 * One-shot migration for legacy plaintext wallets → unprotected envelope.
 * args: { prismaClient?, dbUserId, walletId }
 * returns: { walletId, migrated: boolean }
 */
async function migratePlaintextToUnprotected({
  prismaClient = prismaDefault,
  dbUserId,
  walletId,
  aadUserId,  // needed to HKDF on user.userId
}) {
  ensureServerSecret();
  if (!prismaClient) throw new Error("prisma client not available");
  if (!dbUserId || !walletId || !aadUserId) throw new Error("dbUserId, walletId, aadUserId required");

  const row = await prismaClient.wallet.findFirst({
    where: { id: Number(walletId), userId: dbUserId },
    select: { id: true, privateKey: true, encrypted: true, isProtected: true },
  });
  if (!row) throw new Error("Wallet not found");
  if (row.encrypted && row.privateKey == null) return { walletId: row.id, migrated: false };
  if (row.isProtected) throw new Error("Wallet is protected; not migrating to unprotected");

  const secretBytes = secretToBytes(row.privateKey);
  const core = encryptEnvelope({ walletKey: Buffer.from(secretBytes), userId: aadUserId, serverSecret: SERVER_SECRET });
  const envelope = buildEnvelopeJson(core);

  await prismaClient.wallet.update({
    where: { id: row.id },
    data: { encrypted: envelope, privateKey: null, isProtected: false, encryptionVersion: 1 },
  });

  return { walletId: row.id, migrated: true };
}

module.exports = {
  createUnprotectedWallet,
  unlockUnprotectedWallet,
  migratePlaintextToUnprotected,
};
