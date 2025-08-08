import { React, useState, useEffect, useRef  } from "react";
import SwapSettingsPopover from "./SwapSettings";   // same pop-over you already use
import { toast } from "sonner";
import AdvancedOrders from "./AdvancedOrders";  
import { motion } from "framer-motion";
import ConfirmModal from "./Modals/ConfirmModal"; // adjust path if needed
import LimitModal from "./Modals/LimitModal";
import DcaModal from "./Modals/DcaModal";
import { checkExistingPosition } from "../../utils/api"
export default function ManualTradeCard({
  config,
  prefs,
  swapOpts,
  setSwapOpts,
  selectedWalletBalance,
  disabled,
  safetyResult,
  handleManualBuy,
  handleManualSell,
  manualBuyAmount,
  setManualBuyAmount,
  manualSellPercent,
  setManualSellPercent,
  handleUseMax,
  overrideActive,
  balanceGlow,
  lastBalanceUpdate,
  lastBlockedMint,
  setLastBlockedMint,
  walletId, 

}) {
  /* ---- local derived helpers ---- */
  // Determine the currently selected target mint. Support both
  // `tokenMint` (used by manual/stealth mode) and `outputMint`
  // (used by rotation/chad/turbo modes). Falling back to
  // `outputMint` allows users to manually trade any selected token.
  const targetMint = config.tokenMint || config.outputMint;

  // Determine whether the buy/sell buttons should be disabled.  In the
  // original implementation trades were blocked when a safety check
  // failed.  This proved confusing because the safety check is
  // optional and some users intentionally trade high‑risk tokens.  To
  // restore manual control we only disable trades when no token mint is
  // selected or the entire panel is globally disabled.  Safety
  // information is still surfaced visually via the glow and toast
  // messages, but it no longer prevents trading.
  const isBuyDisabled  = disabled || !targetMint;
  const isSellDisabled = disabled || !targetMint;
  const [txStatus, setTxStatus] = useState(null); // null | "success" | "error"
  const [missingMint, setMissingMint] = useState(false);
  const mintInputRef = useRef(null);
  const [quotePreview, setQuotePreview] = useState(null);
  const SOL_MINT = "So11111111111111111111111111111111111111112";
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmMeta, setConfirmMeta] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [dcaModalOpen, setDcaModalOpen] = useState(false);  

const [alreadyHolding, setAlreadyHolding] = useState(false);

useEffect(() => {
  if (!targetMint) {
    setAlreadyHolding(false);
    return;
  }

  (async () => {
    const exists = await checkExistingPosition(targetMint, "manual");
    setAlreadyHolding(exists);
  })();
  // We intentionally depend on targetMint here so the effect
  // re‑runs whenever either config.tokenMint or config.outputMint changes.
}, [targetMint]);


useEffect(() => {
  const fetchPreview = async () => {
    if (!targetMint || !manualBuyAmount || isNaN(parseFloat(manualBuyAmount))) {
      setQuotePreview(null);
      return;
    }
    try {
      const lamports = Math.floor(parseFloat(manualBuyAmount) * 1e9); // convert SOL to lamports
      const slippage = swapOpts.slippage || 1;

      const res = await fetch(`/api/quote?inputMint=${SOL_MINT}&outputMint=${targetMint}&amount=${lamports}&slippage=${slippage}`);
      const data = await res.json();

      if (data.error) throw new Error(data.error);
      setQuotePreview({
        outAmount: data.outAmount,
        outToken: data.outToken,
        priceImpact: data.priceImpact,
      });
    } catch (err) {
      setQuotePreview(null);
    }
  };
  fetchPreview();
  // Depend on targetMint so preview updates when either config.tokenMint
  // or config.outputMint changes.
}, [manualBuyAmount, targetMint, swapOpts.slippage]);




  return (
  <motion.div
    className="quick-trade-card rounded-lg border border-zinc-700 p-4 mb-6 bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-700 shadow-inner hover:shadow-emerald-800/10 transition-shadow"
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.35 }}
  >
  {/* Header + Balance + Gear */}
