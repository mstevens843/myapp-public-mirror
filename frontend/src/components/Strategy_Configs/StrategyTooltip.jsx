// StrategyTooltip.jsx
import { Info } from "lucide-react";

/**
 * Generic tooltip component used across all strategy config screens.
 * If `text` is supplied → show that.
 * Otherwise fall back to a lookup by `name`.
 */
export default function StrategyTooltip({ name, text }) {
  const lookup = {
    /* ───────────────────── Dip Buyer ───────────────────── */
    dipThreshold:
      "Percent drop (1–99) that qualifies as a dip. Example: 5 = 5% drop.",
    volumeThresholdUSD:
      "Minimum recent trading volume in USD required before a dip can be bought.",
    minMarketCap:
      "Skip tokens with a market cap below this USD value.",
    maxMarketCap:
      "Skip tokens with a market cap above this USD value.",
    recoveryWindow:
      "Minutes used as the look-back anchor for dip calculation (compare current price to price N minutes ago).",
    maxOpenTrades:
      "Maximum number of simultaneous Dip Buyer positions allowed.",

    /* ───────────────────── Common Risk/Exec ───────────────────── */
    slippage:
      "Maximum percent difference allowed between expected and executed price.",
    maxSlippage:
      "Hard ceiling on price impact. Example: 0.05 = 5%.",
    cooldown:
      "Seconds to wait before buying the same token again.",
    haltOnFailures:
      "Stop the bot after this many consecutive errors.",
    tpPercent:
      "Percent of the position to sell when Take Profit triggers. 100 = full position.",
    slPercent:
      "Percent of the position to sell when Stop Loss triggers. 100 = full position.",
    priorityFeeLamports:
      "Extra lamports to speed up transactions (compute unit price).",
    briberyAmount:
      "Validator tip (lamports) used by some routers to improve inclusion.",
    mevMode:
      "Execution preference: 'fast' = throughput; 'secure' = more front-run resistance.",

    /* ───────────────────── Safety Checks ───────────────────── */
    safetyChecks:
      "Set of checks (honeypot/liquidity/top holders, etc.) to avoid risky tokens.",
    authority:
      "Verify mint/freeze authorities are renounced (or as required). Helps prevent rug pulls via minting/freezing.",
    liquidity:
      "Require at least this much liquidity in the main pool. Low liquidity = harder exits and more risk.",
    simulation:
      "Pre-trade simulation to verify buys/sells won’t fail or trap the position.",
    topHolders:
      "Fails if top holders control more than a dangerous percentage of supply.",

    /* ───────────────────── Sniper / PaperTrader (generic) ───────────────────── */
    entryThreshold:
      "Minimum recent percent move required to consider an entry. Tune for each strategy’s look-back.",
    volumeThreshold:
      "Minimum recent volume (SOL or USD) required to qualify. Helps filter illiquid tokens.",
    interval:
      "Scan interval in seconds. Lower = more frequent scans (higher load).",
    maxTrades:
      "Maximum number of trades allowed per day.",

    /* ───────────────────── Breakout ───────────────────── */
    pumpWindow:
      "Look-back window used to compute percent change for breakout logic (e.g., 6h).",
    volumeWindow:
      "Look-back window used to compute volume metrics (e.g., 1h).",
    volumeSpikeMultiplier:
      "Current volume must be at least this multiple of its average (spike filter).",
    avgVolumeWindow:
      "Window for average volume baseline (e.g., 8h, 24h).",
    monitoredTokens:
      "Optional allow-list. One mint per line; Breakout only checks these if provided.",

    /* ───────────────────── Scalper ───────────────────── */
    priceWindow:
      "Short look-back window for micro-moves (e.g., 1–5 minutes).",

    /* ───────────────────── Trend Follower ───────────────────── */
    trendSlope:
      "Minimum slope/velocity of price increase required to buy.",
    trendConfirmationWindow:
      "Number of intervals required to confirm trend momentum.",
    priceChangeThreshold:
      "Minimum percent price change over the trend window to trigger a buy.",
    trendWindow:
      "Look-back window (minutes) used to compute the price change.",
    tokens:
      "Mints to monitor (one per line).",

    /* ───────────────────── Chad Mode ───────────────────── */
    outputMint:
      "Mint address of the token to buy (destination token).",
    targetTokens:
      "Enable multi-sniping. Paste one mint per line.",
    minVolumeRequired:
      "Minimum liquidity (USD) required. Avoids low-liquidity rugs.",
    skipSafetyChecks:
      "⚠️ Disables safety checks (ownership/freeze/honeypot). High risk.",
    "autoSell.enabled":
      "If on, automatically sell after a delay.",
    "autoSell.delay":
      "Delay in milliseconds before the auto-sell fires.",
    "autoSell.dumpPct":
      "Percent of the position to sell on the auto-sell.",
    "autoSell.randomJitterMs":
      "±Random jitter added to the delay to avoid being predictable.",
    panicDumpPct:
      "If price drops by this percent, dump immediately to cut losses.",
    slippageMaxPct:
      "Absolute max slippage allowed. If a quote exceeds this, skip trade.",
    feeEscalationLamports:
      "Add this many lamports per retry for failed transactions to force inclusion.",

    /* ───────────────────── Delayed Sniper ───────────────────── */
    delayMs:
      "Delay (ms) before executing a buy after detecting the signal.",

    /* ───────────────────── Rebalancer ───────────────────── */
    rebalanceThreshold:
      "Minimum percent deviation from target allocation before rebalancing.",
    minTradeSize:
      "Minimum SOL value per trade to avoid dust.",
    targetWeights:
      'Target portfolio weights as JSON. Example: {"SOL": 0.5, "USDC": 0.5}',
    targetAllocations:
      "JSON map of { mint: target% } that should sum to 1.0.",

    /* ───────────────────── Rotation Bot ───────────────────── */
    wallets:
      "Comma-separated wallet labels to rotate trades across.",
    rotationInterval:
      "Milliseconds between each rotation scan. Example: 3600000 = 1 hour.",
    minMomentum:
      "Minimum percent pump over the look-back to consider the strongest token.",
    // Re-use common keys: tokens, pumpWindow

    /* ─────────────── Turbo Sniper exclusive fields ─────────────── */
    ghostMode:
      "Forward purchased tokens to a cover wallet immediately.",
    coverWalletId:
      "Wallet that receives tokens when ghost mode is enabled.",
    multiBuy:
      "Enable parallel multi-buy across multiple pools.",
    multiBuyCount:
      "Number of parallel buys when multi-buy is enabled (1–3).",
    prewarmAccounts:
      "Attempt to pre-initialize token accounts for faster execution.",
    autoRug:
      "Auto-exit positions on suspicious or rug-like activity.",
    multiRoute:
      "Aggregate liquidity across multiple routes for best execution.",
    useJitoBundle:
      "Submit as a Jito bundle to prioritize in MEV auctions.",
    jitoTipLamports:
      "Tip (lamports) to validators when using Jito bundles.",
    jitoRelayUrl:
      "Custom Jito relay endpoint URL.",
    autoPriorityFee:
      "Automatically adjust priority fee based on congestion.",
    rpcEndpoints:
      "Comma-separated list of RPC endpoints for failover/latency.",
    rpcMaxErrors:
      "Max RPC errors before removing an endpoint from rotation.",
    killSwitch:
      "Enable a kill switch after repeated failures.",
    killThreshold:
      "Consecutive failures required to trigger the kill switch.",
    poolDetection:
      "Detect liquidity pools before attempting a trade.",
    allowedDexes:
      "Comma-separated DEXes to include when routing trades.",
    excludedDexes:
      "Comma-separated DEXes to exclude from routing.",
    splitTrade:
      "Split orders across pools to reduce price impact.",
    tpLadder:
      "Comma-separated percentages for laddered take-profit exits (e.g., 25,25,50).",
    trailingStopPct:
      "Percent drop from peak price that triggers a trailing stop.",
    turboMode:
      "Fastest possible routing mode. Auto-enabled by Turbo Sniper.",
    autoRiskManage:
      "Auto risk features (e.g., sell on sharp adverse moves).",
    privateRpcUrl:
      "Private RPC URL for low-latency routing.",

    // Turbo Sniper++ additions
    enableInsiderHeuristics:
      "Flag suspicious deployer patterns (e.g., deployer-funded liquidity, same-block snipes) and skip flagged tokens.",
    maxHolderPercent:
      "Maximum % of supply allowed for top holders. Exceeding this will skip the trade.",
    requireFreezeRevoked:
      "Require freeze authority to be renounced before buying.",
    enableLaserStream:
      "Use Laser/Geyser WebSocket stream for lower-latency pool detection.",
    multiWallet:
      "Number of funded wallets to rotate when sniping (one fill attempt per wallet).",
    alignToLeader:
      "Align submission to the next 200 ms auction tick via leader schedule to improve inclusion.",
    cuPriceCurve:
      "Compute unit price curve coefficients, e.g., [5000, 1000] for base 5000 +1000 per attempt.",
    tipCurveCoefficients:
      "Tip curve coefficients controlling per-attempt validator tips.",
    riskLevels:
      "Map heuristic outcomes to actions (e.g., adjust size, abort, warn).",
    stopLossPercent:
      "Percent drop from entry that triggers an automatic sell (0 disables).",
    rugDelayBlocks:
      "Blocks to wait before exiting after a rug/suspicious liquidity pull.",
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
                    max-w-[240px] w-max shadow-lg
                    whitespace-pre-line break-words overflow-hidden"
      >
        {content}
      </div>
    </div>
  );
}
