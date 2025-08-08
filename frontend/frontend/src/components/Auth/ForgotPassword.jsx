import React, { useState } from "react";
import { requestPasswordReset } from "@/utils/auth";
import { toast } from "sonner";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const data = await requestPasswordReset(email);
    if (data?.message) {
      toast.success(data.message);
      setSent(true);
    } else {
      toast.error("Something went wrong.");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4">
      <h2 className="text-3xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-emerald-400 bg-clip-text text-transparent animate-pulse">
        🔒 Forgot Password
      </h2>
      <p className="text-zinc-400 mb-8 text-center max-w-md">
        {sent
          ? "If your email exists, a reset link has been sent. Check your inbox!"
          : "Enter your email to receive a password reset link."}
      </p>

      {!sent && (
        <form onSubmit={handleSubmit} className="bg-zinc-800 p-6 rounded-lg w-full max-w-md shadow-xl border border-purple-600/20">
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 mb-4 rounded bg-zinc-900 border border-zinc-700 text-white placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
            required
          />
          <button
            type="submit"
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded transition-all"
          >
            Send Reset Link
          </button>
        </form>
      )}

      {sent && (
        <div className="relative w-16 h-16 mt-6">
          <div className="absolute inset-0 rounded-full border-4 border-purple-500 animate-spin-slow"></div>
          <div className="absolute inset-2 rounded-full border-4 border-emerald-500 animate-ping"></div>
          <div className="absolute inset-4 rounded-full bg-purple-600"></div>
        </div>
      )}
    </div>
  );
};

export default ForgotPassword;
