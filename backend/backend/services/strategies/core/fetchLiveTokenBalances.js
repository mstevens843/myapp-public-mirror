const { Connection, PublicKey } = require("@solana/web3.js");

const SOL_MINT = "So11111111111111111111111111111111111111112";

async function fetchLiveTokenBalances(pubkey) {
  const conn = new Connection(process.env.SOLANA_RPC_URL, "confirmed");
  const owner = new PublicKey(pubkey);

  const tokens = [];

  // Fetch SPL tokens
  const { value } = await conn.getParsedTokenAccountsByOwner(
    owner,
    { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
  );

  for (const acc of value) {
    const info = acc.account.data.parsed.info;
    const uiAmt = +info.tokenAmount.uiAmount;
    const decimals = +info.tokenAmount.decimals;

    if (uiAmt > 0.000001) {
      tokens.push({
        mint: info.mint,
        amount: uiAmt,
        decimals,
      });
    }
  }

  // Add SOL balance
  const lamports = await conn.getBalance(owner);
  if (lamports > 0) {
    tokens.push({
      mint: SOL_MINT,
      amount: lamports / 1e9,
      decimals: 9,
    });
  }

  return tokens;
}

module.exports = fetchLiveTokenBalances;