<div className="relative mb-1">
  <div className="flex items-center gap-3">
    <h4 className="text-lg font-semibold text-white">⚡ Quick Manual Trade</h4>
    
    
    <div
      className={`flex items-center text-sm text-zinc-300 ${balanceGlow ? "glow" : ""}`}
      title={`Last updated: ${lastBalanceUpdate || "Unknown"}`}
    >
      <span className="sol-icon mr-1">◎</span>
      <span className={
        selectedWalletBalance > 0.1 ? "text-emerald-400"
        : selectedWalletBalance > 0.09 ? "text-yellow-400"
        : "text-red-400"
      }>
    {selectedWalletBalance.toFixed(3)} SOL
      </span>
    </div>
      <div className="flex items-center gap-2">
    {/* Display the current target token at the top of the card.  We
       support both `tokenMint` (manual/stealth) and `outputMint`
       (rotation/chad/turbo).  If none is defined nothing is shown. */}
    {(() => {
      const mint = config.tokenMint || config.outputMint;
      if (!mint) return null;
      return (
        <span
          className="flex items-center gap-1 text-xs text-blue-300 truncate max-w-[180px] px-2 py-1 \
               rounded-full bg-zinc-800 ring-1 ring-blue-500"
          title={mint}
        >
          <img
            src={`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/${mint}/logo.png`}
            onError={(e) => (e.target.style.display = 'none')}
            alt="token"
            className="w-4 h-4 rounded-full"
          />
          🎯 {mint.slice(0, 6)}...{mint.slice(-4)}
        </span>
      );
    })()}
  </div>
  {/* Top-right gear button */}
  <div className="absolute right-0 top-0" id="open-settings">
    <SwapSettingsPopover
      open={settingsOpen}
      setOpen={setSettingsOpen}
      current={swapOpts.slippage}
      onApply={setSwapOpts}
      alreadyHolding={alreadyHolding}
      className={`px-2 py-1 rounded-md border border-yellow-500 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors ${
        overrideActive ? "text-yellow-400 border-yellow-500" : ""
      }`}
      title="Customize slippage, fees, and TP/SL"
      aria-label="Swap settings"
    />
    </div>
  </div>
</div>
{/* Info config row */}
<div className="flex justify-between items-center mb-3 text-xs">
  <div className="flex items-center gap-2">
    {/* Slippage */}
    <div
      onClick={() => setSettingsOpen(true)}
      title="Higher slippage allows faster trades but can lead to worse pricing"
      className={`cursor-pointer px-2 py-0.5 rounded border transition-colors hover:ring-1 hover:ring-white/20 ${
        swapOpts.slippage < 3
          ? "text-green-400 border-green-500 bg-green-900/20"
          : swapOpts.slippage <= 15
          ? "text-yellow-300 border-yellow-500 bg-yellow-900/20"
          : "text-red-400 border-red-500 bg-red-900/20"
      }`}
    >
      {swapOpts.slippage}% slippage
    </div>

    {/* Priority Fee */}
    <div
  onClick={() => setSettingsOpen(true)}
  title="Priority fee used to speed up transaction"
  className={`cursor-pointer px-2 py-0.5 rounded border hover:ring-1 hover:ring-white/20 ${
    swapOpts.priorityFee > 0
      ? "border-purple-500 bg-purple-900/20 text-purple-300"
      : "border-zinc-600 bg-zinc-800 text-zinc-400 italic"
  }`}
>
  {swapOpts.priorityFee > 0 ? `${swapOpts.priorityFee} Priority Fee` : "No Priority Fee"}
</div>
    {/* TP/SL Status */}
    {swapOpts.enableTPSL && (
      <div
        onClick={() => document.getElementById("open-settings")?.click()}
        title="TP/SL is enabled for this trade"
        className="cursor-pointer px-2 py-0.5 rounded border border-blue-500 bg-blue-900/20 text-blue-300 hover:ring-1 hover:ring-white/20"
      >
        TP/SL ✓
      </div>
    )}
  </div>
</div>
    {/* unified buy/sell row */}
    <div className="flex flex-wrap gap-4 items-center mb-6">
      {/* BUY section */}
      <div className="flex gap-2 items-center">
