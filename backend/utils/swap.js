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

if (!process.env.SOLANA_RPC_URL || !process.env.SOLANA_RPC_URL.startsWith("http")) {
  throw new Error("❌ Invalid or missing SOLANA_RPC_URL in .env file");
}

const RPC_URL = process.env.SOLANA_RPC_URL;
const connection = new Connection(RPC_URL, "confirmed");

const JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1/quote";
const JUPITER_SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";

/**
 * Load keypair from PRIVATE_KEY ub .env
 * This is the primary trading wallet used for all transacitons; 
 */
function loadKeypair() {
  if (!process.env.PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY in .env");
  const secret = bs58.decode(process.env.PRIVATE_KEY.trim());
  return Keypair.fromSecretKey(secret);
}

async function getSwapQuote({ inputMint, outputMint, amount, slippage, slippageBps }) {
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
      swapMode: "ExactIn"
    };

    const { data } = await axios.get(JUPITER_QUOTE_URL, { params });
    return data || null;
  } catch (err) {
    console.error("❌ Jupiter quote error:", err.response?.data || err.message);
    console.error("🔍 Params sent:", { inputMint, outputMint, amount, slippageBps: bps });
    return null;
  }
}

/**
 * Execute a swap based on the provided Jupiter quote
 * - Signs and sends transactions to Solana via Jupiter's API. 
 */
async function executeSwap({ quote, wallet, shared = false, priorityFee = 0, briberyAmount = 0    }) {
  try {
    const payload = {
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
     useSharedAccounts: shared,                 // ✅ this triggers MEV shielding
     asLegacyTransaction: false,                // ✅ required for shared accounts
    //  prioritizationFeeLamports: priorityFee,    // ✅ aka priority fee (µ-lamports)
     computeUnitPriceMicroLamports: priorityFee, // duplicate just in case
     tipLamports: briberyAmount,                // ✅ optional bribe for validators
      useTokenLedger: false,
      dynamicComputeUnitLimit: true,
      skipUserAccountsRpcCalls: true,
      dynamicSlippage: true,
      trackingAccount: wallet.publicKey.toBase58(),
    };

    console.log("🚀 Executing swap with Jupiter:");
    console.log("→ MEV Mode:", shared ? "secure (shared)" : "fast (direct)");
    console.log("→ Priority Fee:", priorityFee || 0, "µLAM");
    console.log("→ Validator Bribe:", briberyAmount || 0, "lamports");
    console.log("→ Quote route summary:", {
      input: quote.inputMint,
      output: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      priceImpact: quote.priceImpactPct,
    });

    const res = await axios.post(JUPITER_SWAP_URL, payload);
    const { swapTransaction, lastValidBlockHeight, blockhash } = res.data;

    
    const transactionBuffer = Buffer.from(swapTransaction, "base64");

    let transaction;
    try {
      transaction = VersionedTransaction.deserialize(transactionBuffer);
    } catch (e) {
      console.warn("⚠️ Failed to deserialize as VersionedTransaction, using legacy.");
      transaction = Transaction.from(transactionBuffer);
    }

    transaction.sign([wallet]);
    const serialized = transaction.serialize();
    const signature = await connection.sendRawTransaction(serialized);
    console.log("📤 Sent transaction:", signature);

    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed"
    );

    console.log("✅ Swap confirmed:", `https://explorer.solana.com/tx/${signature}?cluster=mainnet-beta`);
    return signature;
  } catch (err) {
    // Bubble the full detail so Sniper prints it
    const detail = err.response?.data
                 ? JSON.stringify(err.response.data)
                 : err.message;
    throw new Error(detail);
  }
}

/**
 * Entry point if run directly. 
 * If run directly, fetch and execute a test swap for manual debugging. 
 */
if (require.main === module) {
  (async () => {
    const wallet = loadKeypair();

    const quote = await getSwapQuote({
      inputMint: "So11111111111111111111111111111111111111112", // SOL
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
      amount: 0.01 * 1e9,
      slippage: 1.0,
    });

    if (!quote) {
      console.log("No route available.");
      return;
    }

    console.log("🔁 Quote preview:", {
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      impact: quote.priceImpactPct,
    });

    const tx = await executeSwap({ quote, wallet });

    if (!tx) console.log("Swap failed or was skipped.");
  })();
}

module.exports = { getSwapQuote, executeSwap, loadKeypair };