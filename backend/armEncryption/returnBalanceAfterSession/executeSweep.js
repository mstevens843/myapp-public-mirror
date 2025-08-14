// backend/services/sweep/executeSweep.js
//
// Live sweep:
//   1) Non-USDC SPL → 2) USDC → 3) SOL (leave min balance)
// Uses armed session DEK to decrypt the wallet key, signs & sends TXs.

const { freeBalance } = require("./freeBalance");
const prisma = require("../../prisma/prisma");

const {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  Keypair,
} = require("@solana/web3.js");

const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} = require("@solana/spl-token");

const { getDEK } = require("../sessionKeyCache");
const { decryptPrivateKeyWithDEK } = require("../envelopeCrypto");

function bi(v) {
  try { return typeof v === "bigint" ? v.toString() : String(v); }
  catch { return String(v); }
}

/** Build a shared connection (confirmed) */
function getConnection() {
  const url = process.env.SOLANA_RPC_URL;
  if (!url) throw new Error("SOLANA_RPC_URL not set");
  return new Connection(url, "confirmed");
}

/** Load signer Keypair for (userId, walletId) using session DEK */
async function loadSigner(userId, walletId) {
  const wallet = await prisma.wallet.findFirst({
    where: { id: Number(walletId), userId: String(userId) },
    select: { publicKey: true, encrypted: true },
  });
  if (!wallet?.publicKey || !wallet?.encrypted) {
    throw new Error("Wallet not found or not protected");
  }

  const dek = getDEK(userId, walletId);
  if (!dek) {
    const err = new Error("Automation disarmed – no active session");
    err.code = "AUTOMATION_NOT_ARMED";
    err.status = 401;
    throw err;
  }

  const aad = `user:${userId}:wallet:${walletId}`;
  const secretBuf = await decryptPrivateKeyWithDEK(wallet.encrypted, dek, aad);
  const secret = new Uint8Array(secretBuf); // 64-byte ed25519
  const keypair = Keypair.fromSecretKey(secret, { skipValidation: true });
  try { secretBuf.fill(0); } catch {}
  return { keypair, fromPubkey: new PublicKey(wallet.publicKey) };
}

