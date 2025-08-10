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
 * Execute a swap (standard path).
 * NEW: Accepts computeUnitPriceMicroLamports/tipLamports and forwards them; these
 * override legacy priorityFee/briberyAmount if provided.
 */
async function executeSwap({
  quote,
  wallet,
  shared = false,
  priorityFee = 0,
  briberyAmount = 0,
  // NEW knobs (optional)
  computeUnitPriceMicroLamports,
  tipLamports,
}) {
  try {
    // Respect new knobs when present; fallback to legacy names.
    const cuPrice =
      computeUnitPriceMicroLamports !== undefined
        ? computeUnitPriceMicroLamports
        : priorityFee;
    const tip =
      tipLamports !== undefined
        ? tipLamports
        : briberyAmount;

    const payload = {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      useSharedAccounts: shared,                  // ✅ MEV shielding
      asLegacyTransaction: false,                 // ✅ required for shared accounts
      // prioritizationFeeLamports: cuPrice,      // (alt name in some versions)
      computeUnitPriceMicroLamports: cuPrice,
      tipLamports: tip,
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
 * Turbo path — still the ultra-fast path. Accepts the same new knobs.
 * Uses skipPreflight + optional private RPC for low latency.
 */
async function executeSwapTurbo({
  quote,
  wallet,
  shared = false,
  priorityFee = 0,
  briberyAmount = 0,
  privateRpcUrl,
  skipPreflight = true,
  // NEW knobs (optional)
  computeUnitPriceMicroLamports,
  tipLamports,
}) {
  try {
    const cuPrice =
      computeUnitPriceMicroLamports !== undefined
        ? computeUnitPriceMicroLamports
        : priorityFee;
    const tip =
      tipLamports !== undefined
        ? tipLamports
        : briberyAmount;

    const payload = {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      useSharedAccounts: shared,
      asLegacyTransaction: false,
      computeUnitPriceMicroLamports: cuPrice,
      tipLamports: tip,
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
    const serialized      = transaction.serialize();
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
 * (No change needed for new knobs, since this path’s fee is handled via tip to Jito.)
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
  executeSwapTurbo,        // fast path with new knobs
  executeSwapJitoBundle,   // optional Jito path (opt-in, no turbo slowdown)
};