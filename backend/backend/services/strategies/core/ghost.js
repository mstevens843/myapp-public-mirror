/**
 * ghost.js — Utilities for rotating “burner” wallets, forward transfers,
 * and rug detection.
 *
 * A core technique used by private sniper bots is to **rotate through
 * multiple burner addresses** so that buys are not linked directly to
 * the main wallet.  After each purchase the tokens are immediately
 * forwarded to a cover address, making it much harder for copy‑traders
 * to follow their transactions【460245750751624†L632-L639】.
 *
 * This module also provides a **pre‑warm** helper to create associated
 * token accounts ahead of time.  Many public bots lose precious
 * milliseconds on the first buy because the SPL token account needs
 * to be created; advanced bots precreate the account so the swap
 * instruction can be sent without the extra creation step.
 *
 * Finally, `checkFreezeAuthority()` checks if a mint still has its
 * freeze authority set.  Snipers avoid tokens where the creator
 * retains freeze authority, because this can be used to freeze
 * token transfers and trap buyers in a honeypot【460245750751624†L488-L496】.
 *
 * Functions in this file rely on @solana/web3.js and @solana/spl-token.
 */

const {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  getMint,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");
const {
  PublicKey,
  Transaction,
} = require("@solana/web3.js");

/**
 * Pre‑create the associated token account (ATA) for a given mint and wallet.
 * If the account already exists, this does nothing.
 *
 * @param {Connection} connection A Solana connection
 * @param {string|PublicKey} mint The SPL mint to create the ATA for
 * @param {Keypair} wallet The wallet to pay for and own the ATA
 * @returns {Promise<PublicKey>} The associated token account address
 */
async function prewarmTokenAccount(connection, mint, wallet) {
  const mintKey = new PublicKey(mint);
  const owner = wallet.publicKey;
  // Derive the ATA address
  const ata = await getAssociatedTokenAddress(mintKey, owner, false, TOKEN_PROGRAM_ID);
  const info = await connection.getAccountInfo(ata);
  if (info) {
    // Already exists; no action needed
    return ata;
  }
  // Create the ATA on chain.  getOrCreateAssociatedTokenAccount will
  // handle the create instruction if needed.
  const ataInfo = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet,      // payer for the account creation
    mintKey,
    owner,       // owner of the ATA
    false        // allow owner off curve? false – require direct mapping
  );
  return ataInfo.address;
}

/**
 * Forward tokens from a burner wallet to a cover address.
 * Will automatically create the destination ATA if it doesn't exist.
 *
 * @param {Connection} connection A Solana connection
 * @param {string|PublicKey} mint The SPL mint being transferred
 * @param {Keypair} sourceWallet The burner wallet that holds the tokens
 * @param {PublicKey} destPub The cover wallet to receive the tokens
 * @param {bigint|number|string} rawAmount The amount of tokens to send (in base units)
 * @returns {Promise<string>} The signature of the transfer transaction
 */
async function forwardTokens(connection, mint, sourceWallet, destPub, rawAmount) {
  const mintKey = new PublicKey(mint);
  const owner = sourceWallet.publicKey;
  const amount = typeof rawAmount === "bigint" ? rawAmount : BigInt(rawAmount);

  // Derive source and destination ATAs
  const srcAta = await getAssociatedTokenAddress(mintKey, owner, false, TOKEN_PROGRAM_ID);
  const destAta = await getAssociatedTokenAddress(mintKey, destPub, false, TOKEN_PROGRAM_ID);

  // Ensure the destination ATA exists (create if missing).
  const destInfo = await connection.getAccountInfo(destAta);
  if (!destInfo) {
    await getOrCreateAssociatedTokenAccount(connection, sourceWallet, mintKey, destPub, false);
  }

  // Create the transfer instruction
  const ix = createTransferInstruction(
    srcAta,
    destAta,
    owner,
    amount,
    [],           // multiSigners – empty because owner signs directly
    TOKEN_PROGRAM_ID
  );

  const tx = new Transaction().add(ix);

  // Send the transaction; skip preflight to save time
  const sig = await connection.sendTransaction(tx, [sourceWallet], { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/**
 * Check the freeze authority of a mint.  If the returned value is
 * non‑null, then the mint's creator still has the ability to freeze
 * token transfers, which is a common honeypot indicator【460245750751624†L488-L496】.
 *
 * @param {Connection} connection A Solana connection
 * @param {string|PublicKey} mint The SPL mint to inspect
 * @returns {Promise<string|null>} The base58 public key of the freeze authority or null
 */
async function checkFreezeAuthority(connection, mint) {
  const mintKey = new PublicKey(mint);
  const mintInfo = await getMint(connection, mintKey);
  if (mintInfo.freezeAuthority) {
    return mintInfo.freezeAuthority.toBase58();
  }
  return null;
}

module.exports = {
  prewarmTokenAccount,
  forwardTokens,
  checkFreezeAuthority,
};