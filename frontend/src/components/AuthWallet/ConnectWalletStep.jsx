import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { phantomLogin } from "../../utils/authWallet";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { checkUserExists } from "../../utils/authWallet";


export default function ConnectWalletStep({ onNext, setPhantomPubkey }) {
  const { signMessage } = useWallet(); // ✅ Keep adapter
  const [loading, setLoading] = useState(false);
  const [connectedKey, setConnectedKey] = useState(null);
  // const base64Signature = btoa(String.fromCharCode(...signature));


  const navigate = useNavigate();

  // ✅ Handle wallet switching
  useEffect(() => {
    const handleAccountChange = async (newPubkey) => {
      const pubkeyStr = newPubkey?.toString?.();
      if (!pubkeyStr) return;

      console.log("🔁 Switched to new wallet:", pubkeyStr);

      try {
        const msg = "Sign to authenticate with SolPulse";
        const encoded = new TextEncoder().encode(msg);
        const { signature } = await window.solana.signMessage(encoded, "utf8");

        const loginResponse = await phantomLogin({
          phantomPublicKey: pubkeyStr,
          signature: btoa(String.fromCharCode(...signature)), 
          message: msg,
        });

        setPhantomPubkey(pubkeyStr);
        setConnectedKey(pubkeyStr);
        toast.success("Switched wallet and re-authenticated.");
        onNext(pubkeyStr);
      } catch (err) {
        toast.error("Wallet switch login failed.");
        console.error("🔁 Wallet switch error:", err);
      }
    };

    if (window.solana) {
      window.solana.on("accountChanged", handleAccountChange);
    }

    return () => {
      if (window.solana?.removeListener) {
        window.solana.removeListener("accountChanged", handleAccountChange);
      }
    };
  }, []);

  // ✅ Initial connect logic
// ✅ Initial connect logic
const handlePhantomConnect = async () => {
  if (!window.solana || !window.solana.isPhantom) {
    toast.error("Phantom not detected. Install Phantom Wallet.");
    return;
  }



  try {
    setLoading(true);

    // 1️⃣  Connect Phantom
    const response       = await window.solana.connect({ onlyIfTrusted: false });
    const freshPublicKey = response.publicKey.toString();

    // 2️⃣  Same key?  Nothing to do.
    if (freshPublicKey === connectedKey) {
      toast.success("Wallet connected!");
      onNext();
      return;                       // ← you were missing this
    }

    // 3️⃣  Sign   (re‑auth every key change)
    const msg      = "Sign to authenticate with SolPulse";
    const encoded  = new TextEncoder().encode(msg);
    const { signature } = await window.solana.signMessage(encoded, "utf8");

    await phantomLogin({
      phantomPublicKey : freshPublicKey,
      signature        : btoa(String.fromCharCode(...signature)), 
      message          : msg,
    });

    // 4️⃣  Does user already exist?
    // 🔐  4️⃣  Does this wallet already have an account?
    const userCheck = await checkUserExists({ phantomPublicKey: freshPublicKey });

    if (userCheck.exists) {
      const { twoFARequired } = userCheck;
      if (twoFARequired) {
        navigate(`/verify-2fa?userId=${freshPublicKey}`);
        return;
      }

      // The backend will set HttpOnly cookies on successful login.
      // Do not persist access/refresh tokens on the client. Remove any
      // leftover tokens to prevent Authorization headers being attached.
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");

      toast.success("🔓 Welcome back!");
      navigate("/app");
      return;
    }

    // 5️⃣  New wallet → move to next onboarding step
    toast.success("Connected!");
    setPhantomPubkey(freshPublicKey);
    setConnectedKey(freshPublicKey);
    onNext();
  } catch (err) {
    if (err?.message?.includes("User rejected")) {
      toast.warning("User rejected wallet connection.");
    } else {
      toast.error("Phantom login failed.");
      console.error("❌ Wallet connect error:", err);
    }
  } finally {
    setLoading(false);
  }
};


  return (
    <motion.div
      className="flex flex-col items-center text-center gap-6 p-8 rounded-xl bg-zinc-900/50 border border-zinc-800 backdrop-blur"
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-cyan-400 to-fuchsia-500 bg-clip-text text-transparent">
        SNIPE AND SELL TOKENS
      </h2>
      <h3 className="text-2xl font-bold text-white">
        AT{" "}
        <span className="bg-yellow-400/20 text-yellow-300 px-2 py-1 rounded-lg shadow">
          LIGHTNING SPEED
        </span>
      </h3>

      <p className="text-zinc-400 text-sm">
        Connect to start trading{" "}
        <span className="text-emerald-400 font-medium">SOL</span> now
      </p>

      <button
        onClick={handlePhantomConnect}
        disabled={loading}
        className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl transition-all border-2 border-purple-300/40 shadow-md"
      >
        {loading ? "Connecting..." : "Connect Phantom Wallet"}
      </button>

      {connectedKey && (
        <p className="text-sm text-green-400 font-mono">
          Connected with {connectedKey.slice(0, 5)}...{connectedKey.slice(-4)}
        </p>
      )}
    </motion.div>
  );
}
