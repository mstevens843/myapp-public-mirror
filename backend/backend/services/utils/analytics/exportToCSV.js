/** Trade Log to CSV Exporter
 * Converts structured trade logs into CSV format
 * Used by: /api/trades/download route, for easy export and review.
 * 
 * Features: 
 * - Converts JSON trade entries into CSV rows
 * - Escapes string values (mint addresses, timestamps)
 * - Supports writing directly to file. 
 */

const fs = require("fs");
const path = require("path");

function convertToCSV(trades) {
  const headers = [
    "timestamp",
    "tokenName",
    "strategy",
    "inAmountUSD",      // entry size
    "outAmountUSD",     // exit size
    "pnlUSD",
    "pnlPct",
    "entryPriceUSD",
    "exitPriceUSD",
    "txHash",
  ];

  const rows = trades.map((t) => {
    // Monthly summary row (no trade-specific data)
    if (t.month) {
      return [
        t.timestamp,        // e.g. "2025-04-01T00:00:00Z"
        "MONTH-SUMMARY",
        "aggregate",
        "",                 // inAmountUSD
        "",                 // outAmountUSD
        t.netUsd ?? "",
        t.pnlPct ?? "",
        "", "",             // entryPriceUSD, exitPriceUSD
        "",                 // txHash
      ].join(",");
    }

    // Regular trade row
    return headers
      .map((key) => {
        const val = t[key];
        if (val === undefined || val === null) return "";
        return typeof val === "string" ? `"${val}"` : val;
      })
      .join(",");
  });

  return [headers.join(","), ...rows].join("\n");
}


// ▸ Minimal IRS/Koinly formatter
function convertToTaxCSV(trades) {
  const headers = [
    "Asset Amount",
    "Asset Name",
    "Received Date",
    "Date Sold",
    "Proceeds (USD)",
    "Cost Basis (USD)",
    "Gain (USD)",
    "Type",
  ];

    const rows = trades
    .filter((t) => !t.month && t.exitPriceUSD)   // skip monthly aggregates
    .map((t) => {
      const decimals = t.decimals ?? 9;
      const amount =
        (t.closedOutAmount ?? t.outAmount ?? t.inAmount ?? 0) /
        10 ** decimals;

      const proceeds  = (t.exitPriceUSD ?? 0) * amount;
      const costBasis = (t.entryPriceUSD ?? 0) * amount;
      const gainUsd   = proceeds - costBasis;

      const recvDate = new Date(t.timestamp).toISOString().slice(0, 10);
     const soldDate = new Date(t.exitedAt ?? t.closedAt ?? t.timestamp)
        .toISOString()
        .slice(0, 10);

      const heldDays =
        (new Date(soldDate) - new Date(recvDate)) / 86_400_000;
      const term = heldDays > 365 ? "Long Term" : "Short Term";

      return [
       amount.toFixed(8),
        t.tokenName ?? "Unknown",
        recvDate,
        soldDate,
        proceeds.toFixed(2),
        costBasis.toFixed(2),
        gainUsd.toFixed(2),
        term,
      ].join(",");
    });
  return [headers.join(","), ...rows].join("\n");
}


// Writes CSV file to Disk from trade Array 
function writeCSVFile(trades, outputPath) {
  const csv = convertToCSV(trades);
  fs.writeFileSync(outputPath, csv);
}

module.exports = { convertToCSV, convertToTaxCSV, writeCSVFile };
