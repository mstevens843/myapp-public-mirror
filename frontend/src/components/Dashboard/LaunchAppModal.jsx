import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import WalletOnboardModal from "../AuthWallet/WalletOnboardModal";
import AuthModal from "../Auth/AuthModal";

export default function LaunchAppModal({ open, setOpen }) {
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const handleClose = () => {
    setOpen(false);
    setShowWalletModal(false);
    setShowAuthModal(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" />
        <Dialog.Content
          className="fixed z-50 top-1/2 left-1/2 w-full max-w-4xl -translate-x-1/2 -translate-y-1/2"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col md:flex-row gap-6 w-full p-6 bg-zinc-900/50 border border-zinc-800 backdrop-blur rounded-2xl shadow-[0_0_60px_rgba(128,0,255,0.2)] relative"
          >
            {/* Close Button */}
            <button
              onClick={handleClose}
              className="absolute top-1 right-3 text-zinc-400 hover:text-white hover:scale-110 transition"
            >
              <X size={20} />
            </button>

            {/* Web3 Login Panel */}
            <div className="flex-1 p-6 rounded-xl border border-zinc-800 flex flex-col items-center justify-center text-center gap-4">
              <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-400 to-fuchsia-500 bg-clip-text text-transparent">
                CONNECT YOUR WALLET
              </h2>
              <h3 className="text-2xl font-bold text-white">
                WITH{" "}
                <span className="bg-yellow-400/20 text-yellow-300 px-2 py-1 rounded-lg shadow">
                  MAX PRIVACY
                </span>
              </h3>
              <p className="text-sm text-zinc-400">
                Use Phantom wallet — no email needed.
              </p>
              <button
                onClick={() => setShowWalletModal(true)}
                className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition-all border-2 border-purple-300/40 shadow-md"
              >
                Connect Phantom Wallet
              </button>
              <p className="text-xs text-zinc-400 mt-2">
                By connecting, you agree to our{" "}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 underline hover:text-white"
                >
                  Terms
                </a>{" "}
                &{" "}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 underline hover:text-white"
                >
                  Privacy
                </a>
              </p>
            </div>

            {/* Divider */}
            <div className="hidden md:flex w-px bg-zinc-800" />

            {/* Web2 Login Panel */}
            <div className="flex-1 p-6 rounded-xl border border-zinc-800 flex flex-col items-center justify-center text-center gap-4">
              <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-transparent">
                EMAIL LOGIN
              </h2>
              <h3 className="text-2xl font-bold text-white">
                UNLOCK{" "}
                <span className="bg-emerald-400/20 text-emerald-300 px-2 py-1 rounded-lg shadow">
                  FULL FEATURES
                </span>
              </h3>
              <p className="text-sm text-zinc-400">
                Portfolio tracking, trade history, 2FA, and more. Secure with 2FA and email recovery.

              </p>

              <button
                onClick={() => setShowAuthModal(true)}
                className="px-6 py-3  bg-teal-600 hover:bg-teal-700 text-white rounded-xl transition-all border border-zinc-700 shadow"
              >
                Login / Sign Up
              </button>

                            <p className="text-xs text-zinc-400 mt-2">
                By connecting, you agree to our{" "}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 underline hover:text-white"
                >
                  Terms
                </a>{" "}
                &{" "}
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-emerald-400 underline hover:text-white"
                >
                  Privacy
                </a>
              </p>
            </div>

            {/* Embedded Modals */}
            <WalletOnboardModal open={showWalletModal} setOpen={setShowWalletModal} />
            <AuthModal open={showAuthModal} setOpen={setShowAuthModal} />
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
