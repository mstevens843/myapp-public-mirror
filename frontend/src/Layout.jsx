import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  CircleDot,
  RefreshCw,
  LayoutDashboard,
  Star,
  FolderOpen,
  Mail,
  Briefcase,
  CreditCard,
  Settings as SettingsIcon,
  BarChart3,
  Bot,
  Timer,
} from "lucide-react";
import logo from "@/assets/solpulse-logo.png";
import AccountMenu from "@/components/Dashboard/Account/AccountMenu";
import WhatsNew from "./WhatsNew";

/* 🔐 Global Arm chip helpers */
import { toast } from "sonner";
import {
  getArmStatus,
  extendEncryptedWallet,
  disarmEncryptedWallet,
  formatCountdown,
} from "@/utils/encryptedWalletSession";
import { useUser } from "@/contexts/UserProvider";

const PRE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  // Destructure additional fields from useUser: wallets (with isProtected flags) and
  // hasGlobalPassphrase so we can determine when to show the Arm chip.
  const { activeWalletId, wallets = [], hasGlobalPassphrase } = useUser(); // ← get active wallet and wallet list from context

  // Determine whether the active wallet has a passphrase or is protected.  We
  // combine information from the wallet list and a global passphrase.  Only
  // if one of these is true should we show the floating Arm chip.  Without
  // protection there is nothing to arm and the button should be hidden.
  const activeWalletInfo = wallets?.find((w) => w.id === activeWalletId);
  // Consider several potential flags: hasPassphrase (boolean), explicit
  // passphraseHash, or isProtected; any truthy value implies protection.
  const activeWalletHasPass = !!(
    activeWalletInfo?.hasPassphrase ||
    (activeWalletInfo?.passphraseHash !== null && activeWalletInfo?.passphraseHash !== undefined) ||
    activeWalletInfo?.isProtected
  );
  const shouldShowArmChip = activeWalletHasPass || hasGlobalPassphrase;

  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem("activeTab") || "app";
  });

  const [runningBots, setRunningBots] = useState([]);
  const [autoRestart, setAutoRestart] = useState(() => {
    try {
      const stored = localStorage.getItem("autoRestart");
      return stored ? JSON.parse(stored) : false;
    } catch {
      return false;
    }
  });

  const [armStatus, setArmStatus] = useState({ armed: false, msLeft: 0 });
  const [warned, setWarned] = useState(false);
  const [extendBusy, setExtendBusy] = useState(false);
  const [disarmBusy, setDisarmBusy] = useState(false);

  const running = runningBots.length > 0;

  useEffect(() => {
    const tabFromUrl = location.pathname.split("/").pop();
    setActiveTab(tabFromUrl || "app");
  }, [location.pathname]);

  const handleTabChange = (tabName) => {
    setActiveTab(tabName);
    navigate(`/${tabName}`);
  };

  useEffect(() => {
    localStorage.setItem("activeTab", activeTab);
  }, [activeTab]);

  useEffect(() => {
    const storedTab = localStorage.getItem("activeTab");
    if (storedTab) setActiveTab(storedTab);
  }, []);

  /* 🔁 Poll arm status every 20s */
  useEffect(() => {
    let timer;
    async function poll() {
      try {
        if (activeWalletId) {
          const s = await getArmStatus(activeWalletId);
          setArmStatus({ armed: !!s.armed, msLeft: s.msLeft || 0 });
          if (!s.armed) setWarned(false);
        }
      } catch {
        setArmStatus({ armed: false, msLeft: 0 });
        setWarned(false);
      } finally {
        timer = setTimeout(poll, 20000);
      }
    }
    if (activeWalletId) poll();
    return () => timer && clearTimeout(timer);
  }, [activeWalletId]);

  /* ⏱️ Local 1s countdown between polls */
  useEffect(() => {
    if (!armStatus.armed || armStatus.msLeft <= 0) return;
    const id = setInterval(() => {
      setArmStatus((prev) => {
        const next = Math.max(0, (prev.msLeft || 0) - 1000);
        return { ...prev, msLeft: next };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [armStatus.armed]);

  /* ⏳ Pre-expiry toast at T-15m */
  useEffect(() => {
    if (!armStatus.armed) return;
    if (!warned && armStatus.msLeft > 0 && armStatus.msLeft <= PRE_EXPIRY_MS) {
      setWarned(true);
      toast.message("⏳ Session ends in ~15 minutes", {
        description: "Extend now to keep automation armed.",
        action: {
          label: "Extend +2h",
          onClick: () => handleExtend(120),
        },
      });
    }
  }, [armStatus.armed, armStatus.msLeft, warned]);

  /* 🔘 Global handlers */
  const handleExtend = async (minutes = 120) => {
    if (!activeWalletId) return;
    setExtendBusy(true);
    try {
      await extendEncryptedWallet({
        walletId: activeWalletId,
        ttlMinutes: minutes,
      });
      setArmStatus((prev) => ({
        armed: true,
        msLeft: Math.max(prev.msLeft, 0) + minutes * 60 * 1000,
      }));
      toast.success(`Session extended ${minutes} minutes.`);
    } catch (e) {
      toast.error(e.message || "Failed to extend.");
    } finally {
      setExtendBusy(false);
    }
  };

  const handleDisarm = async () => {
    if (!activeWalletId) return;
    setDisarmBusy(true);
    try {
      await disarmEncryptedWallet({ walletId: activeWalletId });
      setArmStatus({ armed: false, msLeft: 0 });
      setWarned(false);
      toast.success("Automation disarmed.");
    } catch (e) {
      toast.error(e.message || "Failed to disarm.");
    } finally {
      setDisarmBusy(false);
    }
  };

  const handleArm = () => {
    // Route to Account tab so the user can open the Arm modal there
    setActiveTab("account");
    navigate(`/account`);
    toast.info("Open the Arm modal to start a secure session.");
    // (If you want auto-open: pass state or a query param and check in MyAccountTab)
    navigate('/account', { state: { openArm: true } });
  };

  const tabs = [
    { name: "app", label: "Auto Bot", icon: <Bot size={18} className="text-emerald-400" /> },
    { name: "watchlist", label: "Safety Checker", icon: <Star size={18} className="text-yellow-400" /> },
    { name: "open-trades", label: "Positions", icon: <FolderOpen size={18} className="text-cyan-400" /> },
    { name: "wallets", label: "Wallets", icon: <Briefcase size={18} className="text-orange-400" /> },
    { name: "portfolio", label: "Portfolio", icon: <BarChart3 size={18} className="text-indigo-400" /> },
    { name: "telegram", label: "Telegram", icon: <Mail size={18} className="text-pink-400" /> },
    { name: "payments", label: "Payments", icon: <CreditCard size={18} className="text-green-400" /> },
    { name: "settings", label: "Settings", icon: <SettingsIcon size={18} className="text-zinc-300" /> },
  ];

  return (
    <div className="glow-bg min-h-screen text-white">
      {/*
       * Skip link for keyboard users.  Placed at the top of the page it
       * allows screen reader and keyboard users to bypass the navigation
       * elements and jump straight to the main content.  The link is
       * visually hidden until it receives focus.
       */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only absolute top-0 left-0 m-2 px-3 py-2 bg-emerald-600 text-white rounded"
      >
        Skip to main content
      </a>

      <div className="app-container">
        {/* Header */}
        <div className="flex items-center mb-4">
          <img
            src={logo}
            alt="SolPulse Logo"
            className="w-16 h-16 object-contain shrink-0 -mb-3"
          />
          <h1 className="text-2xl font-semibold text-transparent bg-clip-text bg-gradient-to-r from-violet-300 via-fuchsia-400 to-rose-500 ml-0 leading-none relative top-[10px] right-[8px]">
            SolPulse Bot Dashboard
          </h1>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-2 overflow-x-auto whitespace-nowrap">
          {tabs.map((tab) => (
            <button
              key={tab.name}
              onClick={() => handleTabChange(tab.name)}
              className={`flex items-center gap-2 text-sm px-4 py-2 rounded ${
                activeTab === tab.name
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-700 text-white"
              } hover:shadow-emerald-600/20 transition`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Account Menu & What's New link */}
        <div className="fixed top-4 right-6 z-50 flex items-center gap-3">
          {/* What's New button opens the dismissible release notes panel.  It
              dispatches a custom event that our WhatsNew component listens
              for.  Styling keeps it subtle in the header. */}
          <button
            onClick={() => window.dispatchEvent(new Event('openWhatsNew'))}
            className="text-xs text-emerald-300 underline hover:text-emerald-100"
          >
            What's New?
          </button>
          <AccountMenu onAccountClick={() => handleTabChange("account")} />
        </div>

        {/* Active Bots Banner */}
        {running && (
          <div className="active-banner flex items-center justify-between rounded-lg border border-emerald-500/50 bg-emerald-600/10 px-3 py-1.5 shadow-[0_0_12px_0_rgba(34,197,94,0.25)] text-sm mb-4">
            <div className="flex items-center gap-2">
              <CircleDot size={14} className="text-emerald-400 animate-pulse" />
              <span className="text-emerald-200 font-medium">Active Bots:</span>
              <span className="font-semibold text-white">
                {runningBots.map((b) => `${b.mode}(${b.botId.slice(-4)})`).join(", ")}
              </span>
            </div>

            {autoRestart && (
              <span className="flex items-center gap-[2px] text-xs font-semibold text-amber-300 bg-amber-500/15 px-2 py-[2px] rounded-full">
                <RefreshCw size={12} className="animate-spin-slow" />
                Auto-Restart
              </span>
            )}
          </div>
        )}

        {/* Page Content */}
        <div id="main-content">
          <Outlet />
        </div>
      </div>

      {/* 🔘 Global Floating Arm Chip */}
      {activeWalletId && shouldShowArmChip ? (
        <div className="fixed bottom-6 left-6 z-[9998]">
          {!armStatus.armed ? (
            <button
              onClick={handleArm}
              className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-emerald-700"
              title="Arm-to-Trade"
            >
              <Timer size={16} />
              Arm
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-full bg-emerald-700/90 px-3 py-2 text-sm text-white shadow-lg">
              <Timer size={16} />
              <span className="font-mono">{formatCountdown(armStatus.msLeft)}</span>
              <button
                onClick={() => handleExtend(120)}
                disabled={extendBusy}
                className="rounded-full bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-50"
                title="Extend +2h"
              >
                +2h
              </button>
              <button
                onClick={handleDisarm}
                disabled={disarmBusy}
                className="rounded-full bg-red-600 px-2 py-1 text-xs hover:bg-red-700 disabled:opacity-50"
                title="Disarm"
              >
                Disarm
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* What's New modal – always include at root so it can
          overlay any page.  It self‑manages its visibility based on
          localStorage and will show only after a version bump or when
          triggered via the header link. */}
      <WhatsNew />
    </div>
  );
}