<div className="relative w-36">
  {/* ✅ Fake Placeholder with logo */}
  {(!manualBuyAmount || manualBuyAmount === "0") && (
    <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center pointer-events-none text-zinc-400 text-sm">
      <img
        src="https://assets.coingecko.com/coins/images/4128/small/solana.png"
        alt="SOL"
        className="w-4 h-4 mr-1"
      />
      Amount
    </div>
  )}

  {/* ✅ Input itself */}
    <input
      ref={mintInputRef}
      type="text"
      inputMode="decimal"
      value={manualBuyAmount}
      onChange={(e) => {
        setManualBuyAmount(e.target.value);
        setMissingMint(false);
      }}
      // Only disable the amount field when the entire card is disabled.  We
      // intentionally allow typing an amount even when no token mint is
      // selected so users can prepare a trade before selecting a token.
      disabled={disabled}
      className={`pl-[2.2rem] pr-12 py-2 w-full bg-zinc-800 border ${
        missingMint ? "border-yellow-400 ring-1 ring-yellow-400 animate-pulse" : "border-zinc-600"
      } text-white rounded placeholder-transparent text-sm`}
      placeholder="Amount"
    />

  {/* Max button */}
  <button
    type="button"
    onClick={handleUseMax}
    disabled={disabled}
    className="absolute right-1 top-1/2 -translate-y-1/2 text-xs bg-zinc-700 hover:bg-zinc-600 text-white px-2 py-1 rounded"
  >
    Max
  </button>
