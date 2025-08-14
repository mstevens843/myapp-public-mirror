// getTokenAccountsAndInfo.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Connection, PublicKey } = require("@solana/web3.js");
const { getMint } = require("@solana/spl-token");
const fetch = require("node-fetch");

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const connection = new Connection(process.env.SOLANA_RPC_URL, "confirmed");


// 🧠 Basic in-memory cache for Jupiter token names
const tokenNameCache = {};
// 🧠 In-memory cache for decimals
const decimalsCache = {};

function asPublicKey(input) {
  return (input instanceof PublicKey)
    ? input
    : new PublicKey(input?.publicKey ?? input);
}


async function getJupiterTokenName(mint) {
  if (tokenNameCache[mint]) return tokenNameCache[mint];
  try {
    const res = await fetch(`https://lite-api.jup.ag/tokens/v1/token/${mint}`);
    const json = await res.json();
    const name = json.name || "Unknown";
    tokenNameCache[mint] = name;
    return name;
  } catch {
    return "Unknown";
  }
}

async function getTokenAccountsAndInfo(ownerInput) {
  const owner = asPublicKey(ownerInput);

  const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
  });

  const tokens = [];

  for (const { pubkey: accountPubkey, account } of accounts.value) {
    const parsed = account.data.parsed;
    const amount = parseFloat(parsed.info.tokenAmount.uiAmount);
    if (amount === 0) continue;

    const mint = parsed.info.mint;
    /* 🛡️ mint-lookup can fail on dust / closed accounts → don’t crash */
    let decimals = 9;            // sensible fallback
    try {
      const mintInfo = await getMint(connection, new PublicKey(mint));
      decimals = mintInfo.decimals;
    } catch (err) {
      console.warn(`⚠️  skip mint ${mint} — ${err.message}`);
    }

    let name = "Unknown";
    try {
      name = await getJupiterTokenName(mint);
    } catch {}

    tokens.push({
      mint,
      name: name?.replace(/[^\x20-\x7E]/g, "") || "Unknown",
      amount: parseFloat(amount.toFixed(decimals)),
    });
  }

  return tokens;
}

async function getMintDecimals(mint) {
  console.log("🧪 getMintDecimals() called with mint:", JSON.stringify(mint));
  console.log("🧪 typeof mint:", typeof mint);
  console.log("🧪 mint.length:", mint?.length);
  console.log("🧪 mint is base58?", /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint));

  try {
    const test = new PublicKey(mint);
    console.log("✅ mint accepted by PublicKey:", test.toBase58());
  } catch (e) {
    console.error("❌ CRASH: new PublicKey(mint) failed:", e.message);
    throw e;
  }
  if (decimalsCache[mint]) return decimalsCache[mint];

  try {
    const mintInfo = await getMint(connection, new PublicKey(mint));
    const decimals = mintInfo.decimals;
    decimalsCache[mint] = decimals;
    return decimals;
  } catch (err) {
    console.error("❌ Failed to get mint decimals:", err.message);
    throw err;
  }
}

/** 🔹 Native SOL lamports for a public key (Number of lamports). */
async function getSolLamports(ownerInput) {
  const owner = asPublicKey(ownerInput);
  const lamports = await connection.getBalance(owner, "confirmed");
  return lamports; // caller can BigInt() this if needed
}

module.exports = {
  getTokenAccountsAndInfo,
  getMintDecimals,
  getSolLamports,
};
