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
} from "lucide-react";
import logo from "@/assets/solpulse-logo.png";
import AccountMenu from "@/components/Dashboard/Account/AccountMenu";

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

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

        {/* Account Menu */}
        <div className="fixed top-4 right-6 z-50">
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
        <Outlet />
      </div>
    </div>
  );
}
