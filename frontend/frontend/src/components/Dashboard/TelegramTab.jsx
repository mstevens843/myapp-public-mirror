/**
 * 📨 TelegramTab.jsx – v2.2
 *
 * Solana Bot Dashboard › Telegram Alerts
 * ------------------------------------------------------------
 * • Connect your dashboard to a Telegram chat
 * • Fire off a quick test alert to confirm connectivity
 * • Fine‑tune which in‑app events should ping you
 *
 * UX tweaks in this version:
 * • Toggles are visible but disabled until Telegram is connected
 * • After first connect we pull fresh prefs so defaults (Trade, Orders,
 *   TP/SL, AutoBots, Scheduled) start ON, Safety OFF
 * • Toast + state resets on disconnect
 */

import React, { useEffect, useState } from "react";
import {
  sendTelegramTest,
  setTelegramChatId,
  getTelegramChatId,
  getTelegramPreferences,
  setTelegramPreferences,
  disconnectTelegram,
} from "@/utils/telegramApi";
import { toast } from "sonner";
import {
  PlugZap,
  Send,
  Loader2,
  ShieldAlert,
  Bell,
  XCircle,
  CheckCircle2,
  Save,
  ClipboardList,
  CalendarClock,
  ShieldCheck,
} from "lucide-react";
import * as Switch from "@radix-ui/react-switch";

