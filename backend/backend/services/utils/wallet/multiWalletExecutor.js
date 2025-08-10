/** Multi-wallet Executor Module 
 * - Loads multiple wallets from a local folder.
 * - Rotates through them using 
 *      - round-robin
 *      - random mode. 
 * - Can be used to run any strategy under multiple identities. 
 * 
 * Configurable: 
 * - Folder: `/wallets`
 * - Wallets: Plain .txts with base58-encoded private keys 1 per file)
 * - Optional ENV: WALLET_ROTATION_MODE = "round" | "random"
 * - Wallet folder path 
 * 
 * Eventually Support:
 * - PnL tracking per wallet
 * - Rotation limits / bans
 * - GUI wallet assignment per strategy 
 */


const fs = require("fs");
const path = require("path");
const bs58 = require("bs58");
const { Keypair } = require("@solana/web3.js");

const WALLET_DIR = path.join(__dirname, "../../../wallets");
const ROTATION_MODE = process.env.WALLET_ROTATION_MODE || "round";

let walletIndex = 0;

/**
 * Loads all wallet files from disk, supports multiple lines per file.
 * Each line is treated as a separate private key.
 */
function loadWallets() {
  // if (!fs.existsSync(WALLET_DIR)) {
  //   console.error("❌ wallets/ folder not found. Please create it and add wallet files.");
  //   process.exit(1);
  // }

  // const files = fs.readdirSync(WALLET_DIR).filter(f => !f.startsWith("."));

  // if (!files.length) {
  //   console.error("❌ No wallet files found in /wallets.");
  //   process.exit(1);
  // }

  // let wallets = [];

  // files.forEach(file => {
  //   const content = fs.readFileSync(path.join(WALLET_DIR, file), "utf-8");
  //   const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  //   lines.forEach(line => {
  //     try {
  //       if (line.startsWith("[")) {
  //         // JSON array format
  //         wallets.push(Keypair.fromSecretKey(new Uint8Array(JSON.parse(line))));
  //       } else {
  //         // base58 format
  //         const decoded = bs58.decode(line);
  //         if (decoded.length === 64) {
  //           wallets.push(Keypair.fromSecretKey(decoded));
  //         } else if (decoded.length === 32) {
  //           wallets.push(Keypair.fromSeed(decoded));
  //         } else {
  //           throw new Error(`Invalid key length: ${decoded.length} bytes`);
  //         }
  //       }
  //     } catch (err) {
  //       console.error(`❌ Failed to parse wallet in ${file}:`, err.message);
  //       process.exit(1);
  //     }
  //   });
  // });

  // console.log(`🔐 Loaded ${wallets.length} wallet(s) from ${files.length} file(s).`);
  // return wallets;
}

const wallets = loadWallets();

/**
 * Rotates and returns the next wallet
 * - Random mode: picks randomly from wallet pool.
 * - Round mode: cycles in order.
 */
function getWallet() {
  if (ROTATION_MODE === "random") {
    const index = Math.floor(Math.random() * wallets.length);
    return wallets[index];
  }
  const wallet = wallets[walletIndex];
  walletIndex = (walletIndex + 1) % wallets.length;
  return wallet;
}

module.exports = { getWallet, walletCount: wallets.length };

