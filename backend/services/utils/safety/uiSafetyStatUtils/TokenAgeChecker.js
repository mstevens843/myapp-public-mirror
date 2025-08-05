// utils/getTokenAgePrecise.js
const { Connection, PublicKey } = require("@solana/web3.js");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });

const RPC_URL = process.env.SOLANA_RPC_URL;
const connection = new Connection(RPC_URL, "confirmed");

module.exports = async function getTokenAgePrecise(mint) {
  const mintKey = new PublicKey(mint);

  // Ask for the *oldest* tx that ever referenced the mint account.
  const sigs = await connection.getSignaturesForAddress(
    mintKey,
    { limit: 1, before: undefined },   // grab newest-to-oldest page
    "confirmed",
    true                               // search full history – needs paid / archive RPC
  );

  if (!sigs.length || !sigs[0].blockTime)
    throw new Error("Archive RPC didn’t return creation slot");

  const genesisTime = sigs[0].blockTime;
  const now = Math.floor(Date.now() / 1e3);
  const ageDays = (now - genesisTime) / 86_400;

  return {
    createdAt: genesisTime,           // UNIX seconds
    ageDays: +ageDays.toFixed(2),
  };
};
