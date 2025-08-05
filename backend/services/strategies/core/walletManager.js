

const prisma = require("../../../prisma/prisma");
const loadKeypairFromEncrypted = require("../../../middleware/auth/walletFromDb");

let loadedWallets = [];               // legacy array of Keypairs
const walletMap   = new Map();        // 🆕  label -> Keypair
let currentWallet = null;
let currentIndex  = 0;

/**
 * 🚀 Load the single active wallet from the DB by userId + activeWalletId.
 */
async function initWalletFromDb(userId, activeWalletId) {
  reset();  // start fresh for single mode wallets
  const wallet = await prisma.wallet.findFirst({
    where: { id: activeWalletId, userId },
  });

  if (!wallet) {
    throw new Error("❌ No active wallet found for user.");
  }

  currentWallet = loadKeypairFromEncrypted(wallet.privateKey);
  loadedWallets = [currentWallet];
  walletMap.set(wallet.label, currentWallet);
  currentIndex = 0;

  console.log(`🔐 Loaded active wallet for user ${userId} (walletId: ${activeWalletId})`);
}

/**
 * 🔁 Load multiple wallets for rotation strategies.
 */
async function initRotationWallets(userId, walletIds = []) {
  if (!Array.isArray(walletIds) || walletIds.length === 0) {
    throw new Error("❌ No wallet IDs provided for rotation.");
  }

  const wallets = await prisma.wallet.findMany({
    where: {
      userId,
      id: { in: walletIds },
    },
  });

  if (!wallets.length) {
    throw new Error("❌ No wallets found in DB for the provided IDs.");
  }

  loadedWallets = wallets.map(w => loadKeypairFromEncrypted(w.privateKey));
  wallets.forEach((w, i) => walletMap.set(w.label, loadedWallets[i]))
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
// async function ensureMinBalance(minSol, getWalletBalance, isAboveMinBalance) {
//   const wallet = kp || current();
//   const balance = await getWalletBalance(wallet);
//   return isAboveMinBalance(balance, minSol);
// }

async function ensureMinBalance(
  minSol,
  getWalletBalance,
  isAboveMinBalance,
  wallet = null          // ✅ optional – falls back to current()
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
  byLabel,      // 🆕
  reset,
};
