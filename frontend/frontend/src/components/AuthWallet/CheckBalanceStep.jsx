import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { checkVaultBalance } from "../../utils/authWallet";
import { toast } from "sonner";
import { Clipboard, RefreshCw, ArrowRight } from "lucide-react";

export default function CheckBalanceStep({ vaultPubkey, phantomPubkey, onComplete }) {
  const [balance, setBalance] = useState(null);
  const [usdValue, setUsdValue] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchBalance = async () => {
    try {
      setLoading(true);
const res = await checkVaultBalance({ phantomPublicKey: phantomPubkey }); // ✅

      if (res?.balance !== undefined) {
        setBalance(res.balance.toFixed(4));
        const usd = res.balance * 155; // Change rate if needed
        setUsdValue(usd.toFixed(2));
      } else {
        setBalance(null);
        setUsdValue(null);
        toast.error("Invalid balance response");
      }
    } catch (err) {
      toast.error("Failed to fetch balance");
      console.error("Balance check error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(vaultPubkey);
      toast.success("Vault address copied!");
    } catch (err) {
      toast.error("Copy failed");
    }
  };

  return (
    <motion.div
      className="flex flex-col items-center text-center gap-6 p-8 rounded-xl bg-zinc-900/50 border border-zinc-800 backdrop-blur"
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2 className="text-2xl font-bold">Deposit SOL to Begin</h2>
      <p className="text-zinc-400 max-w-md">
        Your vault wallet is ready. Send SOL to this address to activate trading. You’ll need SOL to cover gas and swap costs.
      </p>

      <div className="bg-zinc-800/80 p-4 rounded-lg w-full max-w-md shadow-inner text-left">
        <label className="text-sm text-zinc-400">Vault Address</label>
        <div className="flex justify-between items-center mt-1">
          <code className="text-emerald-400 text-xs break-all">{vaultPubkey}</code>
          <button onClick={handleCopy}>
            <Clipboard size={16} className="text-zinc-400 hover:text-white" />
          </button>
        </div>
      </div>

      <div className="text-center text-sm text-zinc-400 mt-2">
        {loading ? (
          <span className="animate-pulse">Fetching balance...</span>
        ) : balance !== null ? (
          <div>
            <div>
              Current Balance:{" "}
              <span className={balance > 0 ? "text-emerald-400" : "text-red-400"}>
                {balance} SOL
              </span>
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              ≈ ${usdValue} USD
            </div>
          </div>
        ) : (
          <span className="text-red-400">Unable to fetch balance.</span>
        )}
      </div>

      <div className="flex gap-4 mt-4">
        <button
          onClick={fetchBalance}
          className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl flex items-center gap-2"
        >
          <RefreshCw size={16} />
          Refresh Balance
        </button>
        <button
          onClick={onComplete}
          disabled={balance === null}
          className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowRight size={16} />
          Continue
        </button>
      </div>
    </motion.div>
  );
}
