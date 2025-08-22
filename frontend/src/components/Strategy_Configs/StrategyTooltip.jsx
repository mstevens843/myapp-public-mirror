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
      "Percent drop (1–99) that qualifies as a dip. Example: 5 = a 5% price drop.",
    volumeThresholdUSD:
      "Minimum recent trading volume in USD required before a dip can be bought.",
    minMarketCap:
      "Skip tokens with a market cap below this USD value. Helps avoid tiny, illiquid tokens.",
    maxMarketCap:
      "Skip tokens with a market cap above this USD value. Useful if you only want small/mid caps.",
    recoveryWindow:
      "Minutes used as the look-back anchor for dip calculation (compare current price to the price N minutes ago).",
    maxOpenTrades:
      "Maximum number of simultaneous Dip Buyer positions allowed.",

    /* ───────────────────── Common Risk/Exec ───────────────────── */
    slippage:
      "Maximum percent difference allowed between expected and executed price for a trade.",
    maxSlippage:
      "Hard ceiling on price impact. Example: 0.05 = 5%. If a quote exceeds this, the trade is skipped.",
    cooldown:
      "Seconds to wait before buying the same token again. Prevents rapid re-entries.",
    haltOnFailures:
      "Stop the bot after this many consecutive errors. Safety against repeated failures.",
    tpPercent:
      "Percent of the position to sell when a Take Profit trigger is hit. 100 = full position.",
    slPercent:
      "Percent of the position to sell when a Stop Loss trigger is hit. 100 = full position.",
    priorityFeeLamports:
      "Extra lamports to speed up transactions (compute unit price). Higher = faster confirmation, higher cost.",
    briberyAmount:
      "Validator tip (lamports) used by some routers to improve inclusion during congestion.",
    mevMode:
      "Execution preference: 'fast' prioritizes throughput; 'secure' emphasizes front‑run resistance.",

    /* ───────────────────── Safety Checks (generic) ───────────────────── */
    safetyChecks:
      "Pack of checks (honeypot/liquidity/top holders, etc.) that rejects risky tokens before trading.",
    authority:
      "Verify mint/freeze authorities are renounced (or as required). Mitigates rug risk via minting/freezing.",
    liquidity:
      "Require at least this much liquidity in the main pool. Low liquidity = harder exits and more slippage.",
    simulation:
      "Run a pre-trade simulation to catch likely failures before committing on-chain.",
    topHolders:
      "Skip if top holders control more than this share of supply (reduces whale/owner risk).",

    /* ───────────────────── Sniper / PaperTrader (generic) ───────────────────── */
    entryThreshold:
      "Minimum recent percent price move required to consider an entry. Tune to your look-back window.",
    volumeThreshold:
      "Minimum recent trading volume (SOL or USD) required to qualify. Filters out illiquid tokens.",
    interval:
      "Scan interval in seconds. Lower = more frequent scans (and higher resource usage).",
    maxTrades:
      "Maximum number of trades allowed per day.",
    priceWindow:
      "Short look-back window (minutes) for micro-moves. Typical: 1–5 minutes.",
    pumpWindow:
      "Look-back window used to compute percent change for breakout/pump logic (e.g., '6h').",
    volumeWindow:
      "Look-back window used to compute volume metrics (e.g., '1h').",
    volumeSpikeMultiplier:
      "Current volume must be at least this multiple of its average to count as a spike.",
    avgVolumeWindow:
      "Window for the average volume baseline (e.g., '8h' or '24h').",
    monitoredTokens:
      "Optional allow-list. One mint per line; strategies that support it only check these if provided.",
    tokens:
      "Token mints to monitor (one per line).",
    trendSlope:
      "Minimum slope/velocity of price increase required to buy (Trend Follower).",
    trendConfirmationWindow:
      "Number of intervals required to confirm trend momentum before buying (Trend Follower).",
    priceChangeThreshold:
      "Minimum percent price change over the trend window required to trigger a buy (Trend Follower).",
    trendWindow:
      "Look-back window (minutes) used to compute price change for trend logic.",

    /* ───────────────────── Chad Mode / Multi-target ───────────────────── */
    outputMint:
      "Mint address of the token to buy (destination token).",
    targetTokens:
      "Enable multi‑sniping. Paste one mint per line. The bot will scan multiple targets.",
    minVolumeRequired:
      "Minimum liquidity (USD) required. Helps avoid low-liquidity rugs.",
    skipSafetyChecks:
      "⚠️ Disables safety checks (ownership/freeze/honeypot). Very risky — use only if you fully understand the consequences.",

    /* ───────────────────── Auto-sell / PnL Protections ───────────────────── */
    "autoSell.enabled":
      "If ON, the bot automatically sells after a delay you set.",
    "autoSell.delay":
      "Delay in milliseconds before the auto-sell fires after buying.",
    "autoSell.dumpPct":
      "Percent of the current position to sell when the auto-sell triggers.",
    "autoSell.randomJitterMs":
      "±Random jitter added to the auto-sell delay to avoid being predictable.",
    panicDumpPct:
      "If price drops by this percent, dump immediately to cut losses (emergency brake).",
    slippageMaxPct:
      "Absolute maximum slippage allowed. If a quote exceeds this, the trade is skipped.",
    feeEscalationLamports:
      "Add this many lamports per retry for failed transactions to force inclusion during congestion.",

    /* ───────────────────── Delayed Sniper ───────────────────── */
    delayMs:
      "Delay (ms) before executing a buy after detecting the signal.",

    /* ───────────────────── Rebalancer ───────────────────── */
    rebalanceThreshold:
      "Minimum percent deviation from target allocation before rebalancing.",
    minTradeSize:
      "Minimum SOL value per trade to avoid dust-sized orders.",
    targetWeights:
      "Target portfolio weights as JSON. Example: {\"SOL\": 0.5, \"USDC\": 0.5}.",
    targetAllocations:
      "JSON map of { mint: target% } that should sum to 1.0.",

    /* ───────────────────── Rotation Bot ───────────────────── */
    wallets:
      "Comma-separated wallet labels to rotate trades across.",
    rotationInterval:
      "Milliseconds between each rotation scan. Example: 3,600,000 = 1 hour.",
    minMomentum:
      "Minimum percent pump over the look-back to be considered the strongest token.",

    /* ─────────────── Turbo Sniper — Core Filters ─────────────── */
    minTokenAgeMinutes:
      "Require the token to be at least this many minutes old. Newer tokens are higher risk.",
    maxTokenAgeMinutes:
      "Require the token to be no more than this many minutes old. Older tokens may be out of scope for snipes.",
    tokenFeed:
      "Which curated list to pull candidates from (e.g., New, Trending).",
    overrideMonitored:
      "If ON, ignore the selected feed and only use your custom 'Monitored' list.",
    turboMode:
      "Fastest possible routing/submit behavior specialized for sniping (enabled by this strategy).",
    autoRiskManage:
      "Automatic risk steps like reducing size or exiting on sharp adverse moves.",
    privateRpcUrl:
      "Private RPC URL for low-latency routing. Leave blank to use defaults.",

    /* ─────────────── Turbo Sniper — Execution & Jito ─────────────── */
    useJitoBundle:
      "Submit transactions as a Jito bundle for better inclusion in MEV auctions.",
    jitoTipLamports:
      "Tip (lamports) to validators when using Jito bundles. Higher tips → higher inclusion odds.",
    jitoRelayUrl:
      "Custom Jito relay endpoint URL. Optional; leave blank for default relays.",
    autoPriorityFee:
      "Automatically adjust priority fee based on network congestion.",
    bundleStrategy:
      "How to place the bundle: 'topOfBlock' (first), 'backrun' (after target tx), or 'private' (private route).",

    /* Jito / fee tuning */
    cuAdapt:
      "If ON, adjust compute-unit price between attempts when the chain is busy.",
    cuPriceMicroLamportsMin:
      "Minimum compute-unit price (in micro‑lamports) to start with.",
    cuPriceMicroLamportsMax:
      "Maximum compute-unit price (in micro‑lamports) the bot is allowed to reach.",
    tipCurve:
      "Tip escalation strategy across retries. Example: 'linear' or 'exp'.",

    /* Leader-aligned sending & TTLs */
    leaderTiming:
      "Fire slightly before the leader’s slot to land at the top of the block. Improves inclusion probability.",
    "leaderTiming.preflightMs":
      "Milliseconds to pre-warm and pre-send before the target slot (e.g., 220).",
    "leaderTiming.windowSlots":
      "How many leader slots to span while trying to include the bundle (usually 1–3).",
    quoteTtlMs:
      "How long a price quote remains valid (ms). Older quotes are rejected and must be refreshed.",
    idempotencyTtlSec:
      "How long an idempotency key remains valid (seconds). Prevents duplicate submissions within the window.",

    /* Direct AMM Fallback */
    directAmmFallback:
      "If ON, fall back to swapping directly on an AMM when the aggregator fails.",
    directAmmFirstPct:
      "When falling back, this fraction (0–1) of the order goes to the first AMM; the rest follows after.",
    skipPreflight:
      "If ON, skip preflight simulation. Faster, but riskier because some failures won’t be caught early.",

    /* Parallel / split-wallet execution */
    parallelWallets:
      "Execute fills using multiple funded wallets at once to improve inclusion.",
    "parallelWallets.walletIds":
      "Comma-separated internal wallet IDs to use for parallel execution.",
    "parallelWallets.splitPct":
      "Comma-separated fractions (0–1) that define how much of the order each wallet should take.",
    "parallelWallets.maxParallel":
      "Hard cap on how many wallets can try to fill at once.",

    /* Advanced RPC & DEX preferences */
    rpcEndpoints:
      "Comma-separated list of RPC endpoints used for failover/latency balancing.",
    rpcMaxErrors:
      "Max consecutive RPC errors before removing an endpoint from rotation temporarily.",
    allowedDexes:
      "Comma-separated DEX names to include when routing trades (e.g., Raydium,Orca,Meteora).",
    excludedDexes:
      "Comma-separated DEX names to exclude from routing (e.g., Step,Crema).",
    splitTrade:
      "Split a single order across multiple pools to reduce price impact at entry.",

    /* ─────────────── Risk & Heuristics ─────────────── */
    killSwitch:
      "If ON, stop the bot automatically after too many consecutive failures.",
    killThreshold:
      "Number of consecutive failures required to trigger the kill switch.",
    poolDetection:
      "Detect and verify liquidity pools before attempting a trade (reduces failures).",
    impactAbortPct:
      "Abort a trade if the predicted price impact exceeds this percent.",
    dynamicSlippageMaxPct:
      "Upper cap the dynamic slippage calculator is allowed to reach (%).",
    enableInsiderHeuristics:
      "Flag suspicious deployer/contract patterns (e.g., deployer-funded liquidity, same-block snipes).",
    maxHolderPercent:
      "Maximum % of supply allowed for top holders. Exceeding this will skip the trade.",
    requireFreezeRevoked:
      "Require freeze authority to be renounced before buying.",
    enableLaserStream:
      "Use Laser/Geyser WebSocket stream for lower-latency pool detection.",
    alignToLeader:
      "Align submission timing to the leader schedule (e.g., 200ms auctions) to improve inclusion.",
    stopLossPercent:
      "Percent drop from entry that triggers an automatic sell (0 disables).",
    minPoolUsd:
      "Require at least this much USD value in the main pool before buying.",
    maxPriceImpactPct:
      "Maximum allowed price impact (%) for the planned trade. Skips trades that exceed it.",

    /* ─────────────── Post-Buy Watcher ─────────────── */
    postBuyWatch:
      "After buying, watch chain events for early exit signals (LP pulls, authority changes, etc.).",
    "postBuyWatch.durationSec":
      "How long (seconds) to keep watching after the buy. Set 0 to disable.",
    "postBuyWatch.lpPullExit":
      "If ON, exit immediately when significant liquidity is pulled from the pool.",
    "postBuyWatch.authorityFlipExit":
      "If ON, exit when token authority flips (owner changes). Often a rug signal.",
    "postBuyWatch.rugDelayBlocks":
      "Blocks to wait before exiting after a rug/suspicious LP pull. Allows a brief confirmation window.",

    /* ─────────────── Take-Profit & Trail ─────────────── */
    tpLadder:
      "Comma-separated percentages for laddered take-profit exits (e.g., 25,25,50).",
    trailingStopPct:
      "Percent drop from the highest seen price that triggers a trailing stop (protects profits).",

    /* ─────────────── Iceberg / Staggered fills ─────────────── */
    iceberg:
      "Break a large order into smaller chunks to reduce detection and price impact.",
    "iceberg.tranches":
      "How many chunks to split the order into (integer ≥ 1).",
    "iceberg.trancheDelayMs":
      "Delay (ms) between each tranche submission.",

    /* ─────────────── Smart Exit (alpha) ─────────────── */
    smartExitMode:
      "Exit logic type: time-based, volume-based, or liquidity-based. Chooses which signals drive the exit.",
    smartExitTimeMins:
      "Number of minutes to hold before exiting when using a time-based smart exit.",
    smartVolLookbackSec:
      "Look-back window (seconds) used to calculate recent volume for volume-based smart exit.",
    smartVolThreshold:
      "Minimum volume threshold required to keep holding; below this, the smart exit may trigger.",
    smartLiqLookbackSec:
      "Look-back window (seconds) used to track liquidity changes for liquidity-based exits.",
    smartLiqDropPct:
      "Percent liquidity drop that triggers a smart-exit sell.",

    /* ─────────────── Retry / Failover ─────────────── */
    retryPolicy:
      "How the bot retries failed transactions (max attempts, how to bump fees, when to switch routes/RPCs).",
    "retryPolicy.max":
      "Maximum number of retry attempts before giving up.",
    "retryPolicy.bumpCuStep":
      "Increase in compute-unit price per retry attempt.",
    "retryPolicy.bumpTipStep":
      "Increase in validator tip per retry attempt.",
    "retryPolicy.routeSwitch":
      "If ON, allow switching to a different routing path on retries.",
    "retryPolicy.rpcFailover":
      "If ON, rotate to a different RPC endpoint when repeated failures occur.",

    /* ─────────────── Misc advanced (optional surface) ─────────────── */
    privateRelay:
      "Use a private relay to submit transactions privately (avoid public mempool).",
    idempotency:
      "If ON, attach a unique idempotency key to avoid duplicate submissions.",
    cuPriceCurve:
      "Compute-unit price curve coefficients (advanced). Example: [5000, 1000] for base 5000 + 1000/attempt.",
    tipCurveCoefficients:
      "Tip curve coefficients controlling per-attempt validator tips (advanced).",
    riskLevels:
      "Map heuristic outcomes to actions (e.g., reduce size, abort, warn). Advanced users only.",
    rugDelayBlocks:
      "Blocks to wait before exiting after a suspected rug. See also postBuyWatch.rugDelayBlocks.",
    multiWallet:
      "Number of funded wallets to rotate when sniping (one fill attempt per wallet).",

    /* Optional integrations / sources (if surfaced) */
    feeds:
      "List of external feeds to consult (advanced).",
    slippageAuto:
      "Automatically compute slippage from recent volatility (advanced).",
    postTx:
      "Post-transaction actions such as confirmations or cleanups (advanced).",
    pumpfun:
      "Include Pump.fun sources/heuristics when enabled (advanced).",
    airdrops:
      "Track or filter airdrop-related tokens when enabled (advanced).",
  };

  const content = text || lookup[name] || "Tooltip coming soon.";

  return (
    <div className="relative group flex items-center">
      <Info
        size={14}
        className="ml-1 text-zinc-400 hover:text-emerald-300 cursor-pointer"
      />
      <div
        className="absolute right-5 top-[-4px] z-20 hidden group-hover:block
                    bg-zinc-800 text-white text-xs rounded px-2 py-1 border border-zinc-600
                    max-w-[240px] w-max shadow-lg
                    whitespace-pre-line break-words overflow-hidden"
      >
        {content}
      </div>
    </div>
  );
}
