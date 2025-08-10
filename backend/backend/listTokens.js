
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Connection, PublicKey } = require("@solana/web3.js");

async function listWalletTokens(walletAddress) {
  const RPC_URL = process.env.SOLANA_RPC_URL;
const conn = new Connection(RPC_URL, "confirmed");

  const accounts = await conn.getParsedTokenAccountsByOwner(
    new PublicKey(walletAddress),
    { programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") }
  );

  for (const acc of accounts.value) {
    const info = acc.account.data.parsed.info;
    const mint = info.mint;
    const rawAmount = info.tokenAmount.amount;
    const decimals = info.tokenAmount.decimals;
    const uiAmount = parseFloat(rawAmount) / (10 ** decimals);

    console.log(`Mint: ${mint}`);
    console.log(`Amount: ${uiAmount}`);
    console.log("–––––––––––––––––––––");
  }
}

// REPLACE WITH YOUR WALLET
const MY_WALLET = "7vigaj5e6uaudbyDj1n1kWkEWjHq5nNaUASh72bzzkNm";

listWalletTokens(MY_WALLET)
  .then(() => console.log("Done."))
  .catch(console.error);