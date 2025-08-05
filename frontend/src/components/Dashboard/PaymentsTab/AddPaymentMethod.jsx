// AddPaymentMethod.jsx
import React, { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { createSetupIntent } from "@/utils/payments";
import { toast } from "sonner";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLIC_KEY);

function PaymentForm({ onComplete }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const setup = await createSetupIntent();
    if (!setup?.clientSecret) {
      toast.error("Failed to initiate setup.");
      setLoading(false);
      return;
    }

    const result = await stripe.confirmCardSetup(setup.clientSecret, {
      payment_method: {
        card: elements.getElement(CardElement),
      },
    });

    setLoading(false);

    if (result.error) {
      toast.error(result.error.message || "Failed to save payment method.");
    } else {
      toast.success("Payment method saved.");
      onComplete?.();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-white p-3 rounded text-black">
        <CardElement />
      </div>
      <button
        type="submit"
        disabled={!stripe || loading}
        className="bg-emerald-500 px-4 py-2 rounded text-white text-sm"
      >
        {loading ? "Saving..." : "Save Payment Method"}
      </button>
    </form>
  );
}

export default function AddPaymentMethod({ onComplete }) {
  return (
    <Elements stripe={stripePromise}>
      <PaymentForm onComplete={onComplete} />
    </Elements>
  );
}
