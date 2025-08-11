import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { supabase } from "./lib/supabase";

import LandingPage from "./components/Dashboard/LandingPage";
// Use the wrapper component that includes the feature flag provider
import App from "./AppWithFlags";
import WalletsTab from "./components/Dashboard/WalletsTab";
import PaymentsTab from "./components/Dashboard/PaymentsTab";
import MyAccountTab from "./components/Dashboard/MyAccountTab";
import SettingsPanel from "./components/Dashboard/SettingsPanel";
import TelegramTab from "./components/Dashboard/TelegramTab";
import Watchlist from "./components/Dashboard/Watchlist";
import OpenTradesTab from "./components/Dashboard/OpenTradesTab";
import Verify2FA from "./components/Auth/verify2fa";
import ForgotPassword from "@/components/Auth/ForgotPassword";
import ResetPassword from "@/components/Auth/ResetPassword";
import PaymentSuccess from "./components/Dashboard/PaymentsTab/PaymentSuccess";
import PaymentCancel from "./components/Dashboard/PaymentsTab/PaymentCancel";
import ConfirmEmail from "./components/Auth/ConfirmEmail";
import Layout from "./Layout";
import EmailConfirmed from "./components/Auth/EmailConfirmed";
import { SupabaseSessionProvider } from "./contexts/SupbaseSessionContext";
import { PrefsProvider } from "./contexts/prefsContext"; 
import { UserProvider } from "./contexts/UserProvider";      
import { UserPrefsProvider } from "@/contexts/UserPrefsContext";
import HistoryPanelRoute from "./components/Tables_Charts/HistoryPanel"; // (unused here?)
import "./styles/dashboard.css";
import "./styles/tailwind.css";
import { Toaster } from "sonner";
import TermsOfService from "./components/AuthWallet/TermsOfService";
import PrivacyPolicy from "./components/AuthWallet/PrivacyPolicy";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import ChartPanelRoute from "./components/Tables_Charts/ChartPanelRoute";
import ErrorBoundary from "./components/ErrorBoundary";

function AuthHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" && localStorage.getItem("awaitingEmailConfirmation")) {
        console.log("✅ Supabase SIGNED_IN via email link");
        localStorage.removeItem("awaitingEmailConfirmation");
        navigate("/email-confirmed");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return null;
}

const endpoint = import.meta.env.VITE_SOLANA_RPC_URL;
if (!endpoint || !endpoint.startsWith("http")) {
  throw new Error("❌ Invalid SOLANA RPC URL: " + endpoint);
}

const wallets = [ new PhantomWalletAdapter() ];

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <SupabaseSessionProvider>
      <PrefsProvider>
        <UserProvider>
          <UserPrefsProvider>
            <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
              <WalletProvider wallets={wallets} autoConnect={true}>
                <WalletModalProvider>
                  <ErrorBoundary>
                    <Routes>
                      <Route path="/" element={<LandingPage />} />
  <Route path="/2fa" element={<Verify2FA />} />
  <Route path="/forgot" element={<ForgotPassword />} />
  <Route path="/reset" element={<ResetPassword />} />
  <Route path="/payment-success" element={<PaymentSuccess />} />
  <Route path="/payment-cancel" element={<PaymentCancel />} />
  <Route path="/confirm-email" element={<ConfirmEmail />} />
  <Route path="/email-confirmed" element={<EmailConfirmed />} />
  <Route path="/terms" element={<TermsOfService />} />
  <Route path="/privacy" element={<PrivacyPolicy />} />

  {/* App shell + tabs */}
  <Route element={<Layout />}>
    {/* Optional: default to /app when inside the shell */}
    <Route index element={<App />} />
    <Route path="app" element={<App />} />
    <Route path="wallets" element={<WalletsTab />} />
    <Route path="payments" element={<PaymentsTab />} />
    <Route path="account" element={<MyAccountTab />} />
    <Route path="settings" element={<SettingsPanel />} />
    <Route path="telegram" element={<TelegramTab />} />
    <Route path="watchlist" element={<Watchlist />} />
    <Route path="open-trades" element={<OpenTradesTab />} />
     <Route path="portfolio" element={<ChartPanelRoute/>} />
    {/* If you actually want a Portfolio tab, add its route: */}
    {/* <Route path="portfolio" element={<PortfolioTab />} /> */}
  </Route>
</Routes>
                    {/* Global Toaster for Sonner */}
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
);
