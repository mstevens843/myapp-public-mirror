import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import { phantomLogin } from "../../utils/authWallet";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function ConnectWalletStep({ onNext, setPhantomPubkey }) {
  const { signMessage } = useWallet(); // keep adapter handy (not strictly needed with window.solana)
  const [loading, setLoading] = useState(false);
  const [connectedKey, setConnectedKey] = useState(null);
  const navigate = useNavigate();

// ConnectWalletStep.jsx

// helper: Uint8Array → base64
function u8ToB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

const signAndLogin = async (pubkeyStr) => {
  const msg = "Sign to authenticate with SolPulse";
  const encoded = new TextEncoder().encode(msg);

  if (!window.solana?.signMessage) {
    console.error("🛑 window.solana.signMessage not available");
    toast.error("Your wallet doesn’t support message signing.");
    return;
  }

  let signed;
  // ✅ Try legacy Phantom signature first, then the new options style
  try {
    signed = await window.solana.signMessage(encoded, "utf8");
  } catch (e1) {
    try {
      signed = await window.solana.signMessage(encoded, { display: "utf8" });
    } catch (e2) {
      console.error("🛑 signMessage failed (both styles):", { e1, e2 });
      toast.error("Wallet refused to sign the message.");
      return;
    }
  }

  if (!signed || !(signed.signature instanceof Uint8Array)) {
    console.error("🛑 signMessage returned unexpected payload:", signed);
    toast.error("Wallet didn’t return a valid signature.");
    return;
  }

  const payload = {
    phantomPublicKey: pubkeyStr,
    signature: u8ToB64(signed.signature),
    message: msg,
  };

  console.log("🔐 /auth/phantom payload keys:", Object.keys(payload));

  const loginResponse = await phantomLogin(payload);

  if (!loginResponse) {
    toast.error("Phantom login failed.");
    return;
  }

  if (loginResponse.userExists) {
    if (loginResponse.twoFARequired) {
      toast.success("2FA required. Check your authenticator.");
      navigate(`/verify-2fa?userId=${loginResponse.userId}`);
      return;
    }
    toast.success("🔓 Welcome back!");
    navigate("/app");
    return;
  }

  setPhantomPubkey(pubkeyStr);
  toast.success("Connected! Let’s create your vault.");
  onNext(pubkeyStr);
}




  // Handle wallet switching
  useEffect(() => {
    const handleAccountChange = async (newPubkey) => {
      const pubkeyStr = newPubkey?.toString?.();
      if (!pubkeyStr) return;

      try {
        setConnectedKey(pubkeyStr);
        await signAndLogin(pubkeyStr);
      } catch (err) {
        const rejected = err?.message?.toLowerCase?.().includes("reject");
        toast[rejected ? "warning" : "error"](rejected ? "Signature rejected." : "Wallet switch login failed.");
        console.error("🔁 Wallet switch error:", err);
      }
    };

    if (window.solana?.on) {
      window.solana.on("accountChanged", handleAccountChange);
    }
    return () => {
      if (window.solana?.removeListener) {
        window.solana.removeListener("accountChanged", handleAccountChange);
      }
    };
  }, []);

  // Initial connect
  const handlePhantomConnect = async () => {
    if (!window.solana || !window.solana.isPhantom) {
      toast.error("Phantom not detected. Install Phantom Wallet.");
      return;
    }

    try {
      setLoading(true);

      // Connect
      const response = await window.solana.connect({ onlyIfTrusted: false });
      const freshPublicKey = response.publicKey.toString();
      setConnectedKey(freshPublicKey);

      // Always sign + login so the server decides routing (don’t early-return)
      await signAndLogin(freshPublicKey);
    } catch (err) {
      const rejected = err?.message?.toLowerCase?.().includes("reject");
      toast[rejected ? "warning" : "error"](rejected ? "User rejected wallet connection." : "Phantom login failed.");
      console.error("❌ Wallet connect error:", err);
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