/* ----- GlowButton helper --------------------------------------- */
const GlowButton = ({
  children,
  className = "",
  disabled,
  onClick,
  variant = "primary",
}) => {
  const variants = {
    primary:
      "bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500 text-white",
    secondary:
      "bg-cyan-600 hover:bg-cyan-700 focus:ring-cyan-500 text-white",
    danger: "bg-red-600 hover:bg-red-700 focus:ring-red-500 text-white",
    muted: "bg-zinc-700 text-zinc-400 cursor-not-allowed",
  };
  const base =
    "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition shadow-md hover:shadow-emerald-600/20 focus:outline-none focus:ring-2 focus:ring-offset-2";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${
        disabled ? variants.muted : variants[variant]
      } ${className}`}
    >
      {children}
    </button>
  );
};

/* ----- Component ------------------------------------------------ */
export default function TelegramTab() {
  /* State ------------------------------------------------------ */
  const [chatId, setChatId] = useState("");
  const [connected, setConnected] = useState(false);
  const [prefs, setPrefs] = useState({
    trade: true,
    orders: true,
    tpSl: true,
    autoBots: true,
    scheduled: true,
    safety: false,
  });
  const [prefsSaved, setPrefsSaved] = useState(null); // null | true | false
  const [loading, setLoading] = useState({ test: false, connect: false });

  /* Bootstrap -------------------------------------------------- */
  useEffect(() => {
    (async () => {
      try {
        const savedId = await getTelegramChatId();
        const savedPrefs = await getTelegramPreferences();
        if (savedId) {        
          setChatId(savedId);
          setConnected(true);
        } else {
          setChatId("");
          setConnected(false);
        }
        if (savedPrefs) setPrefs(savedPrefs);
      } catch (err) {
        console.error(err);
        toast.error("Failed to load Telegram settings");
      }
    })();
  }, []);

  /* Actions ---------------------------------------------------- */
  const handleConnect = async () => {
    const trimmed = chatId.trim();
    if (!/^[1-9]\d{8,10}$/.test(trimmed)) {
      toast.error("Invalid chat ID (must be 9‑11 digits).");
      return;
    }
    setLoading((l) => ({ ...l, connect: true }));
    try {
      await setTelegramChatId(trimmed);
      setConnected(true);
      // pull defaults right after first connect
      const fresh = await getTelegramPreferences();
      if (fresh) setPrefs(fresh);
      toast.success("Telegram connected 🎉");
    } catch {
      toast.error("Failed to connect");
    } finally {
      setLoading((l) => ({ ...l, connect: false }));
    }
  };

  const handleTestAlert = async () => {
    setLoading((l) => ({ ...l, test: true }));
    try {
      await sendTelegramTest();
      toast.success("Test alert sent 🚀");
    } catch {
      toast.error("Unable to send test alert");
    } finally {
      setLoading((l) => ({ ...l, test: false }));
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnectTelegram();
      setChatId("");
      setConnected(false);
      setPrefsSaved(null);
      toast("Disconnected", { icon: "🔌" });
    } catch {
      toast.error("Could not disconnect");
    }
  };

  const handleSavePrefs = async () => {
    try {
      await setTelegramPreferences(prefs);
      setPrefsSaved(true);
      toast.success("Preferences saved");
    } catch {
      setPrefsSaved(false);
      toast.error("Failed to save preferences");
    }
  };

  /* Render ----------------------------------------------------- */
  return (
    <section className="container mx-auto p-6 space-y-8 text-white">
      {/* banner */}
      <div className="bg-emerald-600 text-black p-4 rounded-lg mb-6 flex items-center gap-3">
        <PlugZap size={18} />
        <span className="text-sm">
          <strong>Note:</strong> Configure your Telegram to get instant trade &
          safety alerts from SolPulse.
        </span>
      </div>

      {/* header */}
      <header>
        <h2 className="text-3xl font-bold tracking-tight">
          Telegram Integration
        </h2>
        {connected && (
          <p className="mt-1 flex items-center gap-1 text-green-400">
            <CheckCircle2 size={16} /> Connected
          </p>
        )}
      </header>

      {/* connect block */}
      <div className="bg-zinc-800 p-4 rounded-lg space-y-4">
        <h3 className="text-lg font-semibold mb-2">Connect Telegram</h3>
        <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-end gap-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="chatId"
              className="text-sm font-medium text-zinc-300"
            >
              Telegram Chat ID
            </label>
            <input
              id="chatId"
              placeholder="Enter your chat ID"
              className="w-64 px-3 py-2 rounded-md bg-zinc-900 border border-zinc-700 placeholder:text-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              disabled={connected}
            />
          </div>

          <GlowButton
            onClick={handleConnect}
            disabled={connected || loading.connect}
            variant="secondary"
          >
            {loading.connect ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Connecting…
              </>
            ) : (
              <>
                <PlugZap size={16} /> Connect
              </>
            )}
          </GlowButton>

          <GlowButton
            onClick={handleTestAlert}
            disabled={!connected || loading.test}
            variant="primary"
          >
            {loading.test ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Sending…
              </>
            ) : (
              <>
                <Send size={16} /> Test Alert
              </>
            )}
          </GlowButton>

          {connected && (
            <GlowButton onClick={handleDisconnect} variant="danger">
              <XCircle size={16} /> Disconnect
            </GlowButton>
          )}
        </div>
      </div>

        {/* ---------- preference toggles ---------- */}
      <div className="bg-zinc-800 p-4 rounded-lg space-y-4">
        <h3 className="text-lg font-semibold">Notification Preferences</h3>

        {[
          { key: "trade",     label: "Trade Alerts",                  icon: <Bell size={16} className="text-emerald-400" /> },
          { key: "orders",    label: "DCA/Limit Order Alerts",         icon: <ClipboardList size={16} className="text-cyan-400" /> },
          { key: "tpSl",      label: "TP/SL Alerts",                 icon: <ShieldAlert size={16} className="text-red-400" /> },
          { key: "autoBots",  label: "Auto‑Bot Strategy Alerts",     icon: <PlugZap size={16} className="text-indigo-400" /> },
          { key: "scheduled", label: "Scheduled Launch Alerts",      icon: <CalendarClock size={16} className="text-yellow-400" /> },
          { key: "safety",    label: "Safety Check Alerts",          icon: <ShieldCheck size={16} className="text-teal-400" /> },
        ].map(({ key, label, icon }) => {
          const isActive   = connected && prefs[key];   // only show ON when connected
          const isDisabled = !connected;

          return (
            <div key={key} className="flex items-center gap-3">
              <Switch.Root
                id={key}
                checked={isActive}
                onCheckedChange={(checked) =>
                  setPrefs((p) => ({ ...p, [key]: checked }))
                }
                disabled={isDisabled}
                className={`relative w-10 h-6 rounded-full border transition-colors
                  ${
                    isActive
                      ? "bg-emerald-600/80 after:translate-x-4 border-emerald-500"
                      : "bg-zinc-800 border-zinc-700"
                  }
                  ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}
                  after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5
                  after:rounded-full after:bg-white after:transition-transform`}
              />
              <label
                htmlFor={key}
                className={`flex items-center gap-1 text-sm ${
                  isDisabled ? "text-zinc-500" : ""
                }`}
              >
                {icon} {label}
                {isDisabled && (
                  <span className="text-xs ml-1">(connect to enable)</span>
                )}
              </label>
            </div>
          );
        })}

        <GlowButton
          onClick={handleSavePrefs}
          disabled={!connected}
          className="mt-2"
        >
          <Save size={16} /> Save Preferences
        </GlowButton>

        {prefsSaved === true && (
          <p className="text-green-400 flex items-center gap-1 text-sm mt-2">
            <CheckCircle2 size={14} /> Preferences saved
          </p>
        )}
        {prefsSaved === false && (
          <p className="text-red-400 flex items-center gap-1 text-sm mt-2">
            <ShieldAlert size={14} /> Failed to save
          </p>
        )}
      </div>
    </section>
  );
}