// frontend/components/WalletAuth/WalletOnboardModal.jsx
import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import ConnectWalletStep from "./ConnectWalletStep";
import GenerateVaultStep from "./GenerateVaultStep";
import CheckBalanceStep from "./CheckBalanceStep";
import { useNavigate } from "react-router-dom"; // ⬅️ add this at the top
import { toast } from "sonner";

export default function WalletOnboardModal({ open, setOpen }) {
  const [phantomPubkey, setPhantomPubkey] = useState(null);
  const [vaultData, setVaultData] = useState({ pubkey: "", privateKey: "" });
  const [step, setStep] = useState(0);

const handlePhantomConnected = () => {
  console.log("🧠 Phantom wallet connected");
  setStep(1);
};

  const handleVaultGenerated = (data) => {
    setVaultData((prev) => ({ ...prev, ...data })); // preserve object
    setStep(2);
  };

 // Inside component:
const navigate = useNavigate(); // ⬅️ add this

const handleComplete = () => {
  toast.success("Account created!");
  setTimeout(() => {
    setOpen(false);
    navigate("/app");
  }, 1000); // small delay so user sees the toast
};

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" />
        <Dialog.Content
          className="fixed z-50 top-1/2 left-1/2 max-w-md w-[95%] -translate-x-1/2 -translate-y-1/2 bg-zinc-950 border border-zinc-800 rounded-xl p-6 shadow-xl"
        >
          <div className="flex justify-between items-center mb-4">
            <Dialog.Title className="text-lg font-semibold text-white">
              {step === 0 && "Connect Wallet"}
              {step === 1 && "Generate Trading Wallet"}
              {step === 2 && "Deposit SOL"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="text-zinc-500 hover:text-white">
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          {/* Step Switcher */}
          {step === 0 && (
            <ConnectWalletStep
              onNext={handlePhantomConnected}
              setPhantomPubkey={setPhantomPubkey}
            />
          )}

          {step === 1 && (
            <GenerateVaultStep
              phantomPubkey={phantomPubkey}
              onNext={handleVaultGenerated}
              setVaultPubkey={(pubkey) =>
                setVaultData((prev) => ({ ...prev, pubkey }))
              }
            />
          )}

        {step === 2 && (
          <CheckBalanceStep
            vaultPubkey={vaultData?.pubkey}
            phantomPubkey={phantomPubkey} // ✅ secure + correct
            onComplete={handleComplete}
          />
        )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
