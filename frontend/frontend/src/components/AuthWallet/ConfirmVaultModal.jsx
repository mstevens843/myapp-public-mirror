import React, { useState } from "react";
import { motion } from "framer-motion";
import { Eye, EyeOff, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import GlowButton from "@/components/ui/GlowButton";

export default function ConfirmVaultModal({ publicKey, privateKey, onNext }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const handleCopy = (value) => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      key="vault-confirm"
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -30 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col items-center text-center gap-6 p-6"
    >
      <h2 className="text-2xl font-bold text-white">Your Trading Vault</h2>
      <p className="text-zinc-400 max-w-md">
        This wallet is used by the bot to execute trades. Save the private key securely — you won’t be able to view it again.
      </p>

      {/* 🔐 Public Key */}
      {/* <div className="bg-zinc-800 text-sm p-3 rounded-lg border border-zinc-700 flex justify-between w-full max-w-md items-center">
        <span className="truncate text-left">{publicKey}</span>
        <button onClick={() => handleCopy(publicKey)}>
          {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
        </button>
      </div> */}

      {/* 🔒 Private Key */}
      {/* <div className="bg-zinc-800 text-sm p-3 rounded-lg border border-zinc-700 flex justify-between w-full max-w-md items-center">
        <span className="truncate text-left">
          {revealed ? privateKey : "••••••••••••••••••••••••••••••"}
        </span>
        <button onClick={() => setRevealed(!revealed)}>
          {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div> */}

      {/* ✅ Confirmation Checkbox */}
      <label className="flex items-center gap-2 text-sm text-zinc-300 mt-2">
        <input
          type="checkbox"
          checked={confirmChecked}
          onChange={() => setConfirmChecked(!confirmChecked)}
          className="accent-purple-500"
        />
        I’ve saved my private key safely and understand I won't see it again.
      </label>

      {/* Continue */}
      <GlowButton
        onClick={onNext}
        disabled={!confirmChecked}
        className="mt-6 w-full max-w-xs"
      >
        Continue
      </GlowButton>
    </motion.div>
  );
}
