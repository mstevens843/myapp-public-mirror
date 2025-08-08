import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function PaymentCancel() {
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    // Immediately show toast
    toast.error("🚫 Payment was canceled. No charges made.");

    // Spinner lasts ~1s before showing text
    const timeout = setTimeout(() => {
      setLoading(false);
    }, 1000);

    // Auto-redirect after 4s
    const redirect = setTimeout(() => {
      navigate("/app");
    }, 4000);

    return () => {
      clearTimeout(timeout);
      clearTimeout(redirect);
    };
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center h-screen text-white">
      <h1 className="text-3xl font-bold mb-4">🚫 Payment Canceled</h1>

      {loading ? (
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-red-400 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-lg">Processing cancellation…</p>
        </div>
      ) : (
        <p className="text-lg mt-2">No charges were made to your account.</p>
      )}

      <button
        className="mt-6 bg-emerald-600 px-4 py-2 rounded text-sm"
        onClick={() => navigate("/app")}
      >
        🔙 Back to Dashboard Now
      </button>

      <p className="text-sm text-gray-400 mt-4">
        You’ll be redirected automatically shortly…
      </p>
    </div>
  );
}
