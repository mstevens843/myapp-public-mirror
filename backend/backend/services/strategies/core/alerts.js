const { sendAlert } = require("../../../telegram/alerts");

/* ---------- emoji map based on STRATEGIES config ---------- */
const emojiByCategory = {
  Sniper        : "🔫",
  Scalper       : "⚡",
  "Break-out"   : "🚀",
  "Chad Mode"   : "🔥",
  "Dip Buyer"   : "💧",
  "Delay Sniper": "⏱️",
  "Trend Follow": "📈",
  "Paper Trader": "📝",
  Rebalancer    : "⚖️",
  "Rotation Bot": "🔁",
  "Stealth Bot" : "🥷",
  "Scheduled" : "📅",
  // fallback
  Unknown       : "🤖",
};

/* ---------- one-shot trade alert ------------------------------------ */
async function tradeExecuted({
  userId,
  mint,
  amountFmt,
  usdValue = null,
  entryPriceUSD = null,
  tpPercent = null,
  slPercent = null,
  impactPct = null,
  wl = "default",
  tx = null,
  category = "Unknown",
  simulated = false,
}) {
  const tokenUrl = `https://birdeye.so/token/${mint}`;
  const txUrl    = `https://solscan.io/tx/${tx}`;
  const short    = `${mint.slice(0, 4)}…${mint.slice(-4)}`;
  const time     = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const emoji    = emojiByCategory[category] || "🤖";

  const lines = [
    `${emoji} *${category} Buy Executed!*`,
    ``,
    `🧾 *Mint:* \`${short}\``,
    `🔗 [View Token on Birdeye](${tokenUrl})`,
    amountFmt && usdValue !== null
      ? `💸 *In:* ${amountFmt} ≈ \`$${usdValue}\``
      : null,
    impactPct !== null
      ? `📊 *Impact:* \`${impactPct.toFixed(2)}%\``
      : null,
    entryPriceUSD !== null
      ? `📈 *Entry:* \`$${entryPriceUSD}\``
      : null,
    tpPercent !== null || slPercent !== null
      ? `🎯 *TP/SL:* \`+${tpPercent ?? "N/A"} % / -${slPercent ?? "N/A"} %\``
      : null,
    `👤 *Wallet:* \`${wl}\``,
    `🕒 *Time:* ${time}`,
    simulated
      ? `📡 *Simulated:* ✅`
      : `📡 [View Transaction](${txUrl})`,
  ].filter(Boolean).join("\n");

  await sendAlert(userId, lines, category);
}

/* ---------- summary helper ------------------------------------------ */
function createSummary(label = "Unknown", logger = console.log, userId) {
  const counts = new Map();

  function inc(key, n = 1) {
    counts.set(key, (counts.get(key) || 0) + n);
  }

  async function printAndAlert(category = label) {
    const ordered = ["scanned", "ageSkipped", "filters", "safety", "buys", "errors"];
    const plain = ordered
      .map(k => `• ${k.replace(/^[a-z]/, c => c.toUpperCase())}: ${counts.get(k) ?? 0}`)
      .join("\n");
    const md = ordered
      .map(k => `• ${k.replace(/^[a-z]/, c => c.toUpperCase())}: *${counts.get(k) ?? 0}*`)
      .join("\n");

    logger("summary", `🧾 Final ${category} Summary`);
    plain.split("\n").forEach(line => logger("summary", line));

    await sendAlert(userId, `🧾 *${category} Final Summary*\n${md}`, category);
  }

  return { inc, printAndAlert };
}

module.exports = { tradeExecuted, createSummary };
