import React, { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { verify2FALogin } from "@/utils/2fa";
import { toast } from "sonner";

const SUPPORT_EMAIL = "support@yourapp.com";

const Verify2FA = () => {
  const [params] = useSearchParams();
  const userId = params.get("userId");
  const [failures, setFailures] = useState(0);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const storedFailures = parseInt(localStorage.getItem("twoFAFailures")) || 0;
    setFailures(storedFailures);
  }, []);

  const handleVerify = async () => {
    if (!token) {
      toast.error("Enter your 6-digit code or backup code.");
      return;
    }

    setLoading(true);
    const data = await verify2FALogin(userId, token);
    setLoading(false);

    // When the backend verifies the 2FA code it will set cookies automatically.
    // We no longer persist tokens client‑side.  Treat any truthy response without error as success.
    if (data && !data.error) {
      localStorage.removeItem("twoFAFailures");
      toast.success("2FA verified. Welcome!");
      navigate("/app");
    } else {
      const newFailures = failures + 1;
      setFailures(newFailures);
      localStorage.setItem("twoFAFailures", newFailures);

      if (newFailures >= 5) {
        toast.error(
          `Too many failed attempts. Please contact ${SUPPORT_EMAIL} to recover your account.`
        );
        localStorage.removeItem("twoFAFailures");
        navigate("/login");
      } else {
        toast.error(`Invalid code. Attempts left: ${5 - newFailures}`);
      }
    }
  };

  if (!userId) {
    return (
      <div className="p-6 text-red-400">
        Missing userId in URL. Cannot verify 2FA.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-6">
      <div className="bg-zinc-800 p-6 rounded-xl shadow-xl w-full max-w-md">
        <h2 className="text-2xl font-bold mb-4">Two-Factor Authentication</h2>
        <p className="text-sm text-zinc-400 mb-4">
          Enter the <span className="text-emerald-400 font-semibold">6-digit code</span> from your <span className="text-emerald-400 font-semibold">Authenticator app</span>, <br />
          or one of your <span className="text-emerald-400 font-semibold">backup recovery codes</span> to continue.
        </p>
        <input
          type="text"
          maxLength="32"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="w-full p-3 rounded text-white mb-4"
          placeholder="123456 or backup code"
        />
        <button
          onClick={handleVerify}
          disabled={loading}
          className="w-full bg-emerald-600 text-white p-3 rounded hover:bg-emerald-700 transition"
        >
          {loading ? "Verifying…" : "Verify & Continue"}
        </button>
        <button
          onClick={() => navigate("/login")}
          className="w-full mt-3 text-sm text-zinc-400 hover:text-zinc-200 underline transition"
        >
          Cancel & Return to Login
        </button>
      </div>
    </div>
  );
};

export default Verify2FA;
