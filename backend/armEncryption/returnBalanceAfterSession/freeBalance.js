// backend/services/balance/freeBalance.js
//
// Compute the amount of sweepable (free) funds for a user/wallet by
// subtracting out reserved amounts and a configurable fee buffer.
// On-chain balances are fetched via tokenAccounts utils; then we subtract
// current reservations (from ./reservationsIndex). SPL tokens include
// decimals for UI math and human-readable logs.

const prisma = require("../../prisma/prisma");
const { snapshot: reservationSnapshot } = require("./reservationsIndex");

// On-chain helpers (paths per your project)
const {
  getTokenAccountsAndInfo, // (pubkey) -> [{ mint, amount(BigInt|number|string), ata? }]
  getMintDecimals,         // (mint)   -> number
  getSolLamports,          // (pubkey) -> BigInt|number|string lamports
} = require("../../utils/tokenAccounts");

const WSOL_MINT = "So11111111111111111111111111111111111111112";

function bi(v) {
  try { return typeof v === "bigint" ? v.toString() : String(v); }
  catch { return String(v); }
}
const toBigInt = (x) => (typeof x === "bigint" ? x : BigInt(x ?? 0));

/**
 * Resolve wallet public key and fetch live balances.
 * Returns lamports for native SOL and an array of SPL tokens:
 *   { mint, amount(BigInt), ata?, decimals(Number) }
 */
async function getOnChainBalances(userId, walletId) {
  // 1) Resolve the wallet’s public key (scoped to the user)
  const w = await prisma.wallet.findFirst({
    where : { id: Number(walletId), userId: String(userId) },
    select: { publicKey: true },
  });
  if (!w?.publicKey) {
    throw new Error(`[FreeBalance] wallet ${walletId} not found for user ${userId}`);
  }

  // 2) Native SOL (lamports)
  let solLamports = 0n;
  try {
    if (typeof getSolLamports === "function") {
      solLamports = toBigInt(await getSolLamports(w.publicKey));
    } else {
      console.warn("[FreeBalance] getSolLamports() not available; SOL defaults to 0");
    }
  } catch (e) {
    console.warn("[FreeBalance] SOL balance lookup failed:", e?.message || e);
  }

  // 3) SPL token balances (+decimals). We’ll also fold WSOL into SOL.
  let rawTokens = [];
  try {
    rawTokens = (await getTokenAccountsAndInfo(w.publicKey)) || [];
  } catch (e) {
    console.warn("[FreeBalance] getTokenAccountsAndInfo() failed:", e?.message || e);
  }

  const tokens = [];
  for (const t of rawTokens) {
    try {
      const mint = t?.mint;
      if (!mint) continue;

      const amount = toBigInt(t?.amount);
      const ata = t?.ata || null;

      // Merge WSOL => native SOL and skip adding it to SPL list
      if (mint === WSOL_MINT && amount > 0n) {
        solLamports += amount; // WSOL has 9 decimals, same base unit as lamports
        continue;
      }

      let decimals = 0;
      try {
        decimals = await getMintDecimals(mint);
      } catch {
        // leave 0 if lookup fails
      }

      tokens.push({ mint, amount, ata, decimals });
    } catch (e) {
      console.warn("[FreeBalance] token row parse failed:", e?.message || e);
    }
  }

  // Small, useful breadcrumb so you can confirm we're using the right key
  console.log("[FreeBalance] pubkey resolved", {
    walletId,
    userId,
    publicKey: w.publicKey.slice(0, 6) + "…" + w.publicKey.slice(-6),
    solLamports: bi(solLamports),
    splCount: tokens.length,
  });

  return { sol: solLamports, tokens, publicKey: w.publicKey };
}

/**
 * Compute free (sweepable) balances after subtracting reservations + fee buffer.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {number} params.walletId
 * @param {bigint|number|string} [params.feeBufferLamports=0n]
 * @returns {Promise<{ sol: bigint, spl: Array<{ mint:string, fromAta:string|null, amount:bigint, decimals:number }> }>}
 */
async function freeBalance({ userId, walletId, feeBufferLamports = 0n }) {
  const feeBuf = toBigInt(feeBufferLamports);

  // Live on-chain snapshot
  const onChain = await getOnChainBalances(userId, walletId);

  // Current reservations (BigInt per mint, 'SOL' key for native)
  const reservations = reservationSnapshot();

  // ---- Native SOL ----------------------------------------------------
  const reservedSol = toBigInt(reservations["SOL"] || 0n);
  let freeSol = onChain.sol - reservedSol - feeBuf;
  if (freeSol < 0n) freeSol = 0n;

  // ---- SPL tokens ----------------------------------------------------
  const spl = [];
  for (const { mint, amount, ata, decimals } of onChain.tokens || []) {
    const reserved = toBigInt(reservations[mint] || 0n);
    let freeAmt = amount - reserved;
    if (freeAmt < 0n) freeAmt = 0n;
    if (freeAmt > 0n) {
      spl.push({
        mint,
        fromAta: ata || null,
        amount: freeAmt,
        decimals: Number.isFinite(decimals) ? Number(decimals) : 0,
      });
    }
  }

  // Compact, useful logging
  console.log("[FreeBalance] computed", {
    userId,
    walletId,
    onChainSol: bi(onChain.sol),
    reservedSol: bi(reservedSol),
    feeBufferLamports: bi(feeBuf),
    freeSol: bi(freeSol),
    splCount: spl.length,
    splPreview: spl.slice(0, 3).map((t) => ({
      mint: t.mint,
      amount: bi(t.amount),
      decimals: t.decimals,
    })),
  });

  return { sol: freeSol, spl };
}

module.exports = { freeBalance };