/** Ensures dest ATA exists; returns { ataPubkey, preIxs[] } */
async function ensureDestAtaIx(connection, owner, mint) {
  const ata = await getAssociatedTokenAddress(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const info = await connection.getAccountInfo(ata);
  if (info) return { ataPubkey: ata, preIxs: [] };
  const ix = createAssociatedTokenAccountInstruction(
    owner,       // payer (we'll pay from same wallet)
    ata,
    owner,       // token owner is destination owner
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return { ataPubkey: ata, preIxs: [ix] };
}

/** Transfer SPL (checked) in base units */
async function sendSplTransfer({ connection, signer, fromOwner, sourceAta, destOwner, mint, amount, decimals }) {
  const { ataPubkey: destAta, preIxs } = await ensureDestAtaIx(connection, destOwner, mint);

  const ix = createTransferCheckedInstruction(
    sourceAta,
    mint,
    destAta,
    fromOwner,
    BigInt(amount),       // base units
    Number(decimals) || 0,
    [],                   // multisig signers
    TOKEN_PROGRAM_ID
  );

  const tx = new Transaction().add(...preIxs, ix);
  tx.feePayer = fromOwner;
  const sig = await sendAndConfirmTransaction(connection, tx, [signer], { commitment: "confirmed" });
  return sig;
}

/** Transfer SOL lamports */
async function sendSol({ connection, signer, fromPubkey, destPubkey, lamports }) {
  const ix = SystemProgram.transfer({
    fromPubkey,
    toPubkey: destPubkey,
    lamports: Number(lamports), // lamports fit in number range
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = fromPubkey;
  const sig = await sendAndConfirmTransaction(connection, tx, [signer], { commitment: "confirmed" });
  return sig;
}

/**
 * Execute a sweep of free funds according to the provided configuration.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {number} params.walletId
 * @param {string} params.destPubkey – destination cold wallet public key
 * @param {Array<string>} [params.excludeMints] – SPL mints to skip
 * @param {Array<string>} [params.usdcMints] – SPL mints considered USDC
 * @param {bigint} [params.solMinKeepLamports] – lamports to leave in wallet
 * @param {bigint} [params.feeBufferLamports] – lamports reserved for fees
 * @returns {Promise<{ txids: string[] }>}
 */
async function executeSweep({
  userId,
  walletId,
  destPubkey,
  excludeMints = [],
  usdcMints = [],
  solMinKeepLamports = 10_000_000n, // 0.01 SOL
  feeBufferLamports = 10_000n,      // 0.00001 SOL
}) {
  const connection = getConnection();
  const destination = new PublicKey(destPubkey);

  const { keypair, fromPubkey } = await loadSigner(userId, walletId);

  // Snapshot of free funds (already net of reservations + fee buffer)
  const balances = await freeBalance({ userId, walletId, feeBufferLamports });
  const spl = Array.isArray(balances?.spl) ? balances.spl : [];
  const freeSol = typeof balances?.sol === "bigint" ? balances.sol : 0n;

  // Plan SOL sweep
  let solToSweep = 0n;
  if (freeSol > solMinKeepLamports) solToSweep = freeSol - solMinKeepLamports;

  // Partition SPL: non-USDC first, then USDC
  const shouldSend = (t) =>
    t &&
    typeof t.amount === "bigint" &&
    t.amount > 0n &&
    !excludeMints.includes(t.mint);

  const nonUsdcSpl = spl.filter((t) => shouldSend(t) && !usdcMints.includes(t.mint));
  const usdcOnly   = spl.filter((t) => shouldSend(t) &&  usdcMints.includes(t.mint));

  const hasSweepableSpl = nonUsdcSpl.length > 0 || usdcOnly.length > 0;

  console.log("[AutoReturn] sweep plan", {
    userId,
    walletId,
    dest: destPubkey,
    freeSol: bi(freeSol),
    solMinKeepLamports: bi(solMinKeepLamports),
    feeBufferLamports: bi(feeBufferLamports),
    computedSolToSweep: bi(solToSweep),
    splCount: spl.length,
    excludeMintsCount: excludeMints.length,
    usdcMintsCount: usdcMints.length,
  });

  if (!hasSweepableSpl && solToSweep === 0n) {
    console.log("[AutoReturn] nothing to sweep:", {
      reason: freeSol <= solMinKeepLamports ? "SOL <= keep (post-fee) and no SPL balances" : "no balances",
      freeSol: bi(freeSol),
      solMinKeepLamports: bi(solMinKeepLamports),
    });
    return { txids: [] };
  }

  const txids = [];

  // Helper to find/derive source ATA for a given mint
  const getSourceAta = async (mintPk) =>
    await getAssociatedTokenAddress(mintPk, fromPubkey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  // 1) Non-USDC SPL
  for (const t of nonUsdcSpl) {
    try {
      const mintPk = new PublicKey(t.mint);
      const sourceAta = await getSourceAta(mintPk);
      const sig = await sendSplTransfer({
        connection,
        signer: keypair,
        fromOwner: fromPubkey,
        sourceAta,
        destOwner: destination,
        mint: mintPk,
        amount: t.amount,       // base units (BigInt)
        decimals: t.decimals ?? 0,
      });
      console.log(`[AutoReturn] SPL sent ${t.mint} amount=${bi(t.amount)} sig=${sig}`);
      txids.push(sig);
    } catch (e) {
      console.error(`[AutoReturn] SPL send failed mint=${t?.mint}:`, e?.message || e);
      // continue with the rest
    }
  }

  // 2) USDC SPL
  for (const t of usdcOnly) {
    try {
      const mintPk = new PublicKey(t.mint);
      const sourceAta = await getSourceAta(mintPk);
      const sig = await sendSplTransfer({
        connection,
        signer: keypair,
        fromOwner: fromPubkey,
        sourceAta,
        destOwner: destination,
        mint: mintPk,
        amount: t.amount,       // base units (BigInt)
        decimals: t.decimals ?? 6, // USDC usually 6, but we pass what we have
      });
      console.log(`[AutoReturn] USDC sent ${t.mint} amount=${bi(t.amount)} sig=${sig}`);
      txids.push(sig);
    } catch (e) {
      console.error(`[AutoReturn] USDC send failed mint=${t?.mint}:`, e?.message || e);
    }
  }

  // 3) SOL last
  if (solToSweep > 0n) {
    try {
      const sig = await sendSol({
        connection,
        signer: keypair,
        fromPubkey,
        destPubkey: destination,
        lamports: solToSweep,
      });
      console.log(`[AutoReturn] SOL sent lamports=${bi(solToSweep)} sig=${sig}`);
      txids.push(sig);
    } catch (e) {
      console.error("[AutoReturn] SOL send failed:", e?.message || e);
    }
  } else {
    console.log("[AutoReturn] SOL sweep skipped (<= keep)", {
      freeSol: bi(freeSol),
      solMinKeepLamports: bi(solMinKeepLamports),
    });
  }

  return { txids };
}

module.exports = { executeSweep };
