import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { generateVault } from "../../utils/authWallet";
import { toast } from "sonner";
import { KeyRound, Copy, Eye, EyeOff, Check } from "lucide-react";

export default function GenerateVaultStep({ phantomPubkey, onNext, setVaultPubkey }) {
  const [vault, setVault] = useState(null);
  const [privateKey, setPrivateKey] = useState(null);
  const [showPrivate, setShowPrivate] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [agreed, setAgreed] = useState(true);

  useEffect(() => {
    console.log("🧠 phantomPubkey prop:", phantomPubkey);
  }, [phantomPubkey]);

  const handleGenerate = async () => {
    if (!phantomPubkey) {
      toast.error("Phantom wallet not connected.");
      return;
    }

    if (!agreed) {
      toast.error("You must agree to the Terms and Privacy to continue.");
      return;
    }

    try {
      console.log("🧪 generating vault with pubkey:", phantomPubkey);

      const payload = {
        phantomPublicKey: phantomPubkey,
        agreedToTerms: agreed,
      };

      const res = await generateVault(payload);

      if (!res?.vaultPublicKey || !res?.vaultPrivateKey) {
        toast.error(res?.error || "Vault generation failed.");
        return;
      }

      // Cookies are set by the backend. Do not persist tokens in storage.
      // If you still had legacy tokens, you can clear them here (optional).

      setVault(res.vaultPublicKey);
      setPrivateKey(res.vaultPrivateKey);
      setVaultPubkey?.(res.vaultPublicKey);

      toast.success("✅ Vault wallet generated.");
    } catch (err) {
      console.error("🔥 Vault gen error:", err);
      toast.error("Vault generation error.");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(vault);
      setCopied(true);
      toast.success("📋 Vault public key copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Copy failed");
    }
  };

  // ✅ Pass vault data back to parent when continuing
  const handleContinue = () => {
    if (!confirmChecked) return;
    onNext?.({ pubkey: vault, privateKey });
  };

  return (
    <motion.div
      className="flex flex-col items-center text-center gap-6 p-8 rounded-xl bg-zinc-900/50 border border-zinc-800 backdrop-blur"
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2 className="text-2xl font-bold">
        {vault ? "Your Trading Vault" : "Generate Vault Wallet"}
      </h2>
      <p className="text-zinc-400 max-w-md">
        {vault
          ? "This wallet is used by the bot to execute trades. Save the private key securely — you won’t be able to view it again."
          : "This is the wallet your trading bots will use. Keep its private key safe. You’ll only see it once."}
      </p>

      {phantomPubkey && (
        <div className="bg-zinc-800/70 px-4 py-2 rounded-lg border border-zinc-700 text-left w-full max-w-md">
          <label className="text-xs text-zinc-400">Connected Phantom Wallet</label>
          <p className="text-emerald-400 font-mono text-sm break-all mt-1">
            {phantomPubkey}
          </p>
        </div>
      )}

      {!vault ? (
        <button
          onClick={handleGenerate}
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow transition-all flex items-center gap-2"
        >
          <KeyRound size={18} />
          Generate Vault Wallet
        </button>
      ) : (
        <>
          {/* 🔓 Vault Display */}
          <div className="bg-zinc-800/80 p-4 rounded-lg w-full max-w-md shadow-inner text-left">
            <label className="text-sm text-zinc-400">Public Key</label>
            <div className="flex justify-between items-center mt-1">
              <code className="text-emerald-400 text-xs break-all">{vault}</code>
              <button onClick={handleCopy}>
                {copied ? (
                  <Check size={16} className="text-emerald-400" />
                ) : (
                  <Copy size={16} className="text-zinc-400 hover:text-white" />
                )}
              </button>
            </div>

            <div className="mt-4 border-t border-zinc-700 pt-4">
              <label className="text-sm text-zinc-400">Private Key</label>
              <div className="flex justify-between items-center mt-1">
                <span className="text-red-500 text-xs break-all">
                  {showPrivate ? privateKey : "[Hidden for security]"}
                </span>
                <button onClick={() => setShowPrivate(!showPrivate)}>
                  {showPrivate ? (
                    <EyeOff size={16} className="text-zinc-400 hover:text-white" />
                  ) : (
                    <Eye size={16} className="text-zinc-400 hover:text-white" />
                  )}
                </button>
              </div>
            </div>
          </div>

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

          {/* Continue Button */}
          <button
            disabled={!confirmChecked || !vault}
            onClick={handleContinue}
            className={`mt-6 px-6 py-3 rounded-xl transition-all w-full max-w-xs ${
              confirmChecked && vault
                ? "bg-yellow-600 hover:bg-yellow-700 text-white"
                : "bg-zinc-700 text-zinc-400 cursor-not-allowed"
            }`}
          >
            I’ve Saved My Private Key
          </button>
        </>
      )}

      <label className="text-sm flex items-center gap-2 text-zinc-400">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="accent-emerald-500 h-4 w-4"
        />
        <span>
          By connecting, I agree to the{" "}
          <a
            href="/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white text-emerald-400"
          >
            Terms
          </a>{" "}
          &{" "}
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white text-emerald-400"
          >
            Privacy
          </a>
        </span>
      </label>
    </motion.div>
  );
}
