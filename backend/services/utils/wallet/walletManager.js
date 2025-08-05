/** WalletManager.js - Wallet utility for Solana Trading bot platform.
 * 
 * Features: 
 * - Load a single keypair or multiple keypairs from ./wallet
 * - Rotate wallets fro session-based trade distribution. 
 * - Fetch wallet balances. 
 * - Stubbed support for Phantom, Backpack, Solflare (future)
 * 
 * - Used by strategy files that require wallet access and by rotation-based bot logic. 
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");
const bs58 = require("bs58");




const connection = new Connection(process.env.SOLANA_RPC_URL);

// internal state
let wallets = [];
let currentIndex = 0;
let currentWallet = null;

/**
 * ✅ Load multiple keypair wallets from disk for rotation mode
 * ✅ Used for rotating wallet strategies. 
//  */
// function loadAllWallets(folder = "./wallets") {
//   const files = fs.readdirSync(folder);
//   wallets = files.map((f) => {
//     const secret = JSON.parse(fs.readFileSync(path.join(folder, f)));
//     return Keypair.fromSecretKey(new Uint8Array(secret));
//   });
//   currentWallet = wallets[0];    //  keep in sync
//   loadedWallets  = wallets;      
//   console.log(`🔐 Loaded ${wallets.length} wallets for rotation`);
//   return currentWallet;
// }

/**
 * ✅ Rotate to the next wallet (round-robin)
 * ✅ Useful for distributing trades across multiple wallets. 
 */
function rotateWallet() {
  if (wallets.length === 0) throw new Error("No wallets loaded to rotate.");
  currentIndex = (currentIndex + 1) % wallets.length;
  currentWallet = wallets[currentIndex];
  console.log(`🔁 Rotated to wallet #${currentIndex}: ${currentWallet.publicKey.toBase58()}`);
  return currentWallet;
}

/** 
 * Accept wallets array as argument
 */
function loadWalletsFromArray(secretKeys) {
  wallets = secretKeys.map((key) => {
    let secret;

    // Try base58 first (Phantom-style)
    try {
      const decoded = bs58.decode(key);
      if (decoded.length !== 64) throw new Error("Invalid base58 length");
      secret = decoded;
    } catch (e) {
      // Fallback to Uint8Array from JSON
      try {
        const parsed = JSON.parse(key);
        if (!Array.isArray(parsed) || parsed.length !== 64) throw new Error("Invalid JSON key length");
        secret = Uint8Array.from(parsed);
      } catch (e2) {
        console.error("❌ Failed to parse wallet key:", e2.message);
        throw new Error("Invalid wallet key: must be base58 or 64-byte JSON array");
      }
    }

    return Keypair.fromSecretKey(secret);
  });
 
 currentWallet = wallets[0];
 loadedWallets = wallets;            // <- keep global state in sync
  console.log(`🔐 Loaded ${wallets.length} wallet(s) from array`);
}



let loadedWallets = [];

// function loadWalletsFromLabels(walletLabels) {
//   loadedWallets = [];

//   walletLabels.forEach(label => {
//     const possibleNames = [label, `${label}.txt`, `${label}.json`];
//     const fullPaths = possibleNames.map(name =>
//       path.join(__dirname, "../../../wallets", name)
//     );

//     console.log("🔍 Looking for wallet files:", fullPaths);

//     const filePath = fullPaths.find(fp => fs.existsSync(fp));
//     if (!filePath) {
//       throw new Error(`Wallet file not found: ${label}`);
//     }

//     console.log(`📄 Matched wallet file: ${filePath}`);

//     const content = fs.readFileSync(filePath, "utf-8");
//     const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

//     lines.forEach(line => {
//       try {
//         if (line.startsWith("[")) {
//           loadedWallets.push(Keypair.fromSecretKey(new Uint8Array(JSON.parse(line))));
//         } else {
//           const decoded = bs58.decode(line);
//           if (decoded.length === 64) {
//             loadedWallets.push(Keypair.fromSecretKey(decoded));
//           } else if (decoded.length === 32) {
//             loadedWallets.push(Keypair.fromSeed(decoded));
//           } else {
//             throw new Error(`Invalid key length: ${decoded.length} bytes`);
//           }
//         }
//       } catch (err) {
//         throw new Error(`❌ Failed to parse line in wallet '${label}': ${err.message}`);
//       }
//     });
//   });

//   console.log(`🔐 Loaded ${loadedWallets.length} wallet(s) from labels:`, walletLabels);
// }


/**
 * ✅ Return current active wallet.
 */
// function getCurrentWallet() {
//   if (!currentWallet) throw new Error("No wallet loaded yet.");
//   return currentWallet;
// } 

/**
 * ✅ Returns the current wallet's balance in SOL. 
 */
/**
 * USED FOR OLD METHOD OF USING DEFaults/wallet.txt file 
 */
// async function getWalletBalance(wallet) {
//   if (!wallet) wallet = getCurrentWallet(); // ✅ fallback safely
//   const pubkey = wallet.publicKey || new PublicKey(wallet);
//   const lamports = await connection.getBalance(pubkey);
//   return lamports / 1e9;
// }

async function getWalletBalance(input) {
  // Accept: PublicKey, base-58 string, or { publicKey }
  const pubkey =
    input instanceof PublicKey
      ? input
      : new PublicKey(input?.publicKey ?? input);

  const lamports = await connection.getBalance(pubkey);
  return lamports / 1e9;
}


