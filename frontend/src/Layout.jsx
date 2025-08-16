import { useEffect, useRef, useState } from "react";
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
import ArmEndModal from "./ArmEndModal";

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

/* ------------------------------- GATE ------------------------------- */
/* Only checks loading. It always calls the SAME hooks each render.    */
export default function Layout() {
  const { loading } = useUser(); // 1 hook, same every render
  if (loading) {
    return (
      <div className="glow-bg min-h-screen grid place-items-center text-white">
        <div className="text-sm opacity-80">Loading…</div>
      </div>
    );
  }
  return <LayoutInner />; // mount the real layout only after loaded
}

/* ------------------------------- INNER ------------------------------ */
/* Never early-returns; hook order/count is stable across renders.     */
function LayoutInner() {
  const navigate = useNavigate();
  const location = useLocation();

  // Pull everything we need from UserProvider
  const {
    activeWalletId: idFromCtx,
    activeWallet,
    wallets = [],
    hasGlobalPassphrase,
    // NOTE: do NOT early-return on loading here—gate handles it.
  } = useUser();

  const activeWalletId = idFromCtx ?? activeWallet?.id ?? null;

  // Determine whether the active wallet is protected (context already normalizes this).
  const activeWalletInfo = wallets.find((w) => w.id === activeWalletId);
  const activeWalletHasPass = !!activeWalletInfo?.isProtected;
  const shouldShowArmChip = activeWalletHasPass || !!hasGlobalPassphrase;

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

  // 🔔 End-of-session modal state
  const [showEndModal, setShowEndModal] = useState(false);
  const [endModalAutoReturn, setEndModalAutoReturn] = useState(false);

  // Guards/refs
  const prevArmedRef = useRef(false);
  const suppressNextEndModalRef = useRef(false); // avoid modal on manual disarm
  const endModalShownOnceRef = useRef(false); // prevent duplicates from poll + event
  const lastWalletRef = useRef(activeWalletId);

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

  // Reset modal + guards when wallet changes
  useEffect(() => {
    if (lastWalletRef.current !== activeWalletId) {
      setShowEndModal(false);
      setEndModalAutoReturn(false);
      endModalShownOnceRef.current = false;
      suppressNextEndModalRef.current = false;
      prevArmedRef.current = false;
      lastWalletRef.current = activeWalletId;
    }
  }, [activeWalletId]);

  /* 🔁 Poll arm status every 20s */
  useEffect(() => {
    let timer;
    async function poll() {
      try {
        if (activeWalletId) {
          // expects backend to include { armed, msLeft, autoReturnTriggered? }
          const s = await getArmStatus(activeWalletId);
          const next = { armed: !!s.armed, msLeft: Number(s.msLeft || 0) };
          const wasArmed = prevArmedRef.current;

          setArmStatus(next);

          // Detect automatic end (TTL expiry) → show modal once
          if (wasArmed && !next.armed) {
            if (!suppressNextEndModalRef.current && !endModalShownOnceRef.current) {
              setEndModalAutoReturn(!!s.autoReturnTriggered);
              setShowEndModal(true);
              endModalShownOnceRef.current = true;
            }
            suppressNextEndModalRef.current = false; // reset guard
          }

          // If page loaded after expiry, still surface the one-shot autoReturn flag
          if (!wasArmed && !next.armed && s.autoReturnTriggered && !endModalShownOnceRef.current) {
            setEndModalAutoReturn(true);
            setShowEndModal(true);
            endModalShownOnceRef.current = true;
          }

          if (!next.armed) setWarned(false);
          prevArmedRef.current = next.armed;
        }
      } catch {
        setArmStatus({ armed: false, msLeft: 0 });
        setWarned(false);
        prevArmedRef.current = false;
      } finally {
        timer = setTimeout(poll, 20000);
      }
    }
    if (activeWalletId) poll();
    return () => timer && clearTimeout(timer);
  }, [activeWalletId]);

  /* 🔊 Cross-tab/local broadcast for arm/disarm events */
  const ARM_EVENT = "arm:state";
  const broadcastArmState = (payload) => {
    try {
      window.dispatchEvent(new CustomEvent(ARM_EVENT, { detail: payload }));
    } catch {}
  };

  useEffect(() => {
    const onArm = (e) => {
      const { walletId, armed, msLeft } = e.detail || {};
      if (!activeWalletId || walletId !== activeWalletId) return;
      const wasArmed = prevArmedRef.current;
      const nextArmed = !!armed;
      setArmStatus({ armed: nextArmed, msLeft: Number(msLeft || 0) });

      // Manual disarm should not show modal (guarded by suppress flag in handleDisarm)
      if (wasArmed && !nextArmed && !suppressNextEndModalRef.current && !endModalShownOnceRef.current) {
        setEndModalAutoReturn(false);
        setShowEndModal(true);
        endModalShownOnceRef.current = true;
      }
      if (!nextArmed) setWarned(false);
      prevArmedRef.current = nextArmed;
      suppressNextEndModalRef.current = false;
    };
    window.addEventListener(ARM_EVENT, onArm);
    return () => window.removeEventListener(ARM_EVENT, onArm);
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
      const newMsLeft = Math.max(armStatus.msLeft, 0) + minutes * 60 * 1000;
      setArmStatus({ armed: true, msLeft: newMsLeft });
      prevArmedRef.current = true;
      broadcastArmState({ walletId: activeWalletId, armed: true, msLeft: newMsLeft });
      // If modal was open (edge case), close it after extend
      setShowEndModal(false);
      endModalShownOnceRef.current = false;
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
    suppressNextEndModalRef.current = true; // don't show modal for explicit disarm
    try {
      await disarmEncryptedWallet({ walletId: activeWalletId });
      setArmStatus({ armed: false, msLeft: 0 });
      prevArmedRef.current = false;
      setWarned(false);
      broadcastArmState({ walletId: activeWalletId, armed: false, msLeft: 0 });
      toast.success("Automation disarmed.");
    } catch (e) {
      toast.error(e.message || "Failed to disarm.");
    } finally {
      setDisarmBusy(false);
    }
  };

  const handleArm = () => {
    // Route to Account tab so the user can open the Arm modal there (single navigate with state)
    setActiveTab("account");
    navigate("/account", { state: { openArm: true } });
    toast.info("Open the Arm modal to start a secure session.");
  };

  const handleCloseEndModal = () => setShowEndModal(false);
  const handleReArmNow = () => {
    setShowEndModal(false);
    setActiveTab("account");
    navigate("/account", { state: { openArm: true } });
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
      {/* Skip link for keyboard users. */}
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
          <button
            onClick={() => window.dispatchEvent(new Event("openWhatsNew"))}
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

      {/* 🔔 Arm End Modal */}
      <ArmEndModal
        open={showEndModal}
        autoReturn={endModalAutoReturn}
        onClose={() => setShowEndModal(false)}
        onReArm={() => {
          setShowEndModal(false);
          setActiveTab("account");
          navigate("/account", { state: { openArm: true } });
        }}
      />

      {/* What's New modal */}
      <WhatsNew />
    </div>
  );
}
