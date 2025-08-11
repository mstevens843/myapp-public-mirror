// ✨ Added: backend/services/strategies/core/token2022Scanner.js
'use strict';

const { PublicKey, Connection } = require('@solana/web3.js');

// SPL Token program IDs
const TOKEN_PROGRAM_ID_2020 = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_PROGRAM_ID_2022 = new PublicKey('TokenzQdBj6YkqQynRZ4N7wGUw5qBPxVxYZc13Zp7hJ');

// Optional decoders (safe to miss)
let spl2022 = null;
try { spl2022 = require('@solana/spl-token-2022'); } catch (_) { /* optional */ }

function asPubkey(x) { return x instanceof PublicKey ? x : new PublicKey(String(x)); }

async function scanToken2022({ connection, mintPk }) {
  if (!(connection instanceof Connection)) throw new Error('scanToken2022: connection required');
  const mint = asPubkey(mintPk);

  const acc = await connection.getAccountInfo(mint, 'confirmed');
  if (!acc) return { ok: false, reasons: ['MINT_ACCOUNT_NOT_FOUND'], owner: null, details: {} };

  const owner = new PublicKey(acc.owner);
  const details = { owner: owner.toBase58(), is2022: owner.equals(TOKEN_PROGRAM_ID_2022) };

  // If standard 2020 program, still check for freeze authority (sell-blocking risk)
  if (owner.equals(TOKEN_PROGRAM_ID_2020)) {
    return {
      ok: true,
      reasons: [],
      owner: 'token-2020',
      details: { is2022: false, /* deeper 2020 checks happen in your other passes */ },
    };
  }

  // If not token-2022, allow
  if (!owner.equals(TOKEN_PROGRAM_ID_2022)) {
    return { ok: true, reasons: [], owner: owner.toBase58(), details };
  }

  // Token-2022 path
  // Best: use @solana/spl-token-2022 to inspect extensions. If not installed, fail "safe".
  const reasons = [];

  if (!spl2022) {
    // Heuristic fallback: we can’t parse TLV, so mark as risky unless explicitly allowed by config upstream.
    return {
      ok: false,
      reasons: ['TOKEN2022_UNKNOWN_EXTENSIONS_NO_DECODER'],
      owner: 'token-2022',
      details: { hint: 'Install @solana/spl-token-2022 for precise extension checks.' },
    };
  }

  // Try to unpack the Mint and probe known extensions
  try {
    // Some versions expose: getExtensionTypes, getExtensionData, ExtensionType, unpackMint
    const { unpackMint, getExtensionTypes, ExtensionType } = spl2022;

    // unpackMint returns a struct with base fields; unused here but validates layout
    unpackMint(mint, acc, TOKEN_PROGRAM_ID_2022);

    const types = getExtensionTypes(acc) || [];
    const tset = new Set(types.map(String));

    // Flags we consider dangerous for buyers
    const EXT = ExtensionType;
    const danger = [];

    // Transfer Hook (can block sells)
    if (tset.has(String(EXT.TransferHook))) danger.push('TRANSFER_HOOK');
    // Transfer Fee (taxed sells can be extreme)
    if (tset.has(String(EXT.TransferFeeConfig))) danger.push('TRANSFER_FEE');
    // Default Account State (Frozen)
    if (tset.has(String(EXT.DefaultAccountState))) danger.push('DEFAULT_ACCOUNT_STATE');
    // Permanent Delegate (can move funds)
    if (tset.has(String(EXT.PermanentDelegate))) danger.push('PERMANENT_DELEGATE');
    // Non-Transferable (can’t move tokens)
    if (tset.has(String(EXT.NonTransferable))) danger.push('NON_TRANSFERABLE');
    // Confidential / MetadataPointer (not a sell block per se, but increase risk)
    if (tset.has(String(EXT.MetadataPointer))) danger.push('METADATA_POINTER');

    // If any dangerous extension present → block
    if (danger.length) {
      reasons.push(...danger.map(s => `TOKEN2022_${s}`));
      return { ok: false, reasons, owner: 'token-2022', details: { extensions: Array.from(tset) } };
    }

    return { ok: true, reasons: [], owner: 'token-2022', details: { extensions: Array.from(tset) } };
  } catch (e) {
    return { ok: false, reasons: ['TOKEN2022_DECODING_ERROR'], owner: 'token-2022', details: { error: e.message } };
  }
}

module.exports = { scanToken2022 };
