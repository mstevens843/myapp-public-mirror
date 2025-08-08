import React, { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { verifyResetToken, resetPassword } from "@/utils/auth";
import { toast } from "sonner";

const ResetPassword = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token");

  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    console.log("🧭 URL token is:", token);
    if (!token) return;

    (async () => {
      console.log("🚀 Attempting to verify reset token with backend...");
      const res = await verifyResetToken(token);
      console.log("✅ verifyResetToken returned:", res);

      setValid(!!res?.message);
      setLoading(false);
    })();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log("💾 Attempting password reset...");
    if (password !== confirmPassword) {
      console.log("❌ Passwords do not match.");
      return toast.error("Passwords do not match.");
    }

    const data = await resetPassword(token, password, confirmPassword);
    console.log("🚀 resetPassword API returned:", data);

    if (data?.message) {
      toast.success("Password reset successful!");
      navigate("/");
    } else {
      toast.error(data?.error || "Reset failed. Try again.");
    }
  };

  if (!token) return <div className="p-6 text-red-400">No token provided in URL.</div>;
  if (loading) return <div className="p-6 text-zinc-400">🔍 Verifying reset token...</div>;
  if (!valid) return <div className="p-6 text-red-400">❌ Invalid or expired reset link.</div>;

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-zinc-800 p-6 rounded-lg w-full max-w-md">
        <h2 className="text-2xl font-bold mb-4">Reset Your Password</h2>
        <input
          type="password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full p-3 mb-4 rounded text-black"
          required
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full p-3 mb-4 rounded text-black"
          required
        />
        <button className="w-full bg-emerald-600 p-3 rounded hover:bg-emerald-700">
          Reset Password
        </button>
      </form>
    </div>
  );
};

export default ResetPassword;
