import React, { useState } from "react";
import { toast } from "sonner";
import { resendConfirmationEmail } from "../../utils/auth";

const ConfirmEmail = ({ user }) => {
  const [resendCount, setResendCount] = useState(0);
  const [nextAvailable, setNextAvailable] = useState(null); // timestamp

  const handleResend = async () => {
    if (nextAvailable && nextAvailable > Date.now()) return;

    const email = localStorage.getItem("signupEmail");
    if (!email) {
    toast.error("No signup email found.");
    return;
    }
    const res = await resendConfirmationEmail(email);
    if (res) {
      toast.success("Confirmation email resent.");
      setResendCount(c => c + 1);
      setNextAvailable(Date.now() + 5 * 60 * 1000); // 5 min cooldown
    } else {
      toast.error("Failed to resend. Try again later.");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="bg-zinc-800 p-6 rounded-lg w-full max-w-md text-center">
        <h2 className="text-2xl font-bold mb-4">Confirm Your Email</h2>
        <p className="mb-4">
          We’ve sent a confirmation link to <span className="text-purple-300 font-medium">{localStorage.getItem("signupEmail")}</span>. 
          Please check your inbox and click the link to verify your account.
        </p>
        <p className="text-zinc-400 text-sm mb-4">
          Once confirmed, you’ll be able to log in and access your account.
        </p>

        {resendCount < 3 && (
          <button
            onClick={handleResend}
            disabled={nextAvailable && nextAvailable > Date.now()}
            className="text-purple-400 underline hover:text-purple-300"
          >
            Didn’t get the email? Resend
          </button>
        )}

        {nextAvailable && nextAvailable > Date.now() && (
          <p className="text-xs text-zinc-400 mt-2">
            You can resend again in {Math.ceil((nextAvailable - Date.now()) / 60000)} min
          </p>
        )}

        {resendCount >= 3 && (
          <p className="text-xs text-zinc-400 mt-2">
            You’ve reached the maximum resend attempts.
          </p>
        )}
      </div>
    </div>
  );
};

export default ConfirmEmail;