/**
 * ✅ Load walelt from environment or fallback to default keypair. 
 * Supported: keypair (default), phantom, backback, solflare
 */
// function loadWallet(provider = process.env.WALLET_PROVIDER || "keypair") {
//   switch (provider) {
//     case "phantom":
//       return loadPhantomWallet();
//     case "backpack":
//       return loadBackpackWallet();
//     case "solflare":
//       return loadSolflareWallet();
//     case "keypair":
//     default:
//       return loadKeypairWallet();
//   }
// }

/**
 * 🔧 Load a single keypair wallet from disk (default)
 */
// function loadKeypairWallet() {
//   const { loadKeypair } = require("./multiWalletExecutor");
//   currentWallet = loadKeypair();
//   return currentWallet;
// }

/**
 * 🚧 Stubbed wallet rpovider integrations
 * - These can be implemented in the future usigng wallett adapters or browser extensions. 
 */
function loadPhantomWallet() {
  throw new Error("Phantom wallet support not implemented yet");
}

function loadBackpackWallet() {
  throw new Error("Backpack wallet support not implemented yet");
}

function loadSolflareWallet() {
  throw new Error("Solflare wallet support not implemented yet");
}



/**
 * ✅ Return all available wallet labels from the /wallets folder
 */
// function getAvailableWalletLabels(folder = path.resolve(__dirname, "../../../wallets")) {
//   if (!fs.existsSync(folder)) {
//     console.warn("⚠️ Wallet folder not found:", folder);
//     return [];
//   }
//   return fs.readdirSync(folder);
// }
function getCurrentWallet() {
  if (!loadedWallets.length) throw new Error("No wallets loaded");
  return loadedWallets[0]; // basic single-wallet mode
}

/**
 * Wrapper used by rotationBot to pre-load wallets.
 *  – If labels were passed in the strategy config, load those.
 *  – Otherwise fall back to “wallets/” folder or a single default.txt file.
 */
// function initWallets(labels = []) {
//   if (Array.isArray(labels) && labels.length) {
//     loadWalletsFromLabels(labels);
//   } else {
//     // fallback: if wallets/default.txt exists and has 1-key-per-line
//     const fp = path.join(__dirname, "../../../wallets/default.txt");
//     if (fs.existsSync(fp)) {
//       const rows = fs.readFileSync(fp, "utf8")
//                     .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
//       loadWalletsFromArray(rows);
//     } else {
//       loadAllWallets(path.join(__dirname, "../../../wallets"));
//     }
//   }
// }

/** alias used by rotationBot */
const current = () => getCurrentWallet();


function rotate() {               // round-robin switcher
  if (!loadedWallets.length) throw new Error("No wallets loaded");
  currentIndex = (currentIndex + 1) % loadedWallets.length;
  currentWallet = loadedWallets[currentIndex];
  return currentWallet;
}

function all() {                  //  ← NEW: expose every keypair
  return loadedWallets;
}


/**
 * Ensure the current wallet holds at least `minSol` SOL.
 * Returns true if OK, false if below threshold.
 */
async function ensureMinBalance(minSol = 0.2, getBalFn, isAboveFn) {
  const bal = await getBalFn(current());
  return isAboveFn(bal, minSol);
}



/* FOR STEALTH BOT 
 * Return the Keypair for a given label (“wallet-1”, “wallet-2”, …).
 * Labels are 1-based indexes produced by /api/wallets/labels.
 */
function byLabel(label = "") {
  if (!loadedWallets.length) throw new Error("No wallets loaded");

  const m = label.match(/^wallet-(\d+)$/);
  if (!m) throw new Error(`Invalid label: ${label}`);
  const idx = Number(m[1]) - 1;
  if (idx < 0 || idx >= loadedWallets.length)
    throw new Error(`Label out of range: ${label}`);

  return loadedWallets[idx];
}





/**
 * Load wallets from Prisma DB by userId and optional label(s)
 */
async function loadWalletsFromDb({ prisma, userId, labels = [] }) {
  const { default: bs58 } = await import("bs58");
  const loadKeypairFromEncrypted = require("../../../middleware/auth/walletFromDb");

  const where = {
    userId,
    ...(labels.length > 0 && { label: { in: labels } }),
  };

  const dbWallets = await prisma.wallet.findMany({ where });

  if (!dbWallets.length) throw new Error("No wallets found in DB for user");

  // 👇 safer mapping with filtering + try/catch
  wallets = dbWallets
    .filter((w) => !!w.privateKey) // skip null/empty keys
    .map((w) => {
      try {
        return loadKeypairFromEncrypted(w.privateKey);
      } catch (err) {
        console.warn(`⚠️ Skipping wallet '${w.label}' — ${err.message}`);
        return null;
      }
    })
    .filter(Boolean); // remove nulls

  if (!wallets.length) throw new Error("All wallets failed to load from DB");

  currentWallet = wallets[0];
  loadedWallets = wallets;

  console.log(`🔐 Loaded ${wallets.length} encrypted wallet(s) from DB`);
  return currentWallet;
}




module.exports = {
  // loadAllWallets,
  rotateWallet,
  getCurrentWallet,
  getWalletBalance,
  loadWalletsFromArray,
  // loadWalletsFromLabels, 
  // getAvailableWalletLabels,
  // initWallets, 
  current,
  ensureMinBalance,
  rotate,
  byLabel,
  all, 
  loadWalletsFromDb,
};
