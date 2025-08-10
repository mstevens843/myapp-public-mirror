require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const axios = require("axios");
const { Connection, Keypair, VersionedTransaction } = require("@solana/web3.js");
const bs58 = require("bs58");
const cleanMint = require("./mintCleaner");

if (!process.env.SOLANA_RPC_URL || !process.env.SOLANA_RPC_URL.startsWith("http")) {
  throw new Error("❌ Invalid or missing SOLANA_RPC_URL in .env file");
}

const RPC_URL = process.env.SOLANA_RPC_URL;
const connection = new Connection(RPC_URL, "confirmed");

/* Wallet loader */
function loadKeypair() {
  if (!process.env.PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY in .env");
  return Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY.trim()));
}

/* Quote fetcher from Ultra API */
async function getSwapQuote({
  inputMint,
  outputMint,
  amount,
  slippage = 1,
  walletAddress,
}) {
  const taker = walletAddress || loadKeypair().publicKey.toBase58();
  inputMint = cleanMint(inputMint);
  outputMint = cleanMint(outputMint);

  const params = {
    inputMint,
    outputMint,
    amount,
    taker,
    slippageBps: Math.round(slippage * 100),
    swapMode: "ExactIn",
  };

  const { data } = await axios.get(
    "https://lite-api.jup.ag/ultra/v1/order",
    { params, timeout: 10_000 },
  );

  console.log("📑 Ultra order:", {
    swapType: data?.swapType,
    txPresent: !!data?.transaction,
  });

  return data?.outAmount ? data : null;
}

/* Execute the swap */
async function executeSwap({ quote: order }) {
  try {
    const wallet = loadKeypair();

    const body =
      order.transaction && order.transaction.length > 0
        ? {
            signedTransaction: (() => {
              const tx = VersionedTransaction.deserialize(
                Buffer.from(order.transaction, "base64")
              );
              tx.sign([wallet]);
              const serialized = tx.serialize();
              console.log("📤 Signed tx length:", serialized.length);
              return Buffer.from(serialized).toString("base64");
            })(),
            requestId: order.requestId,
          }
        : { requestId: order.requestId };

    console.log("📡 Posting to /execute with body:", {
      requestId: order.requestId,
      signed: !!body.signedTransaction,
    });

    const { data: exec } = await axios.post(
      "https://lite-api.jup.ag/ultra/v1/execute",
      body,
      { timeout: 20_000 },
    );

    console.log("📦 Ultra execute response (raw):", exec);

    if (exec.status !== "Success") {
      throw new Error(exec.error || `Ultra swap failed (code ${exec.code})`);
    }

    if (!exec.signature) throw new Error("Ultra returned empty signature");

    console.log("🔍 Raw exec.signature:", exec.signature);

let sig;
try {
  const raw = Buffer.from(exec.signature, "base64");
  sig = bs58.encode(raw);
  console.log("✅ Signature converted from base64 → base58:", sig);
} catch (e) {
  console.warn("⚠️ Signature is not base64. Using as-is:", exec.signature);
  sig = exec.signature;
}

console.log("🧪 Final sig for confirmation:", sig);

    console.log("✅ Converted txid (base58):", sig);
    console.log("⛓️ Confirming transaction on-chain...");
    

try {
  await new Connection(RPC_URL, "confirmed").confirmTransaction(sig, "confirmed");
  console.log("🎉 Transaction confirmed.");
} catch (e) {
  console.error("❌ confirmTransaction failed:", e.message);
}

    return sig;
  } catch (err) {
    console.error(
      "❌ Ultra swap failed:",
      JSON.stringify(err.response?.data, null, 2) || err.message || err
    );
    return null;
  }
}

module.exports = { getSwapQuote, executeSwap };
