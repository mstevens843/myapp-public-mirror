// components/BuySummarySheet.jsx
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CheckCircle } from "lucide-react";
import { useEffect, useRef } from "react";

export default function BuySummarySheet({ open, onClose, summary }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [summary]);

  // 🛡️ If no summary object yet, render nothing
  if (!summary) return null;

  // ───────── helpers with safe fallbacks ─────────
  const toNum = (v) => {
    const n = typeof v === "string" ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : null;
  };
  const fmtSOL = (n) => (n == null ? "—" : toNum(n).toFixed(6));
  const fmtUSD = (n) =>
    n == null
      ? "—"
      : toNum(n).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

  // Accept a few common aliases so UI doesn't break if backend fields vary.
  const entryPriceSOL =
    toNum(summary.entryPrice) ??
    toNum(summary.entry_price) ??
    toNum(summary.pricePerToken) ??
    null;

  const entryPriceUSD =
    toNum(summary.entryPriceUSD) ??
    toNum(summary.entry_price_usd) ??
    toNum(summary.usdPerToken) ??
    null;

  const totalUSD =
    toNum(summary.usdValue) ??
    toNum(summary.totalUsd) ??
    toNum(summary.totalUSD) ??
    null;

  const tx =
    summary.tx ||
    summary.txHash ||
    summary.signature ||
    summary.transactionHash ||
    null;

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent
        hideOverlay /* ⇦ keeps background clickable */
        side="left"
        className="h-[280px] w-full p-4 overflow-y-auto bg-zinc-900 text-sm font-mono border-t border-zinc-800 z-50"
      >
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <CheckCircle className="text-green-400" />
            Last Buy Summary
          </h3>
        </div>

        <div className="space-y-2 leading-relaxed">
          <p>
            <span className="font-medium">• Entry Price:</span>{" "}
            {fmtSOL(entryPriceSOL)} <span className="text-zinc-400">SOL</span>
          </p>

          <p>
            <span className="font-medium">• Entry Price&nbsp;(USD):</span>{" "}
            <span className="text-zinc-400">$</span>
            {fmtUSD(entryPriceUSD)}
          </p>

          <p>
            <span className="font-medium">• Total USD&nbsp;Value:</span>{" "}
            <span className="text-zinc-400">$</span>
            {fmtUSD(totalUSD)}
          </p>

          <p>
            <span className="font-medium">• Tx:</span>{" "}
            {tx ? (
              <a
                href={`https://explorer.solana.com/tx/${tx}?cluster=mainnet-beta`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 underline"
              >
                View Transaction
              </a>
            ) : (
              <span className="text-zinc-400">—</span>
            )}
          </p>
        </div>

        <div ref={bottomRef} />
      </SheetContent>
    </Sheet>
  );
}
