import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { LogIn, Eye, EyeOff, Loader2 } from "lucide-react";
import { registerUser, loginUser } from "../../utils/auth";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export default function AuthModal({ open, setOpen }) {
  const [mode, setMode] = useState("login");
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    const username = e.target.username?.value?.trim();
    const emailInput = e.target.email?.value?.trim();
    const password = e.target.password?.value;
    const confirmPassword = e.target.confirmPassword?.value;
    const rememberMe = e.target.rememberMe?.checked;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (mode === "signup") {
      const agreedToTerms = e.target.agreeTerms?.checked;

      if (!username || !emailInput || !password || !confirmPassword) {
        setIsSubmitting(false);
        return toast.error("All fields are required.");
      }
      if (!agreedToTerms) {
        setIsSubmitting(false);
        return toast.error("You must agree to the Terms and Privacy Policy.");
      }
      if (!emailRegex.test(emailInput)) {
        setIsSubmitting(false);
        return toast.error("Invalid email format.");
      }
      const pwRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).{6,}$/;
      if (!pwRegex.test(password)) {
        setIsSubmitting(false);
        return toast.error("Password must be at least 6 characters, with one uppercase letter, one number, and one special character.");
      }
      if (password !== confirmPassword) {
        setIsSubmitting(false);
        return toast.error("Passwords do not match.");
      }
    } else {
      if (!emailInput || !password) {
        setIsSubmitting(false);
        return toast.error("Email/Username and password are required.");
      }
    }

    let response;
    try {
      if (mode === "login") {
        const loginData = emailRegex.test(emailInput)
          ? { email: emailInput, password, rememberMe } // ← optional rememberMe
          : { username: emailInput, password, rememberMe };
        response = await loginUser(loginData);
      } else {
        const agreedToTerms = e.target.agreeTerms?.checked;
        response = await registerUser({
          username,
          email: emailInput,
          password,
          confirmPassword,
          agreedToTerms,
        });
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Something went wrong.");
    } finally {
      setIsSubmitting(false);
    }

    if (response) {
      if (response?.twoFARequired) {
        // match your router's /2fa route
        navigate(`/2fa?userId=${response.userId ?? ""}`);
        return;
      }

      // Ensure any legacy tokens are wiped (cookie-only auth)
      try {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        sessionStorage.removeItem("accessToken");
        sessionStorage.removeItem("refreshToken");
      } catch {}

      // Optionally persist activeWallet safely if backend returns it
      if (response.activeWallet) {
        const val = typeof response.activeWallet === "string"
          ? response.activeWallet
          : JSON.stringify(response.activeWallet);
        try { localStorage.setItem("activeWallet", val); } catch {}
      }

      if (mode === "signup") {
        try { localStorage.setItem("signupEmail", emailInput); } catch {}
        setOpen(false);
        navigate("/confirm-email");
      } else {
        setOpen(false); // close modal on successful login too
        navigate("/app");
      }

      toast.success(mode === "login" ? "Logged in!" : "Account created!");
    } else {
      console.error("Authentication failed.");
      toast.error("Authentication failed. Please try again.");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-40" />
        <Dialog.Content asChild>
          <motion.div
            className="fixed z-50 top-1/2 left-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-purple-500/30 bg-gradient-to-br from-zinc-900 to-zinc-950 shadow-[0_0_40px_rgba(128,0,255,0.2)] p-6"
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
          >
            {/* Header */}
            <div className="flex justify-between items-center mb-5">
              <h2 className="text-xl font-bold text-white tracking-tight">
                {mode === "login" ? "Login" : "Create Account"}
              </h2>
              <button onClick={() => setOpen(false)} className="hover:scale-105 transition">
                <X className="text-zinc-400 hover:text-white w-5 h-5" />
              </button>
            </div>

            {/* Mode Toggle */}
            <div className="flex items-center gap-2 mb-6">
              {["login", "signup"].map((m) => (
                <button
                  key={m}
                  className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all duration-200 ${
                    mode === m ? "bg-purple-600 text-white shadow-sm" : "bg-zinc-800 text-zinc-400 hover:text-white"
                  }`}
                  onClick={() => setMode(m)}
                >
                  {m === "login" ? "Login" : "Sign Up"}
                </button>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {mode === "signup" && (
                <input
                  name="username"
                  type="text"
                  placeholder="Username"
                  required
                  className="bg-zinc-900/80 border border-zinc-700 text-sm text-white placeholder-zinc-500 px-4 py-2 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                />
              )}

              {/* Email or Username (text to allow username too) */}
              <input
                name="email"
                type="text" /* was 'email' */
                placeholder="Email or Username"
                required
                autoComplete="username"
                className="bg-zinc-900/80 border border-zinc-700 text-sm text-white placeholder-zinc-500 px-4 py-2 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
              />

              {/* Password */}
              <div className="relative">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  required
                  autoComplete="current-password"
                  className="bg-zinc-900/80 border border-zinc-700 text-sm text-white placeholder-zinc-500 px-4 py-2 pr-10 rounded-md w-full focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              {mode === "signup" && (
                <>
                  <div className="relative">
                    <input
                      name="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      placeholder="Confirm Password"
                      required
                      className="bg-zinc-900/80 border border-zinc-700 text-sm text-white placeholder-zinc-500 px-4 py-2 pr-10 rounded-md w-full focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-black-400 hover:text-white"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-zinc-400 -mt-1">
                    <input type="checkbox" name="agreeTerms" className="accent-emerald-500 h-4 w-4" required defaultChecked />
                    <span>
                      By signing up, I agree to the{" "}
                      <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-white text-emerald-400">
                        Terms
                      </a>{" "}
                      &{" "}
                      <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-white text-emerald-400">
                        Privacy
                      </a>
                    </span>
                  </label>
                </>
              )}

              {mode === "login" && (
                <>
                  <label className="mt-1 flex items-center gap-2 text-sm text-zinc-400">
                    <input type="checkbox" name="rememberMe" className="accent-purple-600" />
                    Remember me
                  </label>

                  <p className="text-xs text-right -mt-1 mb-2">
                    <a href="/forgot" className="text-purple-400 underline hover:text-purple-300">
                      Forgot password?
                    </a>
                  </p>
                </>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="mt-1 w-full flex items-center justify-center gap-2 py-2.5
                           bg-purple-600 hover:bg-purple-700 disabled:opacity-60
                           text-white rounded-md text-sm font-semibold transition-all"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin w-4 h-4" />
                    {mode === "login" ? "Logging in…" : "Creating account…"}
                  </>
                ) : (
                  mode === "login" ? "Login" : "Create Account"
                )}
              </button>
            </form>

            <p className="text-xs text-center text-zinc-400 mt-5">
              {mode === "login" ? (
                <>
                  Don’t have an account?{" "}
                  <button onClick={() => setMode("signup")} className="text-purple-400 underline hover:text-purple-300">
                    Sign Up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button onClick={() => setMode("login")} className="text-purple-400 underline hover:text-purple-300">
                    Login
                  </button>
                </>
              )}
            </p>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