</div>
    <button
      onClick={() => {
        // Validate that a token mint has been selected.  We rely on
        // targetMint here which falls back to config.outputMint if
        // config.tokenMint is undefined.  When no mint is provided the
        // user is prompted to enter one.
        if (!targetMint) {
          setMissingMint(true);
          mintInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          toast.error("⚠️ Enter a token mint address first.");
          return;
        }

        if (alreadyHolding && swapOpts.enableTPSL) {
          toast.error("🚫 You already hold this token with this strategy. Remove TP/SL to proceed.");
          return;
        }

        const amt = Number(manualBuyAmount);

        if (prefs?.confirmBeforeTrade) {
          setConfirmMeta({
            tradeType     : "BUY",
            inputAmount   : amt,
            tokenSymbol   : quotePreview?.outToken || "???",
            expectedOutput: quotePreview?.outAmount || null,
            priceImpact   : quotePreview?.priceImpact ?? null,
            slippage      : swapOpts.slippage || 1,
            priorityFee   : swapOpts.priorityFee || 0,
            takeProfit    : swapOpts.tp ?? swapOpts.takeProfit,
            stopLoss      : swapOpts.sl ?? swapOpts.stopLoss,
            config        : { tokenMint: targetMint, outputMint: targetMint },
          });

          setShowConfirm(true);
        } else {
          handleManualBuy(amt); // 🚀 Skip modal, just buy
        }
      }}
      disabled={isBuyDisabled || !manualBuyAmount}
      className={`bg-emerald-600 hover:bg-emerald-700 text-white py-2 px-5 w-20 rounded transition-transform hover:scale-105 shadow ${
        selectedWalletBalance > 0 ? "hover:shadow-green-500/50" : ""
      } disabled:opacity-50`}
    >
      BUY
    </button>
      </div>

      {/* SELL section */}

      {/* SELL section – ☑️ confirmBeforeTrade flow added */}
      <div className="flex gap-2 items-center ml-auto">
        <input
          type="text"
          inputMode="decimal"
          value={manualSellPercent}
          onChange={(e) => setManualSellPercent(e.target.value)}
          placeholder="%"
          // Only disable when the card is globally disabled.  Users can
          // prepare a sell percentage even before selecting a token.
          disabled={disabled}
          className="w-36 px-3 py-2 bg-zinc-800 border border-zinc-600 text-white rounded"
        />

        <button
          onClick={() => {
            // Validate that a token mint has been selected
            if (!targetMint) {
              toast.error("⚠️ Enter a token mint address first.");
              return;
            }

            const pct = parseFloat(manualSellPercent);
            if (isNaN(pct) || pct <= 0) {
              toast.error("❌ Enter a valid % to sell.");
              return;
            }

            if (prefs?.confirmBeforeTrade) {
              /* build meta for ConfirmModal */
              setConfirmMeta({
                tradeType   : "SELL",
                percent     : pct,
                tokenSymbol : quotePreview?.outToken || "???",
                slippage    : swapOpts.slippage || 1,
                priorityFee : swapOpts.priorityFee || 0,
                /* include outputMint so ConfirmModal’s manual‑token row triggers */
                config      : { tokenMint: targetMint, outputMint: targetMint },
              });
              setShowConfirm(true);
            } else {
              handleManualSell(pct);          // 🚀 skip modal
            }
          }}
          disabled={isSellDisabled || !manualSellPercent}
          className="bg-red-600 hover:bg-red-700 text-white py-2 px-5 w-20 rounded disabled:opacity-50 transition-transform hover:scale-105 shadow"
        >
          SELL
        </button>
      </div>
    </div>

    {/* TX Status / Blocked Token */}
    {txStatus === "success" && (
      <div className="text-emerald-400 text-sm mb-2 animate-pulse font-medium">✅ Transaction sent!</div>
    )}
    {txStatus === "error" && (
      <div className="text-red-400 text-sm mb-2 animate-pulse font-medium">❌ Transaction failed</div>
    )}
    {targetMint === lastBlockedMint && (
      <p className="text-xs text-red-400 italic mb-3">🚫 This token isn’t tradable on Jupiter. Try another.</p>
    )}

    {/* Presets */}
    <div className="flex flex-wrap gap-2 mb-6">
      {[prefs?.autoBuy?.amount ?? 0.05, 0.1, 0.25, 0.5, 1].map((amt) => (
        <button
          key={amt}
          onClick={() => handleManualBuy(amt)}
          disabled={isBuyDisabled}
        className="text-sm bg-gradient-to-br from-emerald-600 to-emerald-800 hover:from-emerald-500 hover:to-emerald-700 px-5 py-1 rounded disabled:opacity-50 transition-transform hover:scale-105 shadow"
        >
          Buy {amt}◎
        </button>
      ))}
      {[25, 50, 100].map((pct) => (
        <button
          key={pct}
          onClick={() => handleManualSell(pct)}
          disabled={isSellDisabled}
        className="text-sm bg-gradient-to-br from-red-700 to-red-800 hover:from-red-500 hover:to-red-700 px-4 py-1 rounded disabled:opacity-50 transition-transform hover:scale-105 shadow"
        >
          Sell {pct}%
        </button>
      ))}
    </div>

    {quotePreview && (
      <div className="text-xs text-zinc-400 italic mb-4">
        Est. Output: <span className="text-white font-semibold">{quotePreview.outAmount}</span>{" "}
        {quotePreview.outToken} • Price Impact:{" "}
        <span
          className={`font-semibold ${
            quotePreview.priceImpact > 2 ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {quotePreview.priceImpact.toFixed(2)}%
        </span>
      </div>
    )}

    <div className="mt-6 flex gap-4">
  <button
    onClick={() => setLimitModalOpen(true)}
    className="rounded bg-purple-700 px-4 py-2 text-sm font-semibold hover:bg-purple-800"
  >
    Set Limit Order
  </button>
  <button
    onClick={() => setDcaModalOpen(true)}
    className="rounded bg-cyan-700 px-4 py-2 text-sm font-semibold hover:bg-cyan-800"
  >
    Set DCA Order
  </button>
</div>

    {/* <div className="mt-8">
      <AdvancedOrders disabled={disabled} />
    </div> */}

      {showConfirm && confirmMeta && (
        <ConfirmModal
          {...confirmMeta}
          onResolve={(ok) => {
            setShowConfirm(false);
            if (!ok) return;
            if (confirmMeta.tradeType === "BUY") {
              handleManualBuy(confirmMeta.inputAmount);
            } else if (confirmMeta.tradeType === "SELL") {
              handleManualSell(confirmMeta.percent);
            }
          }}
        />
      )}
<LimitModal
  open={limitModalOpen}
  onClose={() => setLimitModalOpen(false)}
  walletId={walletId}
  tokenMint={config.tokenMint}
/>
    <DcaModal
      open={dcaModalOpen}
      onClose={() => setDcaModalOpen(false)}
      walletId={walletId}
      tokenMint={config.tokenMint}

    />
  </motion.div>
);
}


