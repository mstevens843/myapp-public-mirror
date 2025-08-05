import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSubscriptionStatus } from "@/utils/payments";
import { toast } from "sonner";

export default function PaymentSuccess() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      toast.success("✅ Payment completed!");
      try {
        const status = await getSubscriptionStatus();
        if (status) {
          setPlan(status.plan || "free");
          setLoading(false);
          toast.info(`Plan updated to: ${status.plan}`);
        } else {
          toast.error("Failed to fetch updated plan.");
        }
      } catch (err) {
        toast.error("Error fetching subscription status.");
        console.error(err);
      }

      // Redirect back to dashboard after 4 seconds
      setTimeout(() => {
        navigate("/app");
      }, 4000);
    })();
  }, [navigate]);

  return (
    <div className="flex flex-col items-center justify-center h-screen text-white">
      <h1 className="text-3xl font-bold mb-4">🎉 Payment Successful!</h1>
      {loading ? (
        <div className="flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-lg">Updating your plan…</p>
        </div>
      ) : (
        <p className="text-lg mt-2">
          Your plan has been updated to:{" "}
          <span className="text-emerald-400 font-bold">{plan}</span>
        </p>
      )}
      <p className="text-sm text-gray-400 mt-4">
        You will be redirected to the dashboard shortly…
      </p>
    </div>
  );
}
