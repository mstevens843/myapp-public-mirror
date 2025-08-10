/**
 * web3AuthorityCheck.js
 * ------------------------------------------------------------
 * • Fetches mint/freeze authority via @solana/spl-token
 * • Always returns a rich result object:
 *   { key, label, passed, reason, detail, source }
 */

const { Connection, PublicKey } = require("@solana/web3.js");
const { getMint } = require("@solana/spl-token");

const RPC = "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");

// meta
const KEY   = "authority";
const LABEL = "Mint / Freeze Authority";

async function checkWeb3Authorities(mint) {
  const result = { key: KEY, label: LABEL, source: "web3" };

  try {
    const pubkey    = new PublicKey(mint);
    const mintInfo  = await getMint(connection, pubkey);

    const mintAuth   = mintInfo.mintAuthority?.toBase58()   ?? null;
    const freezeAuth = mintInfo.freezeAuthority?.toBase58() ?? null;

    const mintPass   = mintAuth   === null;
    const freezePass = freezeAuth === null;

    result.passed = mintPass && freezePass;
    result.reason = result.passed
      ? "OK"
      : [
          !mintPass   && "Mint authority still exists",
          !freezePass && "Freeze authority still exists",
        ]
          .filter(Boolean)
          .join("; ");

    result.detail = {
      mint   : { passed: mintPass,   authority: mintAuth   },
      freeze : { passed: freezePass, authority: freezeAuth }
    };

    return result;
  } catch (err) {
    result.passed = false;
    result.reason = `Web3 fetch failed – ${err.message}`;
    result.detail = { mint: null, freeze: null };
    return result;
  }
}

module.exports = { checkWeb3Authorities };
