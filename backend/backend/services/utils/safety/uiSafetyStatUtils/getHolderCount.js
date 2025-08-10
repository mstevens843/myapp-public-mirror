// services/utils/getHolderCount.js
//
// Returns the number of *unique wallets* that hold ≥1 lamport of the token.
// Uses getProgramAccounts on SPL-Token program with a mint filter.

const { Connection, PublicKey } = require("@solana/web3.js");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });

const RPC_URL = process.env.SOLANA_RPC_URL;
const connection = new Connection(RPC_URL, "confirmed");

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/**
 * Returns unique holder count quickly by slicing out all data (0-bytes)
 * so the RPC server only streams pubkeys, not 165-byte account blobs.
 */
module.exports = async function getHolderCount(mint) {
  const mintKey = new PublicKey(mint);

  const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
    dataSlice: { offset: 0, length: 0 },      // 👈  tiny response
    filters: [
      { dataSize: 165 },
      { memcmp: { offset: 0, bytes: mintKey.toBase58() } },
    ],
    commitment: "confirmed",
  });

  const uniqueOwners = new Set(accounts.map((a) => a.account.owner.toBase58()));
  return { holderCount: uniqueOwners.size };
};
