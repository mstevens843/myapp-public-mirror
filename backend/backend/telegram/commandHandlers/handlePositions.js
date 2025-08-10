// handlePositions.js - Telegram handler for /positions command
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { sessions } = require("../utils/sessions");
const { getCurrentWallet, getWalletBalance } = require("../../services/utils/wallet/walletManager");
const { getTokenAccountsAndInfo } = require("../../utils/tokenAccounts");
const { getCachedPrice } = require("../../utils/priceCache.dynamic");
const { getBirdeyeDefiPrice } = require("../../utils/birdeye");
const { loadSettings } = require("../utils/tpSlStorage");


const PAGE_SIZE = 5;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = async function handlePositions(bot, msg, pageOverride = null) {
  const chatId = msg.chat.id;
  const session = sessions[chatId] ?? {};
  const hidden = session.hiddenTokens || [];
  const sortMode = session.sortMode || "default";

  const sortLabel = {
    default: "None",
    gainers: "Top Gainers",
    losers: "Top Losers",
  }[sortMode];

  const wallet = getCurrentWallet();
  const tokenAccounts = await getTokenAccountsAndInfo(wallet.publicKey);
  const solBalance = await getWalletBalance(wallet);
const solPrice = await getCachedPrice("So11111111111111111111111111111111111111112");
  const solValueUSD = +(solBalance * solPrice).toFixed(2);

  let allPositions = [];

  for (let i = 0; i < tokenAccounts.length; i++) {
    const { mint, name, amount } = tokenAccounts[i];
// ⛔ Skip stablecoins from appearing in /positions
const stableMints = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USDH1SM1ojwWUga67PGrgFWUHibbjqMvuMaDkRJTgkX", // USDH
  "7kbnvuGBxxj8AG9qp8Scn56muWGaRaFqxg1FsRp3PaFT", // UXD
]);    
    if (stableMints.has(mint)) continue;  
    if (!amount || amount * 10 ** 6 < 1) continue; // ✅ filter anything below 0.000001

    const price = await getCachedPrice(mint);
    console.log("Fetching Birdeye stats for:", mint);
    const stats = await getBirdeyeDefiPrice(mint); // ✅ only once, we still need stats

    let entryPriceUSD = null;
    try {
      const openTrades = require("../../logs/open-trades.json");
      const open = openTrades.find((t) => t.mint === mint);
      if (open?.entryPriceUSD) entryPriceUSD = open.entryPriceUSD;
    } catch (err) {
      console.warn("⚠️ Could not read open-trades.json:", err.message);
    }
    await sleep(250); // ⚠️ important to stagger to avoid 429s
    if (!price && stats?.price) price = stats.price;
    const valueUSD = price ? +(amount * price).toFixed(2) : 0;
    const valueSOL = +(amount).toFixed(4);
    const cleanName = name && name !== "Unknown" ? name : mint.slice(0, 4) + "..." + mint.slice(-4);
    
    const userSettings = loadSettings()[chatId] || {};
    const tpSl = userSettings[mint];
    let tpSlStatus = "";
    
    if (tpSl) {
      const enabled = tpSl.enabled !== false;
      const tp = tpSl.tp ?? "–";
      const sl = tpSl.sl ?? "–";
      tpSlStatus = `${enabled ? "🎯" : "⛔"} TP: ${tp}% | SL: ${sl}%`;
    }

    let pnlPct = null;
    if (entryPriceUSD && price) {
      pnlPct = ((price - entryPriceUSD) / entryPriceUSD) * 100;
    }


    allPositions.push({
      index: i + 1,
      name: name?.replace(/[^\x20-\x7E]/g, "") || "Unknown",
      mint: mint.slice(0, 4) + "..." + mint.slice(-4),
      fullMint: mint,
      pnlPct: typeof pnlPct === "number"
      ? `${pnlPct >= 0 ? "🟢" : "🔴"} ${pnlPct.toFixed(2)}%`
      : "—",
      pnlSol: price ? `${(amount * price * stats.priceChange24h / 100).toFixed(3)} SOL` : "—",
      value: `${price ? `$${valueUSD}` : "Price Unknown"} / ${valueSOL} ${cleanName}` +
      (entryPriceUSD ? `\n📉 Entry: $${entryPriceUSD}` : "") +
      (tpSlStatus ? `\n${tpSlStatus}` : ""),      mcap: stats?.marketCap ? `$${(stats.marketCap / 1e6).toFixed(1)}M` : "—",
      movement: {
        "5m": stats?.change5m ?? "—",
        "1h": stats?.change1h ?? "—",
        "6h": stats?.change6h ?? "—",
        "24h": stats?.change24h ?? "—"
      },   
      url: `https://birdeye.so/token/${mint}`,
    });
  }

  let visiblePositions = allPositions.filter(p => !hidden.includes(p.fullMint));

  const parsePnl = (p) => {
    const raw = p.pnlPct?.replace(/[^\d\.-]/g, ""); // strip everything except digits, dot, minus
    const val = parseFloat(raw);
    return isNaN(val) ? 0 : val;
  };
  if (sortMode === "gainers") visiblePositions.sort((a, b) => parsePnl(b) - parsePnl(a));
  if (sortMode === "losers") visiblePositions.sort((a, b) => parsePnl(a) - parsePnl(b));

  const total = visiblePositions.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const page = pageOverride ?? session.positionsPage ?? 0;
  sessions[chatId] = { ...sessions[chatId], positionsPage: page };

  const start = page * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const current = visiblePositions.slice(start, end);

  for (const pos of current) {
    const text = `
/${pos.index} [${pos.name}](${pos.url})
• Mint: \`${pos.fullMint}\`
Profit: ${pos.pnlPct} / ${pos.pnlSol}
Value: ${pos.value}
Mcap: ${pos.mcap}
5m: ${pos.movement["5m"] ?? "–"}, 1h: ${pos.movement["1h"] ?? "–"}, 6h: ${pos.movement["6h"] ?? "–"}, 24h: ${pos.movement["24h"] ?? "–"}
    `;

    const tokenTpSl = loadSettings()[chatId]?.[pos.fullMint];
    const hasTpSl = tokenTpSl && (tokenTpSl.tp || tokenTpSl.sl);
    
    const buttons = [
      [
        { text: `🔁 Sell & Manage ${pos.name}`, callback_data: `manage:${pos.fullMint}` },
        { text: "🔄 Buy Again", callback_data: `buyAgain:${pos.fullMint}` },
      ],
    ];

    buttons.push([
      // { text: "⚡️ Quick Sell (100%)", callback_data: `sellPercent:100:${mint}` },
      { text: "⚡️ Quick Sell (100%)", callback_data: `sellPercent:100:${pos.fullMint}` },
      { text: "⚡️ Quick Buy (auto-buy amount)", callback_data: `quickBuy:${pos.fullMint}` },
    ]);
    
    if (hasTpSl) {
      buttons.push([
        { text: "✏️ Edit TP/SL", callback_data: `tpSl:edit:${pos.fullMint}` },
      ]);
    }

    await bot.sendMessage(chatId, text.trim(), {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buttons },
    });
  }

  // 📊 Net worth summary
  const balanceSOL = `${solBalance.toFixed(4)} SOL`;
  const tokenUSD = allPositions.reduce((sum, t) => {
    const usd = parseFloat(t.value.split(" ")[0].replace("$", ""));
    return isNaN(usd) ? sum : sum + usd;
  }, 0);
  const netWorth = `$${(tokenUSD + solValueUSD).toFixed(2)}`;

  let warnings = [];
  if (solBalance < 0.01) warnings.push("⚠️ *Low balance:* May not be able to trade.");
  if (visiblePositions.length === 0) warnings.push("⚠️ *No tradable tokens:* You may have hidden everything.");

    // Find USDC info manually
    const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const usdcAccount = tokenAccounts.find((t) => t.mint === USDC_MINT);
    const usdcBalance = usdcAccount?.amount ?? 0;
    const usdcPrice = await getCachedPrice(USDC_MINT);
    const usdcValueUSD = +(usdcBalance * (usdcPrice || 1)).toFixed(2);

    let summaryMsg = [
      "🔍 *Token Search:*",
      "[Birdeye](https://birdeye.so) | [DEX Screener](https://dexscreener.com/solana)",
      "",
      `• SOL: ${solBalance.toFixed(4)} SOL ($${solValueUSD.toFixed(2)})`,
      `• USDC: ${usdcBalance.toFixed(2)} USDC ($${usdcValueUSD.toFixed(2)})`,
      `Net Worth: $${(tokenUSD + solValueUSD + usdcValueUSD).toFixed(2)}`
    ];

  if (solBalance < 0.01) summaryMsg.unshift("⚠️ *Low SOL balance:* You may not be able to trade.");
  if (visiblePositions.length === 0) summaryMsg.unshift("⚠️ *No tradable tokens:* You may have hidden everything.");

  summaryMsg = summaryMsg.join("\n");

  const footerButtons = [];
  if (hidden.length > 0) {
    summaryMsg += `\n\n🙈 *${hidden.length} hidden tokens not shown.*`;
    footerButtons.push([{ text: "Show Hidden Tokens", callback_data: "unhide" }]);
  }

  const navButtons = [];
  if (page > 0) navButtons.push({ text: "⬅️ Prev", callback_data: "positions:prev" });
  if (end < total) navButtons.push({ text: "➡️ Next", callback_data: "positions:next" });

  const sortButtons = [
    [
      { text: "🔼 Gainers", callback_data: "sort:gainers" },
      { text: "🔽 Losers", callback_data: "sort:losers" },
      { text: "🔄 Refresh", callback_data: "positions" }
    ],
  ];

  const menuButtons = [
    [{ text: "💸 Buy", callback_data: "buy" }, { text: "💰 Sell & Manage", callback_data: "sell" }],
    [{ text: "📈 Positions", callback_data: "positions" }, { text: "📊 Trade History", callback_data: "trades" }],
    [{ text: "💳 Wallet", callback_data: "wallet" }, { text: "🛡️ Safety", callback_data: "safety" }],
    [{ text: "⚙️ Settings", callback_data: "settings" }, { text: "🔔 Alerts", callback_data: "alerts" }],
    [{ text: "🎯 DCA Orders", callback_data: "dca" }, { text: "📐 Limit Orders", callback_data: "limits" }],
    [{ text: "⛔ TP / SL Config", callback_data: "tpsl" }, { text: "🎁 Refer Friends", callback_data: "refer" }],
  ];

  await bot.sendMessage(chatId, summaryMsg, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [...sortButtons, ...menuButtons, ...footerButtons, navButtons.length ? navButtons : []],
    },
  });
};
/**
 * ✅ Result
Each token in /positions now shows:

css
Copy
Edit
[ 🔁 Sell & Manage SLAP ] [ 🔄 Buy Again ]
User taps Buy Again → prompted for amount → buy executes.

✅ Feature added. ✅ Flow matches everything else.
You're now done for real, legend.


🛠️ Alternative Workaround (Manual Estimation)
If you still want to approximate market cap for major tokens:

js
Copy
Edit
// Estimate: price * supply
const estMarketCap = price * totalSupply;
You can get totalSupply using Solana’s native SPL tools:

js
Copy
Edit
const { getMint } = require("@solana/spl-token");
const mintInfo = await getMint(connection, new PublicKey(mint));
const totalSupply = Number(mintInfo.supply) / (10 ** mintInfo.decimals);
⚠️ This gives total supply, not circulating — so your market cap will be inflated unless the token has no locked tokens.


 */