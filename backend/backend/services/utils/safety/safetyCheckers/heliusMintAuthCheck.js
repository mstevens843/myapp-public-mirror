/**
 * heliusAuthorityCheck.js
 * ------------------------------------------------------------
 * • Pulls raw account data via Helius RPC, decodes authorities
 * • Emits the same rich schema as web3AuthorityCheck
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../../../.env") });
const axios = require("axios");
const bs58  = require("bs58");

const KEY   = "authority";
const LABEL = "Mint / Freeze Authority";

async function checkHeliusAuthorities(mint) {
  const result = { key: KEY, label: LABEL, source: "helius" };

  try {
    const res = await axios.post(
      `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [mint, { encoding: "base64" }]
      }
    );

    const data = res.data?.result?.value?.data?.[0];
    if (!data) throw new Error("Failed to retrieve account data");

    const buf = Buffer.from(data, "base64");

    // decode mint authority (offset 0, len 36)
    const mintOpt     = buf.readUInt32LE(0);
    const mintAuth    = mintOpt === 0 ? null : bs58.encode(buf.slice(4, 36));

    // decode freeze authority (offset 46, len 36)
    const freezeOpt   = buf.readUInt32LE(46);
    const freezeAuth  = freezeOpt === 0 ? null : bs58.encode(buf.slice(50, 82));

    const mintPass    = mintAuth   === null;
    const freezePass  = freezeAuth === null;

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
    result.reason = `Helius fetch failed – ${err.message}`;
    result.detail = { mint: null, freeze: null };
    return result;
  }
}

module.exports = { checkHeliusAuthorities };
