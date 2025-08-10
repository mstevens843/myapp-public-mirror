const { Connection, PublicKey } = require("@solana/web3.js");
require("dotenv").config({ path: require("path").resolve(__dirname, "../../../../.env") });

const RPC_URL = process.env.SOLANA_RPC_URL;
const connection = new Connection(RPC_URL, "confirmed");

const KEY   = "topHolders";
const LABEL = "Avoid Whale-Controlled Tokens";

module.exports = async function getTopHolderStats(
  mint,
  { threshold = 50 } = {}
) {
  try {
    const mintKey = new PublicKey(mint);

    const { value: supplyInfo } = await connection.getTokenSupply(mintKey);
    const total = Number(supplyInfo.uiAmount);

    const { value: holders } = await connection.getTokenLargestAccounts(mintKey);

    if (!holders || holders.length === 0) {
      return {
        key: KEY,
        label: LABEL,
        passed: true,
        reason: "No top holder data found",
        detail: null,
        data: null,
      };
    }

    const sum = (slice) => holders.slice(0, slice).reduce((a, h) => a + h.uiAmount, 0);
    const pctOf = (value) => +((value / total) * 100).toFixed(2);

    const top1Pct  = pctOf(holders[0]?.uiAmount ?? 0);
    const top5Pct  = pctOf(sum(5));
    const top10Pct = pctOf(sum(10));
    const top20Pct = pctOf(sum(20));

    let tier;
    if (top1Pct > 50)      tier = "Dominant (>50%)";
    else if (top1Pct > 30) tier = "High (30–50%)";
    else if (top1Pct > 20) tier = "Alert (20–30%)";
    else                   tier = "Healthy (≤20%)";

    const data = {
      totalSupply: total,
      topHolderUiAmount: holders[0]?.uiAmount ?? 0,
      topHolderPct: top1Pct,
      tier,
      top5Pct,
      top10Pct,
      top20Pct,
    };

    // Failure logic
    if (top1Pct > 50) {
      return {
        key: KEY,
        label: LABEL,
        passed: false,
        reason: "Top 1 holder exceeds 50%",
        detail: `Top holder owns ${top1Pct}% of supply`,
        data,
      };
    }

    if (top5Pct > 75) {
      return {
        key: KEY,
        label: LABEL,
        passed: false,
        reason: "Top 5 holders exceed 75%",
        detail: `Top 5 holders own ${top5Pct}% of supply`,
        data,
      };
    }

    if (top10Pct > 75) {
      return {
        key: KEY,
        label: LABEL,
        passed: false,
        reason: "Top 10 holders exceed 75%",
        detail: `Top 10 holders own ${top10Pct}% of supply`,
        data,
      };
    }

    return {
      key: KEY,
      label: LABEL,
      passed: true,
      data,
    };

  } catch (err) {
    return {
      key: KEY,
      label: LABEL,
      label : "Top-Holder Contract (unknown)",
      passed: "unknown",   
      reason: "No top holder data found",
      detail: err.message,
      data: null,
    };
  }
};
