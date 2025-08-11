// components/BuySummarySheet.jsx
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { CheckCircle } from "lucide-react"
import { useEffect, useRef } from "react"

export default function BuySummarySheet({ open, onClose, summary }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [summary])

  // 🛡️ If no summary yet, render nothing
  if (!summary) return null

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent
        hideOverlay          /* ⇦ keeps background clickable */
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
            {summary.entryPrice?.toFixed(6)} SOL
          </p>
          <p>
            <span className="font-medium">• Entry Price&nbsp;(USD):</span>{" "}
            ${summary.entryPriceUSD}
          </p>
          <p>
            <span className="font-medium">• Total USD&nbsp;Value:</span>{" "}
            ${summary.usdValue}
          </p>
          <p>
            <span className="font-medium">• Tx:</span>{" "}
            <a
              href={`https://explorer.solana.com/tx/${summary.tx}?cluster=mainnet-beta`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 underline"
            >
              View Transaction
            </a>
          </p>
        </div>

        <div ref={bottomRef} />
      </SheetContent>
    </Sheet>
  )
}
