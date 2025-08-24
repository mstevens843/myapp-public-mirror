// services/utils/safety/heliusMintAuthCheck.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });
const axios = require("axios");
const bs58  = require("bs58");

const KEY   = "authority";
const LABEL = "Mint / Freeze Authority";

function short(pk) {
  if (!pk) return "null";
  const s = String(pk);
  return `${s.slice(0,4)}…${s.slice(-4)}`;
}

module.exports.checkHeliusAuthorities = async function checkHeliusAuthorities(mint) {
  const result = { key: KEY, label: LABEL, source: "helius" };

  try {
    const url = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`;
    const body = { jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "base64" }] };
    const res  = await axios.post(url, body, { timeout: 8000 });

    const dataB64 = res.data?.result?.value?.data?.[0];
    if (!dataB64) throw new Error("No account data");
    const buf = Buffer.from(dataB64, "base64");

    // SPL Mint layout (Token-2022 compatible header):
    //  0..3:   COption<Pubkey> tag for mintAuthority
    //  4..35:  mintAuthority pubkey (present only if tag != 0)
    // 36..43:  supply u64 LE
    // 44:      decimals u8
    // 45:      isInitialized u8 (bool)
    // 46..49:  COption<Pubkey> tag for freezeAuthority
    // 50..81:  freezeAuthority pubkey (present only if tag != 0)

    const mintOpt   = buf.readUInt32LE(0);
    const mintAuth  = mintOpt === 0 ? null : bs58.encode(buf.slice(4, 36));

    const supplyLE  = buf.readBigUInt64LE(36);
    const decimals  = buf.readUInt8(44);
    const inited    = !!buf.readUInt8(45);

    const freezeOpt = buf.readUInt32LE(46);
    const freezeAuth= freezeOpt === 0 ? null : bs58.encode(buf.slice(50, 82));

    const supplyUi  = Number(supplyLE) / Math.pow(10, decimals);

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

    // Human-readable `detail` for plain-text logs
    result.detail = `mint=${short(mintAuth)}, freeze=${short(freezeAuth)}, dec=${decimals}, init=${inited}`;

    // Machine-readable proof
    result.data = {
      source: "helius",
      mintAuthority   : mintAuth,
      freezeAuthority : freezeAuth,
      decimals,
      isInitialized   : inited,
      supplyUi,
      accountBytes    : buf.length
    };
    return result;
  } catch (err) {
    result.passed = false;
    result.reason = `Helius fetch failed`;
    result.detail = err.message || String(err);
    result.data   = { source: "helius", error: result.detail };
    return result;
  }
};
