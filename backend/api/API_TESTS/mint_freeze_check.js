const axios = require("axios");
const bs58 = require("bs58");
const Buffer = require("buffer").Buffer;

const HELIUS_RPC = "https://mainnet.helius-rpc.com/?api-key=34097df7-a0b8-4f7c-9528-8d8064867369";

// Helper to fetch raw base64 data from getAccountInfo
async function fetchTokenAccountData(mint) {
  try {
    const res = await axios.post(HELIUS_RPC, {
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [
        mint,
        { encoding: "base64" }
      ]
    });

    const data = res.data?.result?.value?.data?.[0];
    return data ? Buffer.from(data, "base64") : null;
  } catch (err) {
    console.error("❌ Failed fetching account:", err.message);
    return null;
  }
}

// Parse mint authority from token mint account layout
async function checkMintAuthority(mint) {
  const buffer = await fetchTokenAccountData(mint);
  if (!buffer) return console.log("❌ Mint authority check failed (no data)");

  const mintAuth = buffer.slice(0, 32);
  const mintAuthStr = bs58.encode(mintAuth);

  const isRevoked = mintAuthStr === "11111111111111111111111111111111";
  console.log(`🔍 Mint Authority: ${isRevoked ? "🔥 Revoked" : `✅ ${mintAuthStr}`}`);
}

// Parse freeze authority from token mint account layout
async function checkFreezeAuthority(mint) {
  const buffer = await fetchTokenAccountData(mint);
  if (!buffer) return console.log("❌ Freeze authority check failed (no data)");

  const freezeAuth = buffer.slice(36, 68);
  const freezeAuthStr = bs58.encode(freezeAuth);

  const isRevoked = freezeAuthStr === "11111111111111111111111111111111";
  console.log(`🧊 Freeze Authority: ${isRevoked ? "🔥 Revoked" : `✅ ${freezeAuthStr}`}`);
}

// 👉 Replace with a mint address to test
const testMint = "So11111111111111111111111111111111111111112";

checkMintAuthority(testMint);
checkFreezeAuthority(testMint);
