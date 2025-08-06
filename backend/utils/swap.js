/** Swap.js - Core Swap Execution + quote retrieval utility
 * 
 * Features: 
 * - Fetch swap quote from Jupiter Aggregator
 * - Execute swap via Jupiter's smart routing API
 * - Supports legacy and versioned Solana transactions
 * - Used by all trading strategies to perform real token swaps
 * - Loads wallet from env or strategy context 
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const axios = require("axios");
const { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const { sendJitoBundle } = require("./jitoBundle"); // ✅ Jito relay (no impact on turbo path)

if (!process.env.SOLANA_RPC_URL || !process.env.SOLANA_RPC_URL.startsWith("http")) {
  throw new Error("❌ Invalid or missing SOLANA_RPC_URL in .env file");
}

const RPC_URL = process.env.SOLANA_RPC_URL;
const connection = new Connection(RPC_URL, "confirmed");

// Keep using lite endpoints (keeps your existing executor happy/fast)
const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_URL  = "https://lite-api.jup.ag/swap/v1/swap";

/**
 * Load keypair from PRIVATE_KEY in .env
 */
function loadKeypair() {
  if (!process.env.PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY in .env");
  const secret = bs58.decode(process.env.PRIVATE_KEY.trim());
  return Keypair.fromSecretKey(secret);
}

/**
 * Jupiter quote with optional DEX allow/deny and split flag.
 * NOTE: This preserves your lite API shape so the rest of the code stays fast.
 */
async function getSwapQuote({
  inputMint,
  outputMint,
  amount,
  slippage,
  slippageBps,
  allowedDexes,    // [] or comma/space-separated string in caller
  excludedDexes,   // [] or comma/space-separated string in caller
  splitTrade       // boolean: hints the router to refresh / consider split routes
}) {
  let bps = slippageBps != null
    ? Number(slippageBps)
    : Math.round(parseFloat(slippage || "1.0") * 100);
  if (!bps || bps <= 0) bps = 100;

  try {
    const params = {
      inputMint,
      outputMint,
      amount,
      slippageBps: bps,
      swapMode: "ExactIn",
    };

    // --- optional router hints (ignored if not supported by lite API) ---
    if (allowedDexes && allowedDexes.length) {
      // Jupiter v6 typically takes "dexes"; lite API ignores unknown keys gracefully.
      params.dexes = Array.isArray(allowedDexes) ? allowedDexes.join(",") : String(allowedDexes);
      params.onlyDirectRoutes = false;
    }
    if (excludedDexes && excludedDexes.length) {
      params.excludeDexes = Array.isArray(excludedDexes) ? excludedDexes.join(",") : String(excludedDexes);
    }
    if (splitTrade) {
      // Encourage fresh route calc under volatility; safe to pass if unsupported.
      params.forceFetch = true;
    }

    const { data } = await axios.get(JUPITER_QUOTE_URL, { params });
    return data || null;
  } catch (err) {
    console.error("❌ Jupiter quote error:", err.response?.data || err.message);
    console.error("🔍 Params sent:", {
      inputMint, outputMint, amount,
      slippageBps: bps,
      dexes: allowedDexes, excludeDexes: excludedDexes, splitTrade
    });
    return null;
  }
}

/**
 * Execute a swap (standard path) — unchanged.
 */
async function executeSwap({ quote, wallet, shared = false, priorityFee = 0, briberyAmount = 0 }) {
  try {
    const payload = {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      useSharedAccounts: shared,                  // ✅ MEV shielding
      asLegacyTransaction: false,                 // ✅ required for shared accounts
      // prioritizationFeeLamports: priorityFee,  // alt naming in some versions
      computeUnitPriceMicroLamports: priorityFee,
      tipLamports: briberyAmount,
      useTokenLedger: false,
      dynamicComputeUnitLimit: true,
      skipUserAccountsRpcCalls: true,
      dynamicSlippage: true,
      trackingAccount: wallet.publicKey.toBase58(),
    };

    const res = await axios.post(JUPITER_SWAP_URL, payload);
    const { swapTransaction, lastValidBlockHeight, blockhash } = res.data;

    const transactionBuffer = Buffer.from(swapTransaction, "base64");
    let transaction;
    try {
      transaction = VersionedTransaction.deserialize(transactionBuffer);
    } catch {
      transaction = Transaction.from(transactionBuffer);
    }

    transaction.sign([wallet]);
    const serialized = transaction.serialize();
    const signature  = await connection.sendRawTransaction(serialized);
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    return signature;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(detail);
  }
}

/**
 * Turbo path — **unchanged** to avoid any slowdown.
 * Uses skipPreflight + optional private RPC for ultra-low latency.
 */
async function executeSwapTurbo({
  quote,
  wallet,
  shared = false,
  priorityFee = 0,
  briberyAmount = 0,
  privateRpcUrl,
  skipPreflight = true,
}) {
  try {
    const payload = {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      useSharedAccounts: shared,
      asLegacyTransaction: false,
      computeUnitPriceMicroLamports: priorityFee,
      tipLamports: briberyAmount,
      useTokenLedger: false,
      dynamicComputeUnitLimit: true,
      skipUserAccountsRpcCalls: true,
      dynamicSlippage: true,
      trackingAccount: wallet.publicKey.toBase58(),
    };

    const res = await axios.post(JUPITER_SWAP_URL, payload);
    const { swapTransaction, lastValidBlockHeight, blockhash } = res.data;

    const transactionBuffer = Buffer.from(swapTransaction, "base64");
    let transaction;
    try {
      transaction = VersionedTransaction.deserialize(transactionBuffer);
    } catch {
      transaction = Transaction.from(transactionBuffer);
    }

    transaction.sign([wallet]);
    const serialized     = transaction.serialize();
    const turboConnection = privateRpcUrl ? new Connection(privateRpcUrl, "confirmed") : connection;

    const signature = await turboConnection.sendRawTransaction(serialized, { skipPreflight });
    await turboConnection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    return signature;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(detail);
  }
}

/**
 * Jito bundle path (for Turbo when explicitly requested).
 * NOTE: This **does not** alter the turbo fast path; call this instead of executeSwapTurbo
 * only when you want Jito bundling. It reuses the same prebuilt Jupiter tx,
 * signs once, then submits via Jito’s relay with a tip — minimal overhead.
 */
async function executeSwapJitoBundle({
  quote,
  wallet,
  shared = false,
  priorityFee = 0,
  briberyAmount = 0,         // still supported, but Jito tip is separate
  jitoRelayUrl,
  jitoTipLamports = 1000,    // bundle tip
}) {
  try {
    const payload = {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      useSharedAccounts: shared,
      asLegacyTransaction: false,
      computeUnitPriceMicroLamports: priorityFee,
      tipLamports: briberyAmount,   // optional; separate from Jito tip
      useTokenLedger: false,
      dynamicComputeUnitLimit: true,
      skipUserAccountsRpcCalls: true,
      dynamicSlippage: true,
      trackingAccount: wallet.publicKey.toBase58(),
    };

    const res = await axios.post(JUPITER_SWAP_URL, payload);
    const { swapTransaction } = res.data;

    const buf = Buffer.from(swapTransaction, "base64");
    let tx;
    try {
      tx = VersionedTransaction.deserialize(buf);
    } catch {
      tx = Transaction.from(buf);
    }

    tx.sign([wallet]);
    const result = await sendJitoBundle([tx], { jitoTipLamports, relayUrl: jitoRelayUrl || process.env.JITO_RELAY_URL });
    // result may be bundle id or signature depending on relay implementation
    return result;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(detail);
  }
}

module.exports = {
  loadKeypair,
  getSwapQuote,
  executeSwap,
  executeSwapTurbo,        // unchanged fast path
  executeSwapJitoBundle,   // optional Jito path (opt-in, no turbo slowdown)
};









/** Swap.js - Core Swap Execution + quote retrieval utility
 *
 * This module is copied from the original repository and extended to add a
 * turbo execution path for sniper bots. Turbo mode uses an optional
 * private RPC node and skips preflight checks to minimise latency when
 * submitting transactions【161345157167807†L148-L187】. This is critical for
 * catching newly listed tokens before the price spikes.
 */
// require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
// const axios = require("axios");
// const { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } = require("@solana/web3.js");
// const bs58 = require("bs58");

// if (!process.env.SOLANA_RPC_URL || !process.env.SOLANA_RPC_URL.startsWith("http")) {
//   throw new Error("❌ Invalid or missing SOLANA_RPC_URL in .env file");
// }

// const RPC_URL = process.env.SOLANA_RPC_URL;
// const connection = new Connection(RPC_URL, "confirmed");

// const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
// const JUPITER_SWAP_URL  = "https://lite-api.jup.ag/swap/v1/swap";

// /**
//  * Load keypair from PRIVATE_KEY in .env
//  * This is the primary trading wallet used for all transactions.
//  */
// function loadKeypair() {
//   if (!process.env.PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY in .env");
//   const secret = bs58.decode(process.env.PRIVATE_KEY.trim());
//   return Keypair.fromSecretKey(secret);
// }

// async function getSwapQuote({ inputMint, outputMint, amount, slippage, slippageBps }) {
//   let bps = slippageBps != null ? Number(slippageBps) : Math.round(parseFloat(slippage || "1.0") * 100);
//   if (!bps || bps <= 0) bps = 100;
//   try {
//     const params = {
//       inputMint,
//       outputMint,
//       amount,
//       slippageBps: bps,
//       swapMode: "ExactIn",
//     };
//     const { data } = await axios.get(JUPITER_QUOTE_URL, { params });
//     return data || null;
//   } catch (err) {
//     console.error("❌ Jupiter quote error:", err.response?.data || err.message);
//     console.error(" Params sent:", { inputMint, outputMint, amount, slippageBps: bps });
//     return null;
//   }
// }

// /**
//  * Execute a swap based on the provided Jupiter quote.
//  * Signs and sends the transaction via the default RPC connection.
//  */
// async function executeSwap({ quote, wallet, shared = false, priorityFee = 0, briberyAmount = 0 }) {
//   try {
//     const payload = {
//       quoteResponse: quote,
//       userPublicKey: wallet.publicKey.toBase58(),
//       wrapAndUnwrapSol: true,
//       useSharedAccounts: shared,
//       asLegacyTransaction: false,
//       computeUnitPriceMicroLamports: priorityFee,
//       tipLamports: briberyAmount,
//       useTokenLedger: false,
//       dynamicComputeUnitLimit: true,
//       skipUserAccountsRpcCalls: true,
//       dynamicSlippage: true,
//       trackingAccount: wallet.publicKey.toBase58(),
//     };
//     console.log(" Executing swap with Jupiter:");
//     console.log("→ MEV Mode:", shared ? "secure (shared)" : "fast (direct)");
//     console.log("→ Priority Fee:", priorityFee || 0, "µLAM");
//     console.log("→ Validator Bribe:", briberyAmount || 0, "lamports");
//     console.log("→ Quote route summary:", {
//       input: quote.inputMint,
//       output: quote.outputMint,
//       inAmount: quote.inAmount,
//       outAmount: quote.outAmount,
//       priceImpact: quote.priceImpactPct,
//     });
//     const res = await axios.post(JUPITER_SWAP_URL, payload);
//     const { swapTransaction, lastValidBlockHeight, blockhash } = res.data;
//     const transactionBuffer = Buffer.from(swapTransaction, "base64");
//     let transaction;
//     try {
//       transaction = VersionedTransaction.deserialize(transactionBuffer);
//     } catch (e) {
//       console.warn("⚠️ Failed to deserialize as VersionedTransaction, using legacy.");
//       transaction = Transaction.from(transactionBuffer);
//     }
//     transaction.sign([wallet]);
//     const serialized = transaction.serialize();
//     const signature = await connection.sendRawTransaction(serialized);
//     console.log(" Sent transaction:", signature);
//     await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
//     console.log("✅ Swap confirmed:", `https://explorer.solana.com/tx/${signature}?cluster=mainnet-beta`);
//     return signature;
//   } catch (err) {
//     const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
//     throw new Error(detail);
//   }
// }

/**
 * Execute a swap using turbo mode. Turbo mode optimises for ultra‑fast
 * execution by sending the signed transaction through an optional private RPC
 * and skipping preflight checks. It also supports overriding the connection
 * entirely by supplying a `privateRpcUrl`. If not supplied the global
 * connection is used.
 *
 * See RPC Fast's article on sniper bots for details on why private RPCs,
 * pre‑signed transactions and priority fees help gain an edge in speed【161345157167807†L148-L187】.
 */

