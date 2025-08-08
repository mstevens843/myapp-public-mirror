// StrategyTooltip.jsx
import { Info } from "lucide-react";

/**
 * Generic tooltip component used across all strategy config screens.
 * If `text` is supplied → show that.
 * Otherwise fall back to a lookup by `name`.
 */
export default function StrategyTooltip({ name, text }) {
  const lookup = {

     /* ---------- Dip Buyer ------------------------------------- */
    dipThreshold:
      "Percentage drop (1-99) that qualifies as a dip.\n5 = 5 % drop.",
    volumeThresholdUSD:
      "Minimum 1-hour volume in **USD** before a dip can be bought.",
    minMarketCap:
      "Skip tokens with a market-cap below this USD value.",
    maxMarketCap:
      "Skip tokens with a market-cap above this USD value.",
    haltOnFailures:
      "Stop the bot after this many consecutive errors.",
    cooldown:
      "Seconds to wait between buys of the same token.",
  recoveryWindow:
  "Minutes back to compare against for drop calculation.\n5 = compare current price vs price 5 min ago.",
maxSlippage:
  "Hard ceiling on price-impact alloweda by the quote.\n0.05 = 5 %.",
maxOpenTrades:
  "Maximum simultaneous open DipBuyer positions.",

      priorityFeeLamports:
      "Additional Compute Units fee you’re willing to pay (lamports).",
    briberyAmount    :
      "Lamports offered to validators as a tip (Jupiter bribery field).",
    mevMode          : "fast = highest throughput · secure = front-run-safe.",
    tpPercent        : "What % of position to sell when TP hits.",
    slPercent        : "What % of position to sell when SL triggers.",


       // ────── Safety Checks ──────
    safetyChecks: "Group of security filters to avoid risky or malicious tokens. Includes honeypot detection, liquidity checks, and top holder analysis.",

    authority: "Verifies the token's mint and freeze authority are either null or renounced. Prevents rug pulls via minting or freezing.",

    liquidity: "Ensures the token has at least $X liquidity in its main pool. Low-liquidity tokens are harder to exit and often more risky.",

    simulation: "Runs a pre-trade simulation to verify that the token can be bought and sold without trapping the user.",

    topHolders: "Checks if the top 5 holders own more than a dangerous % of the token supply. High concentration = high risk of dumping.",


   // ---------- Sniper + PaperTrader --------------------------
    entryThreshold: "Only trade tokens that have pumped at least this % recently.",
    volumeThreshold: "Minimum liquidity volume (in SOL or USD) required before buying.",
    slippage: "Max % difference allowed between expected and executed price.",
    maxSlippage: "Hard ceiling on price impact allowed by the quote.",
    interval: "Interval between scans (seconds). Lower = more frequent.",
    maxTrades: "Maximum number of trades allowed per day.",

    // ---------- Breakout ----------------------------------------------
    entryThreshold:
    "Minimum % pump over lookback window required to buy. (E.g. 18 = 18%)",
  volumeThreshold:
    "Minimum liquidity volume in USD (or SOL) required to qualify. Filters out illiquid rugs.",
  pumpWindow:
    "Time window used to calculate price % change. (e.g. 6h = last 6 hours)",
  volumeWindow:
    "Time window used to calculate volume. (e.g. 1h = last 1 hour)",

   volumeSpikeMultiplier : "How many times current 1h volume must exceed the chosen Avg-Vol Window.",
   avgVolumeWindow       : "Window used to compute average volume (e.g. 24h, 8h).",
   monitoredTokens       : "Tokens to watch – one mint per line. Breakout only checks this list.",
    volumeSpikeMultiplier: "If set to 2, Only trade if volume is at least 2× higher than normal.",


    /* ---------- Scalper --------------------------------------- */
    entryThreshold:
      "Scalper: minimum % pump over the selected short window.\n0.5 = 0.5 % (micro-pump).",
    priceWindow:
      "Short look-back for the micro-pump (1–5 m).",
    volumeWindow:
      "Window to evaluate volume before a scalp (5 m-1 h).",
    cooldown:
      "Seconds to wait before buying the **same** token again.",
    haltOnFailures:
      "Stop the bot after this many consecutive errors.",

      tpPercent: "Percentage of position to sell when Take Profit triggers.\n100 = sell full position.",
slPercent: "Percentage of position to sell when Stop Loss triggers.\n100 = sell full position.",



    // ---------- Trend Follower ----------------------------------------
    trendSlope: "Rate of price increase required to trigger buy.",
    trendConfirmationWindow:
      "Number of intervals to confirm trend momentum.",

          // ---------- Trend Follower ---------------------------------
    priceChangeThreshold:
      "Minimum % price change over trend window. (e.g. 6 = 6%)",
    volumeThreshold:
      "Liquidity in USD. Ensures there's enough volume before entering.",
    trendWindow:
      "Look-back window in minutes to calculate price change trend.",
       priceChangeThreshold : "Minimum % gain over the Trend Window to trigger a buy.",
   trendWindow          : "Look-back window (in minutes) used to compute the price change.",
   tokens               : "Mints TrendFollower will monitor (one per line).",




    // ---------- Chad Mode ---------------------------------------------
outputMint: "The mint address of the token to snipe. Example: 9n4nbM...",
targetTokens: "Enable multi-sniping. Paste one mint address per line.",
minVolumeRequired: "Minimum liquidity in USD required. Avoids low-liquidity rugs.",
priorityFeeLamports: "Extra lamports to speed up transactions. Example: 10,000.",
skipSafetyChecks: "⚠️ Disables all safety checks (ownership, freeze, honeypot). High risk YOLO.",
"autoSell.enabled": "If on, automatically sells after the delay.",
"autoSell.delay": "Milliseconds to wait after buying before dumping.",
"autoSell.dumpPct": "Percentage of your holding to sell on auto-dump.",
"autoSell.randomJitterMs": "Adds a ±random delay to the dump. Helps avoid bot detection.",
panicDumpPct: "If the token price drops by this %, dump immediately to cut losses.",
slippageMaxPct: "Absolute max slippage allowed. If the quote exceeds this %, skip the trade.",
feeEscalationLamports: "Adds this many extra lamports on each retry if your transaction fails. Helps force confirmation during congestion.",
    // ---------- Delayed Sniper ----------------------------------------
    delayMs:
      "Delay time in milliseconds before executing a buy after detecting the signal.",

    // ---------- Rebalancer --------------------------------------------
    rebalanceThreshold:
      "Minimum % deviation from target allocation before triggering a rebalance.",
    slippage: "Max % difference allowed between expected and executed price.",
    minTradeSize: "Minimum SOL value per trade to avoid dust.",
    targetWeights:
      'Target portfolio weights in JSON format. Example: {"SOL": 0.5, "USDC": 0.5}',
     targetAllocations  : "JSON map of {mint: target %}. Must sum to 1.0.",
    // ---------- Rotation Bot ------------------------------------------
    wallets:
      "Comma-separated wallet labels. The bot rotates trades across these wallets.",
    tokens:
            "Comma-separated token mints to rotate through when buying.",
    wallets:
      "Comma-separated wallet labels. The bot rotates trades across these wallets.",
    tokens:
      "Comma-separated token mints to rotate through when buying.",
    rotationInterval:
      "Milliseconds between each rotation scan.\nExample: 3600000 = 1 hour.",
    minMomentum:
      "Minimum % pump required over lookback to consider strongest token.\n(e.g. 2 = 2 %).",
    pumpWindow        : "Look-back window (e.g. 6m) used to rank tokens.",

    /* ---------- Turbo Sniper exclusive fields ---------------------------- */
    ghostMode:
      "Enable ghost mode to forward purchased tokens to a cover wallet immediately after buying.",
    coverWalletId:
      "Identifier of the wallet that will receive tokens when ghost mode is enabled.",
    multiBuy:
      "Enable parallel multi‑buy across multiple pools to increase fill chance.",
    multiBuyCount:
      "Number of parallel buys to execute when multi‑buy is enabled (1–3).",
    prewarmAccounts:
      "Attempt to pre‑initialize token accounts for faster transaction execution.",
    autoRug:
      "Automatically exit positions when suspicious or rug‑like activity is detected.",
    multiRoute:
      "Aggregate liquidity across multiple swap routes for best execution.",
    useJitoBundle:
      "Use a Jito bundle to prioritize your transaction in MEV auctions.",
    jitoTipLamports:
      "Tip amount in lamports sent to validators when using Jito bundles.",
    jitoRelayUrl:
      "Custom Jito relay endpoint URL.",
    autoPriorityFee:
      "Automatically adjust the priority fee based on network congestion.",
    rpcEndpoints:
      "Comma‑separated list of RPC endpoints to use for failover and low latency.",
    rpcMaxErrors:
      "Maximum number of RPC errors allowed before removing an endpoint from rotation.",
    killSwitch:
      "Enable a kill switch to halt the bot after repeated failures.",
    killThreshold:
      "Number of consecutive failures required to trigger the kill switch.",
    poolDetection:
      "Enable detection of liquidity pools before attempting a trade.",
    allowedDexes:
      "Comma‑separated list of DEXes to include when routing trades.",
    excludedDexes:
      "Comma‑separated list of DEXes to exclude from routing.",
    splitTrade:
      "Split the order across multiple liquidity pools to reduce price impact.",
    tpLadder:
      "Comma‑separated percentages for laddered take‑profit exits (e.g. 25,25,50).",
    trailingStopPct:
      "Percentage drop from peak price to trigger a trailing stop sell.",
    turboMode:
      "Enable turbo execution mode for the fastest possible routing. Automatically enabled when using Turbo Sniper.",
    autoRiskManage:
      "Enable automated risk management features such as automatic sell on sharp price movements.",
    privateRpcUrl:
      "URL of a private RPC endpoint used for low‑latency trade routing.",
  };

  const content = text || lookup[name] || "Tooltip coming soon.";

  return (
    <div className="relative group flex items-center">
      <Info
        size={14}
        className="ml-1 text-zinc-400 hover:text-emerald-300 cursor-pointer"
      />
      <div
        className="absolute left-5 top-[-4px] z-20 hidden group-hover:block
                    bg-zinc-800 text-white text-xs rounded px-2 py-1 border border-zinc-600
                    max-w-[200px] w-max shadow-lg
                    whitespace-pre-line break-words overflow-hidden"
      >
        {content}
      </div>
    </div>
  );
}
