import { Connection, PublicKey } from "@solana/web3.js";

const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL;

export async function getSolBalance(pubkey) {
  const connection = new Connection(RPC_URL);
  const balanceLamports = await connection.getBalance(new PublicKey(pubkey));
  return balanceLamports / 1e9; // return in SOL
}
