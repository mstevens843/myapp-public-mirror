// services/utils/safety/web3AuthCheck.js
const { Connection, PublicKey } = require("@solana/web3.js");
const { getMint } = require("@solana/spl-token");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });

const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");

const KEY   = "authority";
const LABEL = "Mint / Freeze Authority";

function short(pk) {
  if (!pk) return "null";
  const s = String(pk);
  return `${s.slice(0,4)}…${s.slice(-4)}`;
}

module.exports.checkWeb3Authorities = async function checkWeb3Authorities(mint) {
  const result = { key: KEY, label: LABEL, source: "web3" };
  try {
    const pubkey   = new PublicKey(mint);
    const mintInfo = await getMint(connection, pubkey);

    const mintAuth   = mintInfo.mintAuthority?.toBase58?.()   ?? null;
    const freezeAuth = mintInfo.freezeAuthority?.toBase58?.() ?? null;
    const decimals   = Number(mintInfo.decimals ?? 0);
    const supplyUi   = Number(mintInfo.supply ?? 0n) / Math.pow(10, decimals);
    const inited     = Boolean(mintInfo.isInitialized ?? true); // spl-token returns `true` for initialized mints

    const mintPass   = mintAuth   === null;
    const freezePass = freezeAuth === null;
    const passed     = mintPass && freezePass;

    result.passed = passed;
    result.reason = passed
      ? "OK"
      : [
          !mintPass   && "Mint authority exists",
          !freezePass && "Freeze authority exists",
        ].filter(Boolean).join("; ");

    result.detail = `mint=${short(mintAuth)}, freeze=${short(freezeAuth)}, dec=${decimals}, init=${inited}`;
    result.data = {
      source: "web3",
      mintAuthority   : mintAuth,
      freezeAuthority : freezeAuth,
      decimals,
      isInitialized   : inited,
      supplyUi,
    };
    return result;
  } catch (err) {
    result.passed = false;
    result.reason = `Web3 fetch failed`;
    result.detail = err.message || String(err);
    result.data   = { source: "web3", error: result.detail };
    return result;
  }
};
