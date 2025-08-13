/**
 * frontend/src/main.jsx
 * ------------------------------------------------------------------
 * App shell moved out of utils/authFetch.js
 * - Ensures CSRF bootstrap runs once at startup
 * - Mounts Supabase auth handler for email-link redirect
 * - Wraps the app in ErrorBoundary and global providers
 * - Keeps your existing routes and tabs
 */

import { Buffer } from "buffer";
import process from "process";
if (!window.Buffer) window.Buffer = Buffer;
if (!window.process) window.process = process;

import React, { StrictMode, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { Toaster } from "sonner";

/* 🔐 CSRF bootstrap */
import useCsrfBootstrap from "@/hooks/useCsrfBootstrap";

/* Supabase */
import { supabase } from "./lib/supabase";

/* Dashboard / Pages */
import LandingPage from "./components/Dashboard/LandingPage";
import App from "./AppWithFlags"; // Feature-flag aware app
import WalletsTab from "./components/Dashboard/WalletsTab";
import PaymentsTab from "./components/Dashboard/PaymentsTab";
import MyAccountTab from "./components/Dashboard/MyAccountTab";
import SettingsPanel from "./components/Dashboard/SettingsPanel";
import TelegramTab from "./components/Dashboard/TelegramTab";
import Watchlist from "./components/Dashboard/Watchlist";
import OpenTradesTab from "./components/Dashboard/OpenTradesTab";
import ChartPanelRoute from "./components/Tables_Charts/ChartPanelRoute";
import PaymentSuccess from "./components/Dashboard/PaymentsTab/PaymentSuccess";
import PaymentCancel from "./components/Dashboard/PaymentsTab/PaymentCancel";

/* Auth */
import Verify2FA from "./components/Auth/verify2fa";
import ForgotPassword from "@/components/Auth/ForgotPassword";
import ResetPassword from "@/components/Auth/ResetPassword";
import ConfirmEmail from "./components/Auth/ConfirmEmail";
import EmailConfirmed from "./components/Auth/EmailConfirmed";

/* Legal */
import TermsOfService from "./components/AuthWallet/TermsOfService";
import PrivacyPolicy from "./components/AuthWallet/PrivacyPolicy";

/* Layout & Providers */
import Layout from "./Layout";
import { SupabaseSessionProvider } from "./contexts/SupbaseSessionContext";
import { PrefsProvider } from "./contexts/prefsContext";
import { UserProvider } from "./contexts/UserProvider";
import { UserPrefsProvider } from "@/contexts/UserPrefsContext";
import ErrorBoundary from "./components/ErrorBoundary";

/* UI / Styles */
import "./styles/dashboard.css";
import "./styles/tailwind.css";

/* Solana Wallet */
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

/** Runs CSRF bootstrap once. Renders nothing. */
function BootstrapGuards() {
  useCsrfBootstrap();
  return null;
}

/** Supabase auth handler for email-link sign-in → redirect to confirmation screen. */
function AuthHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" && localStorage.getItem("awaitingEmailConfirmation")) {
        // eslint-disable-next-line no-console
        console.log("✅ Supabase SIGNED_IN via email link");
        localStorage.removeItem("awaitingEmailConfirmation");
        navigate("/email-confirmed");
      }
    });
    return () => subscription.unsubscribe();
  }, [navigate]);
  return null;
}

/* Validate Solana RPC endpoint early to fail fast in misconfig */
const endpoint = import.meta.env.VITE_SOLANA_RPC_URL;
if (!endpoint || !endpoint.startsWith("http")) {
  throw new Error("❌ Invalid SOLANA RPC URL: " + endpoint);
}
const wallets = [ new PhantomWalletAdapter() ];

ReactDOM.createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <SupabaseSessionProvider>
        <PrefsProvider>
          <UserProvider>
            <UserPrefsProvider>
              <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
                <WalletProvider wallets={wallets} autoConnect>
                  <WalletModalProvider>
                    <ErrorBoundary>
                      {/* 🔐 Bootstrap guards and auth side-effects */}
                      <BootstrapGuards />
                      <AuthHandler />

                      {/* Routes */}
                      <Routes>
                        {/* Public */}
                        <Route path="/" element={<LandingPage />} />
                        <Route path="/2fa" element={<Verify2FA />} />
                        <Route path="/forgot" element={<ForgotPassword />} />
                        <Route path="/reset" element={<ResetPassword />} />
                        <Route path="/confirm-email" element={<ConfirmEmail />} />
                        <Route path="/email-confirmed" element={<EmailConfirmed />} />
                        <Route path="/payment-success" element={<PaymentSuccess />} />
                        <Route path="/payment-cancel" element={<PaymentCancel />} />
                        <Route path="/terms" element={<TermsOfService />} />
                        <Route path="/privacy" element={<PrivacyPolicy />} />

                        {/* App shell + tabs */}
                        <Route element={<Layout />}>
                          <Route path="app" element={<App />} />
                          <Route path="wallets" element={<WalletsTab />} />
                          <Route path="payments" element={<PaymentsTab />} />
                          <Route path="account" element={<MyAccountTab />} />
                          <Route path="settings" element={<SettingsPanel />} />
                          <Route path="telegram" element={<TelegramTab />} />
                          <Route path="watchlist" element={<Watchlist />} />
                          <Route path="open-trades" element={<OpenTradesTab />} />
                          <Route path="portfolio" element={<ChartPanelRoute />} />
                        </Route>

                        {/* 404 → home */}
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>

                      {/* Global toaster */}
                      <Toaster position="top-right" richColors />
                    </ErrorBoundary>
                  </WalletModalProvider>
                </WalletProvider>
              </ConnectionProvider>
            </UserPrefsProvider>
          </UserProvider>
        </PrefsProvider>
      </SupabaseSessionProvider>
    </BrowserRouter>
  </StrictMode>
);

/* Notes:
 * - No need to call setTokenGetter(() => null) here because authFetch defaults to cookie-only.
 * - If you want verbose network logs at runtime: window.__AUTHFETCH_DEBUG__ = true
 */
