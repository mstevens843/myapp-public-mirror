/**
 * jitoBundle.js
 *
 * Utility functions for interacting with Jito's block engine.  These
 * functions allow the bot to send pre‑signed transactions as bundles with
 * an optional tip to validators.  Bundles are processed atomically and
 * prioritized by Jito based on the tip amount【101560152660447†L160-L180】.  A
 * typical usage pattern involves serializing one or more signed
 * transactions, encoding them as base64 strings, and posting them to
 * Jito's relay endpoint.  The relay URL and default tip may be
 * configured via environment variables or passed explicitly in the
 * options object.
 */

const axios = require("axios");
const { VersionedTransaction, Transaction } = require("@solana/web3.js");

/**
 * Send a bundle of signed transactions to the Jito block engine.  Each
 * transaction must already be signed by the user.  The block engine will
 * attempt to execute all transactions in the bundle atomically in the
 * same slot.  A tip is paid to incentivize inclusion【101560152660447†L160-L180】.
 *
 * @param {Object} opts Options for the call.
 * @param {Transaction[]|VersionedTransaction[]} opts.transactions An array of signed transactions.
 * @param {number} opts.tipLamports Tip in lamports to pay to validators. Must be >= 1000 per Jito docs【101560152660447†L190-L203】.
 * @param {string} opts.relayUrl Jito relay base URL (without path). Defaults to process.env.JITO_RELAY_URL.
 *
 * @returns {Promise<Object>} Response from Jito relay API.
 */
async function sendJitoBundle({ transactions, tipLamports = 1000, relayUrl }) {
  const url = (relayUrl || process.env.JITO_RELAY_URL || "").replace(/\/$/, "");
  if (!url) throw new Error("JITO_RELAY_URL not configured");
  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw new Error("transactions array is empty");
  }
  const bundle = transactions.map((tx) => {
    const serialized = tx.serialize();
    return Buffer.from(serialized).toString("base64");
  });
  const payload = {
    bundle,
    tip: Number(tipLamports) || 1000,
  };
  try {
    const res = await axios.post(`${url}/v1/bundles`, payload);
    return res.data;
  } catch (err) {
    console.error("❌ Jito bundle error:", err.response?.data || err.message);
    throw err;
  }
}

/**
 * Execute a swap through Jupiter and submit it as a Jito bundle.  This
 * function mirrors the logic of executeSwap() in swap.js, but instead of
 * sending the raw transaction via the normal RPC, it sends the signed
 * transaction to the Jito block engine.  It returns the bundle digest
 * returned by Jito, not the final transaction signature.
 *
 * Note: Confirmation must be handled separately; the Jito API will
 * respond immediately after the bundle is accepted【101560152660447†L190-L203】.
 *
 * @param {Object} opts Options.
 * @param {Object} opts.quote Jupiter quote response.
 * @param {Keypair} opts.wallet User's keypair used for signing.
 * @param {boolean} [opts.shared=false] Whether to use Jupiter shared accounts.
 * @param {number} [opts.priorityFee=0] Priority fee in microLamports.
 * @param {number} [opts.briberyAmount=0] Bribe paid to validators in lamports.
 * @param {number} [opts.tipLamports=1000] Tip for Jito bundle in lamports.
 * @param {string} [opts.relayUrl] Custom Jito relay URL; defaults to env.
 * @returns {Promise<Object>} Response from Jito relay.
 */
async function executeSwapJitoBundle({
  quote,
  wallet,
  shared = false,
  priorityFee = 0,
  briberyAmount = 0,
  tipLamports = 1000,
  relayUrl,
}) {
  // Compose payload similar to executeSwap()
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
  // Request the swap transaction from Jupiter's API
  const axios = require("axios");
  const JUPITER_SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";
  const res = await axios.post(JUPITER_SWAP_URL, payload);
  const { swapTransaction } = res.data;
  const txBuf = Buffer.from(swapTransaction, "base64");
  let tx;
  try {
    tx = VersionedTransaction.deserialize(txBuf);
  } catch (_) {
    tx = Transaction.from(txBuf);
  }
  // Sign the transaction
  tx.sign([wallet]);
  // Send to Jito
  const result = await sendJitoBundle({
    transactions: [tx],
    tipLamports,
    relayUrl,
  });
  return result;
}

module.exports = { sendJitoBundle, executeSwapJitoBundle };