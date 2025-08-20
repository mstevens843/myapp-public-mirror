// backend/services/strategies/core/walletManager.js
const prisma = require("../../../prisma/prisma");
// 🚫 Legacy decryptor (base58 plaintext) — no longer used for bots
// const loadKeypairFromEncrypted = require("../../../middleware/auth/walletFromDb");
// ✅ Unified resolver that supports PROTECTED (armed) + UNPROTECTED (envelope) wallets
const { getKeypairForTrade } = require("../../../armEncryption/resolveKeypair");

let loadedWallets = [];               // array of Keypairs
const walletMap   = new Map();        // label -> Keypair
let currentWallet = null;
let currentIndex  = 0;

/**
 * 🚀 Load the single active wallet from the DB by userId + activeWalletId.
 * Uses the new resolver so both protected (armed) and unprotected wallets work.
 */
async function initWalletFromDb(userId, activeWalletId) {
  reset();  // start fresh for single mode wallets
  const walletRow = await prisma.wallet.findFirst({
    where: { id: activeWalletId, userId },
    select: { id: true, label: true },
  });

  if (!walletRow) {
    throw new Error("❌ No active wallet found for user.");
  }

  // 🔑 Resolve signer via new encryption scheme (handles protected/unprotected)
  currentWallet = await getKeypairForTrade(userId, walletRow.id);
  loadedWallets = [currentWallet];
  walletMap.set(walletRow.label, currentWallet);
  currentIndex = 0;

  console.log(`🔐 Loaded active wallet for user ${userId} (walletId: ${activeWalletId})`);
}

/**
 * 🔁 Load multiple wallets for rotation strategies.
 * This also uses the unified resolver per wallet id.
 */
async function initRotationWallets(userId, walletIds = []) {
  if (!Array.isArray(walletIds) || walletIds.length === 0) {
    throw new Error("❌ No wallet IDs provided for rotation.");
  }

  const wallets = await prisma.wallet.findMany({
    where: { userId, id: { in: walletIds } },
    select: { id: true, label: true },
  });
  if (!wallets.length) {
    throw new Error("❌ No wallets found in DB for the provided IDs.");
  }

  // Resolve each signer; fail-fast if any cannot be loaded (e.g., protected but not armed)
  loadedWallets = await Promise.all(wallets.map((w) => getKeypairForTrade(userId, w.id)));
  wallets.forEach((w, i) => walletMap.set(w.label, loadedWallets[i]));
  currentWallet = loadedWallets[0];
  currentIndex = 0;

  console.log(`🔀 Loaded ${loadedWallets.length} rotation wallet(s) for user ${userId}`);
}

/**
 * ✅ Return the current wallet (used by all strategies)
 */
function current() {
  if (!currentWallet) {
    throw new Error("❌ No wallet loaded. Did you forget to call initWalletFromDb or initRotationWallets?");
  }
  return currentWallet;
}

/**
 * 🔁 Rotate to next wallet (for rotation strategies)
 */
function rotate() {
  if (!loadedWallets.length) {
    throw new Error("❌ No wallets loaded to rotate.");
  }
  currentIndex = (currentIndex + 1) % loadedWallets.length;
  currentWallet = loadedWallets[currentIndex];
  console.log(`🔁 Rotated to wallet #${currentIndex}`);
  return currentWallet;
}

/**
 * ✅ Convenience helper to ensure wallet meets min SOL balance
 */
async function ensureMinBalance(
  minSol,
  getWalletBalance,
  isAboveMinBalance,
  wallet = null          // ✅ optional – falls back to current()
) {
  const kp = wallet || current();
  const balance = await getWalletBalance(kp);
  return isAboveMinBalance(balance, minSol);
}

function byLabel(label) {             // 🆕
  return walletMap.get(label) || null;
}

function reset() {                    // 🆕 keep things tidy
  loadedWallets = [];
  walletMap.clear();
  currentWallet = null;
  currentIndex  = 0;
}

/**
 * 🔍 Expose all loaded wallets (for advanced bots)
 */
function all() {
  return loadedWallets;
}

module.exports = {
  initWalletFromDb,
  initRotationWallets,
  current,
  rotate,
  ensureMinBalance,
  all,
  byLabel,     
  reset,
};
