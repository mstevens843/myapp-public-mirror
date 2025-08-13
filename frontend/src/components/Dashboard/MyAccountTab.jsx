/* ------------------------------------------------------------------
 * MyAccountTab.jsx
 * What changed
 *  - Robust Web3 detection: treat as web3 if `type==="web3"` OR a
 *    `phantomPublicKey` is present.
 *  - Profile panel now shows a masked Phantom pubkey with eye toggle
 *    (Eye/EyeOff). Email/username/password UI is hidden for Web3.
 * Why
 *  - During recent polish passes, `type` sometimes arrived stale as "web".
 *    Falling back to `phantomPublicKey` avoids rendering the web-only form.
 * Risk addressed
 *  - Incorrect UI for Web3 users; accidental username/email edits shown.
 * ------------------------------------------------------------------ */

import React, { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { Info, CheckCircle, Shield, Timer, Lock, Unlock, Send, Eye, EyeOff } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getTelegramChatId } from "@/utils/telegramApi";
import { loadWallet, fetchActiveWallet } from "@/utils/auth";
import confetti from "canvas-confetti";
import {
  getProfile,
  updateProfile,
  changePassword,
  deleteAccount,
} from "@/utils/account";
import { getSubscriptionStatus } from "@/utils/payments";
import { enable2FA, disable2FA, verify2FA } from "../../utils/2fa";
import { useUser } from "@/contexts/UserProvider";
import { supabase } from "@/lib/supabase";

// Authenticated fetch helper for /api calls
import { authFetch } from "@/utils/authFetch";

// 🔐 Encrypted Wallet Session helpers (+ Return Balance helpers)
import {
  getArmStatus,
  armEncryptedWallet,
  extendEncryptedWallet,
  disarmEncryptedWallet,
  setRequireArmToTrade,
  formatCountdown,
  setupWalletProtection,
  removeWalletProtection,
  getAutoReturnSettings,
  saveAutoReturnSettings,
} from "@/utils/encryptedWalletSession";

import { useLocation } from "react-router-dom";

const PRE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

function maskPubkey(pk = "") {
  if (!pk || pk.length < 8) return "••••••••••••••••••••••••••••••";
  return `${pk.slice(0, 6)}•${"•".repeat(Math.max(0, pk.length - 12))}•${pk.slice(-6)}`;
}

const MyAccountTab = () => {
  /* ───────── State ───────── */
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const [plan, setPlan] = useState("");
  const [usage, setUsage] = useState(0);
  const [limit, setLimit] = useState(0);
  const [wallets, setWallets] = useState([]);
  const [activeWallet, setActiveWallet] = useState(null);
  const [telegramChatId, setTelegramChatId] = useState(null);

  /* 2-FA */
  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
  const [require2faLogin, setRequire2faLogin] = useState(false);
  const [require2faArm, setRequire2faArm] = useState(false);
  const [hasGlobalPassphrase, setHasGlobalPassphrase] = useState(false);
  const [armUseForAll, setArmUseForAll] = useState(false);
  const [armPassphraseHint, setArmPassphraseHint] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  const [twoFAToken, setTwoFAToken] = useState("");
  const inputRef = useRef(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [twoFASuccess, setTwoFASuccess] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);

  const [revealPhantom, setRevealPhantom] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  // 🔐 Protected Mode + Arm modal state
  const [requireArm, setRequireArm] = useState(false);
  const [armStatus, setArmStatus] = useState({ armed: false, msLeft: 0 });
  const [warned, setWarned] = useState(false);

  const [armModalOpen, setArmModalOpen] = useState(false);
  const [armPassphrase, setArmPassphrase] = useState("");
  const [armDuration, setArmDuration] = useState(240); // minutes
  const [armMigrateLegacy, setArmMigrateLegacy] = useState(false);
  const [armBusy, setArmBusy] = useState(false);
  const [extendBusy, setExtendBusy] = useState(false);
  const [disarmBusy, setDisarmBusy] = useState(false);

  const [armPassphraseConfirm, setArmPassphraseConfirm] = useState("");
  const [forceOverwrite, setForceOverwrite] = useState(false);

  // Remove Protection modal state
  const [removeModalOpen, setRemoveModalOpen] = useState(false);
  const [removePassphrase, setRemovePassphrase] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");

  // ── NEW: Auto-Return (Return Balance) state
  const [autoReturnConfigured, setAutoReturnConfigured] = useState(false);
  const [autoReturnDest, setAutoReturnDest] = useState("");
  const [autoReturnDefaultEnabled, setAutoReturnDefaultEnabled] = useState(false);
  const [autoReturnModalOpen, setAutoReturnModalOpen] = useState(false);
  const [autoReturnSaving, setAutoReturnSaving] = useState(false);
  const [armAutoReturn, setArmAutoReturn] = useState(false);

  /* ───────── Derived helpers ───────── */
   const { type, phantomPublicKey, refreshProfile, passphraseHint, loading: userLoading } = useUser();

  if (userLoading) return <div className="p-6 text-white">Loading profile…</div>;
  // Treat as web3 if server says "web3" OR a phantom key exists (defensive).
  const isWeb3 = type === "web3" || !!phantomPublicKey;

  // Determine whether current wallet has protection
  const [activeWalletHasPassphrase, setActiveWalletHasPassphrase] = useState(false);

  useEffect(() => {
    setActiveWalletHasPassphrase(
      !!(
        activeWallet?.hasPassphrase ||
        (activeWallet?.passphraseHash !== null &&
          activeWallet?.passphraseHash !== undefined) ||
        activeWallet?.isProtected
      )
    );
  }, [activeWallet]);

  const armMode =
    !activeWalletHasPassphrase && !hasGlobalPassphrase ? "firstTime" : "existing";

  // Handle "Use for ALL wallets" confirmation
  const handleUseForAllToggle = (checked) => {
    if (checked) {
      const customCount = wallets.filter((w) => {
        if (w.id === activeWallet?.id) return false;
        const hasCustom =
          w.hasPassphrase ||
          (w.passphraseHash !== null && w.passphraseHash !== undefined) ||
          w.isProtected;
        return !!hasCustom;
      }).length;

      if (customCount > 0) {
        const ok = window.confirm(
          `This will overwrite the pass-phrase on ${customCount} wallet${
            customCount > 1 ? "s" : ""
          }. Proceed?`
        );
        if (ok) {
          setArmUseForAll(true);
          setForceOverwrite(true);
        } else {
          setArmUseForAll(false);
          setForceOverwrite(false);
        }
        return;
      }
    }
    setArmUseForAll(checked);
    setForceOverwrite(false);
  };

  /* ───────── Focus token field when QR shows ───────── */
  useEffect(() => {
    if (qrCodeUrl && inputRef.current) inputRef.current.focus();
  }, [qrCodeUrl]);

  /* ───────── Fetch primary data ───────── */
  useEffect(() => {
    (async () => {
      setLoading(true);

      const [profileData, subStatus, chatId, allWallets, activeW] = await Promise.all([
        getProfile(),
        getSubscriptionStatus(),
        getTelegramChatId(),
        loadWallet(),
        fetchActiveWallet(),
      ]);

      // Force-clear web fields if this is a Web3 session.
      if (isWeb3) {
        if (profileData) {
          profileData.email = null;
          profileData.username = null;
        }
      } else {
        // Web accounts: normalize "email in username" case
        if (profileData && !profileData.email && profileData.username?.includes("@")) {
          profileData.email = profileData.username;
          profileData.username = "";
        }
      }

      setProfile(profileData || null);

      if (subStatus) {
        setPlan(subStatus.plan || "free");
        setUsage(subStatus.usage || 0);
        setLimit(subStatus.limit || 0);
      }

      if (chatId) setTelegramChatId(chatId);
      if (allWallets) setWallets(allWallets);

      if (activeW) {
        const fullActive = allWallets.find((w) => w.id === activeW);
        setActiveWallet(fullActive || { id: activeW });
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWeb3]); // re-run if type flips to web3 after mount

  // Extended auth info (2FA toggles, global passphrase) + auto-return settings
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/auth/me", { method: "GET" });
        if (res.ok) {
          const data = await res.json();
          const u = data?.user;
          if (u) {
            setIs2FAEnabled(!!u.is2FAEnabled);
            setRequire2faLogin(!!u.require2faLogin);
            setRequire2faArm(!!u.require2faArm);
            setRequireArm(!!u.requireArmToTrade);
            setHasGlobalPassphrase(!!u.hasGlobalPassphrase);
          }
        }
      } catch (err) {
        console.error("Failed to load auth/me:", err);
      }

      try {
        const settings = await getAutoReturnSettings();
        if (settings) {
          setAutoReturnConfigured(!!settings.destPubkey);
          setAutoReturnDest(settings.destPubkey || "");
          setAutoReturnDefaultEnabled(!!settings.defaultEnabled);
          setArmAutoReturn(!!settings.defaultEnabled);
        }
      } catch (err) {
        // if endpoint missing that's fine; user can still arm without it
        console.warn("Auto-Return settings not available:", err?.message);
      }
    })();
  }, []);

  // 🔁 Poll Arm status for the active wallet (every 20s)
  useEffect(() => {
    let timer;
    async function poll() {
      try {
        if (activeWallet?.id) {
          const s = await getArmStatus(activeWallet.id);
          setArmStatus({ armed: !!s.armed, msLeft: s.msLeft || 0 });
          if (!s.armed) setWarned(false);
        }
      } catch {
        setArmStatus((prev) => ({ ...prev, armed: false, msLeft: 0 }));
        setWarned(false);
      } finally {
        timer = setTimeout(poll, 20000);
      }
    }
    if (activeWallet?.id) poll();
    return () => timer && clearTimeout(timer);
  }, [activeWallet?.id]);

  // ⏱️ Local 1-second countdown
  useEffect(() => {
    if (!armStatus.armed || armStatus.msLeft <= 0) return;
    const tick = setInterval(() => {
      setArmStatus((prev) => {
        const next = Math.max(0, (prev.msLeft || 0) - 1000);
        return { ...prev, msLeft: next };
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [armStatus.armed]);

  // Pre-expiry toast at T-15m
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

  const location = useLocation();
  useEffect(() => {
    if (location.state?.openArm) setArmModalOpen(true);
  }, [location.state]);

  /* ───────── Actions ───────── */
  const handleSaveProfile = async () => {
    if (await updateProfile(profile)) toast.success("Profile updated.");
    else toast.error("Failed to update profile.");
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword)
      return toast.error("Fill out every password field.");
    if (newPassword !== confirmPassword) return toast.error("New passwords do not match.");

    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr || !user) {
        console.error("Supabase getUser error:", userErr);
        return toast.error("Failed to verify user session.");
      }

      const userType = user.user_metadata?.type || "web";
      if (userType !== "web") {
        return toast.error("Password changes are only supported for Web accounts.");
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        console.error("Supabase password update failed:", updateError.message);
        return toast.error("Failed to update password.");
      }

      toast.success("Password changed.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordForm(false);
    } catch (err) {
      console.error("Password change unexpected error:", err);
      toast.error("An unexpected error occurred.");
    }
  };

  const handleDeleteAccount = async () => {
    if (await deleteAccount()) {
      toast.success("Account deleted. Logging out…");
      setTimeout(() => (window.location.href = "/"), 1500);
    } else toast.error("Failed to delete account.");
  };

  const handleEnable2FA = async () => {
    try {
      const res = await enable2FA();
      if (res?.qrCodeDataURL) {
        setQrCodeUrl(res.qrCodeDataURL);
        setRecoveryCodes(res.recoveryCodes || []);
        toast.success("Scan QR and enter code to enable 2FA.");
      } else toast.error(res?.error || "Failed to enable 2FA.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to enable 2FA.");
    }
  };

  const handleVerify2FA = async () => {
    const data = await verify2FA(twoFAToken);
    if (data?.message) {
      setIs2FAEnabled(true);
      setTwoFASuccess(true);
      setQrCodeUrl(null);
      setTwoFAToken("");
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      toast.success("2FA enabled!");
    } else toast.error("Failed to verify 2FA.");
  };

  const handleDisable2FA = async () => {
    const data = await disable2FA();
    if (data?.message) {
      toast.success("2FA disabled.");
      setIs2FAEnabled(false);
      setQrCodeUrl(null);
      setTwoFAToken("");
    } else toast.error("Failed to disable 2FA.");
  };

  const handleToggleLogin2FA = async () => {
    try {
      const next = !require2faLogin;
      const ok = await updateProfile({ require2faLogin: next });
      if (ok) {
        setRequire2faLogin(next);
        toast.success(next ? "Login 2FA enabled." : "Login 2FA disabled.");
      } else toast.error("Failed to update setting.");
    } catch (e) {
      toast.error(e.message || "Failed to update setting.");
    }
  };

  const handleToggleArm2FA = async () => {
    try {
      const next = !require2faArm;
      const ok = await updateProfile({ require2faArm: next });
      if (ok) {
        setRequire2faArm(next);
        toast.success(next ? "2FA required when arming enabled." : "2FA on arm disabled.");
      } else toast.error("Failed to update setting.");
    } catch (e) {
      toast.error(e.message || "Failed to update setting.");
    }
  };

  const handleToggleProtectedMode = async () => {
    try {
      const next = !requireArm;
      await setRequireArmToTrade(next);
      setRequireArm(next);
      toast.success(next ? "Protected Mode enabled." : "Protected Mode disabled.");
    } catch (e) {
      toast.error(e.message || "Failed to update security setting.");
    }
  };

  const handleOpenArm = () => {
    if (!activeWallet?.id) return toast.error("No active wallet selected.");
    if (armMode !== "firstTime" && require2faArm && !is2FAEnabled) {
      return toast.error(
        "Enable 2FA before you can arm this wallet. Go to the Security tab to set up 2FA."
      );
    }
    // initialize per-session checkbox from default
    setArmAutoReturn(autoReturnDefaultEnabled);
    setArmModalOpen(true);
  };

  const handleArm = async () => {
    if (!armPassphrase) return toast.error("Enter your wallet pass-phrase.");
    if (armMode === "firstTime") {
      if (!armPassphraseConfirm) return toast.error("Confirm your pass-phrase.");
      if (armPassphrase !== armPassphraseConfirm)
        return toast.error("Pass-phrases do not match.");
    }
    if (armMode !== "firstTime" && require2faArm && is2FAEnabled && !twoFAToken) {
      return toast.error("Enter your 2FA code.");
    }
    if (armAutoReturn && !autoReturnDest) {
      setAutoReturnModalOpen(true);
      return toast.error("Set a safe wallet destination first.");
    }
    setArmBusy(true);
    try {
      if (armMode === "firstTime") {
        await setupWalletProtection({
          walletId: activeWallet.id,
          passphrase: armPassphrase,
          applyToAll: armUseForAll,
          passphraseHint:
            armPassphraseHint && armPassphraseHint.trim() !== ""
              ? armPassphraseHint
              : undefined,
          forceOverwrite,
        });
        setArmStatus({ armed: false, msLeft: 0 });
        setWarned(false);
        setArmModalOpen(false);
        setArmPassphrase("");
        setArmPassphraseConfirm("");
        setTwoFAToken("");
        setArmUseForAll(false);
        setForceOverwrite(false);
        setArmPassphraseHint("");
        if (activeWallet) {
          setActiveWallet((prev) =>
            prev && prev.id === activeWallet.id
              ? {
                  ...prev,
                  isProtected: true,
                  hasPassphrase: true,
                  passphraseHash: prev.passphraseHash || "set",
                }
              : prev
          );
          setWallets((prev) =>
            prev.map((w) =>
              w.id === activeWallet.id
                ? {
                    ...w,
                    isProtected: true,
                    hasPassphrase: true,
                    passphraseHash: w.passphraseHash || "set",
                  }
                : w
            )
          );
        }
        if (armUseForAll) setHasGlobalPassphrase(true);
        toast.success(
          armUseForAll
            ? "Pass-phrase applied to all wallets. Your wallets are now protected."
            : "Wallet protected. Unlock when you’re ready to trade."
        );
      } else {
        const res = await armEncryptedWallet({
          walletId: activeWallet.id,
          passphrase: armPassphrase,
          twoFactorToken: require2faArm && is2FAEnabled ? twoFAToken : undefined,
          ttlMinutes: armDuration,
          migrateLegacy: armMigrateLegacy,
          applyToAll: armUseForAll,
          forceOverwrite,
          autoReturnOnEnd: armAutoReturn,
          autoReturnDest: autoReturnDest || undefined,
        });
        setArmStatus({
          armed: true,
          msLeft: (armDuration || res.armedForMinutes) * 60 * 1000,
        });
        setWarned(false);
        setArmModalOpen(false);
        setArmPassphrase("");
        setArmPassphraseConfirm("");
        setTwoFAToken("");
        setArmUseForAll(false);
        setForceOverwrite(false);
        setArmPassphraseHint("");
        toast.success(
          `Automation armed for ${res.armedForMinutes || armDuration} minutes.`
        );
      }
    } catch (e) {
      const msg = e.message || "";
      if (/needs2FA/i.test(msg) || /forbidden/i.test(msg)) {
        toast.error("Enable 2FA before you can arm this wallet. Visit the Security tab.");
      } else {
        toast.error(
          msg || (armMode === "firstTime" ? "Failed to set up protection." : "Failed to arm.")
        );
      }
    } finally {
      setArmBusy(false);
    }
  };

  const handleExtend = async (minutes = 120) => {
    if (!activeWallet?.id) return;
    setExtendBusy(true);
    try {
      await extendEncryptedWallet({
        walletId: activeWallet.id,
        twoFactorToken: twoFAToken || undefined,
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
    if (!activeWallet?.id) return;
    setDisarmBusy(true);
    try {
      await disarmEncryptedWallet({
        walletId: activeWallet.id,
        twoFactorToken: twoFAToken || undefined,
      });
      setArmStatus({ armed: false, msLeft: 0 });
      setWarned(false);
      toast.success("Automation disarmed.");
    } catch (e) {
      toast.error(e.message || "Failed to disarm.");
    } finally {
      setDisarmBusy(false);
    }
  };

  // Remove protection
  const [removeErrorShown, setRemoveErrorShown] = useState(false);
  const handleRemoveProtection = async () => {
    if (!activeWallet?.id) {
      setRemoveError("No active wallet selected.");
      return;
    }
    const passphrase = removePassphrase;
    if (!passphrase) {
      setRemoveError("Pass-phrase required to remove protection.");
      return;
    }
    setRemoveBusy(true);
    setRemoveError("");
    try {
      await removeWalletProtection({ walletId: activeWallet.id, passphrase });
      try {
        await setRequireArmToTrade(false);
      } catch {}
      setRequireArm(false);
      const [allWallets, activeW] = await Promise.all([loadWallet(), fetchActiveWallet()]);
      setWallets(allWallets || []);
      setActiveWallet(activeW || null);
      toast.success("Protection removed.");
      try {
        await refreshProfile();
      } catch (err) {
        console.error("Failed to refresh profile after remove:", err);
      }
      setRemoveModalOpen(false);
      setRemovePassphrase("");
    } catch (e) {
      setRemoveError(e.message || "Failed to remove protection.");
      setRemoveErrorShown(true);
    } finally {
      setRemoveBusy(false);
    }
  };

  /* ───────── Early returns ───────── */
  if (loading) return <div className="p-6 text-white">Loading profile…</div>;
  if (!profile) return <div className="p-6 text-red-400">Profile not found.</div>;

  /* ─────────── UI ─────────── */
  return (
    <div className="container mx-auto p-6 bg-black text-white">
      {/* Banner */}
      <div className="bg-emerald-600 text-black p-4 rounded-lg mb-6 flex items-center gap-3">
        <Info size={18} />
        <span className="text-sm">
          <strong>Account Settings:</strong> Manage personal info and preferences here.
        </span>
      </div>

      {/* 🔐 Armed banner */}
      {armStatus.armed && (
        <div className="bg-emerald-700/50 border border-emerald-600 rounded-lg p-3 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={18} />
            <span className="text-sm">
              <strong>Automation Armed</strong> — {formatCountdown(armStatus.msLeft)} remaining.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="border-emerald-500 text-emerald-300"
              disabled={extendBusy}
              onClick={() => handleExtend(120)}
            >
              <Timer className="mr-1" size={16} />
              Extend +2h
            </Button>
            <Button className="bg-red-600 text-white" disabled={disarmBusy} onClick={handleDisarm}>
              <Lock className="mr-1" size={16} />
              Disarm
            </Button>
          </div>
        </div>
      )}

      <h2 className="text-2xl font-bold mb-4">My Account</h2>

      <div className="space-y-4">
        {/* ───────── Profile Information ───────── */}
        <div className="bg-zinc-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold">Profile Information</h3>
          <div className="mt-2 space-y-2">
            {/* Web-only fields */}
            {!isWeb3 && (
              <>
                <label>Email (read-only)</label>
                <input type="email" value={profile.email || ""} disabled className="w-full p-2 rounded" />
                <label>Username</label>
                <input
                  type="text"
                  value={profile.username || ""}
                  onChange={(e) => setProfile((prev) => ({ ...prev, username: e.target.value }))}
                  className="w-full p-2 rounded"
                />
              </>
            )}

            {/* Web3-only Phantom pubkey with eye toggle */}
            {isWeb3 && (
              <>
                <label>Phantom Wallet</label>
                <div className="flex justify-between items-center bg-zinc-900 border border-zinc-700 p-2 rounded font-mono text-xs text-emerald-400">
                  <span className="truncate">
                    {revealPhantom ? phantomPublicKey : maskPubkey(phantomPublicKey)}
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setRevealPhantom((v) => !v)}
                      className="text-zinc-400 hover:text-white flex items-center gap-1"
                      aria-label={revealPhantom ? "Hide key" : "Show key"}
                    >
                      {revealPhantom ? <EyeOff size={16}/> : <Eye size={16}/>}
                      {revealPhantom ? "Hide" : "Show"}
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(phantomPublicKey || "");
                        toast.success("Phantom pubkey copied.");
                      }}
                      className="text-zinc-400 hover:text-white"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </>
            )}

            {!isWeb3 && (
              <Button onClick={handleSaveProfile} className="mt-2 bg-emerald-600 text-white">
                Save Profile
              </Button>
            )}
          </div>
        </div>

        {/* ───────── Change Password (web only) ───────── */}
        {!isWeb3 && (
          <div className="bg-zinc-800 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Change Password</h3>
              <button onClick={() => setShowPasswordForm((prev) => !prev)} className="text-sm text-emerald-400 hover:underline">
                {showPasswordForm ? "Hide" : "Update"}
              </button>
            </div>

            {showPasswordForm && (
              <div className="mt-4 space-y-3">
                <input
                  type="password"
                  placeholder="Current Password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full p-2 rounded text-black"
                />
                <input
                  type="password"
                  placeholder="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-2 rounded text-black"
                />
                <input
                  type="password"
                  placeholder="Confirm New Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full p-2 rounded text-black"
                />
                <Button onClick={handleChangePassword} className="bg-emerald-600 text-white">
                  Change Password
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ───── Wallets ───── */}
        <div className="bg-zinc-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold flex items-center gap-2">👛 Wallets</h3>
          <p className="text-sm mt-1">
            <span className="font-medium">Active Wallet:</span>{" "}
            <span className="text-emerald-400">{activeWallet?.label || "None"}</span>
          </p>
          <p className="text-sm">
            <span className="font-medium">Total Wallets:</span> {wallets.length}
          </p>
          <a href="/wallets" className="inline-block mt-2 text-emerald-400 hover:underline text-sm">
            Manage Wallets →
          </a>
        </div>

        {/* 🔐 Wallet Protection (Protected Mode) */}
        <div className="bg-zinc-800 p-4 rounded-lg">
          <div className="flex items-start justify-between">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Shield size={18} />
              Wallet Protection
            </h3>

            {/* NEW: Auto-Return Setup button (top-right of the card) */}
            {(activeWalletHasPassphrase || hasGlobalPassphrase) && (
              <Button
                variant="outline"
                className="text-emerald-300 border-emerald-600 hover:bg-emerald-900/20"
                onClick={() => setAutoReturnModalOpen(true)}
                title="Configure a safe wallet to sweep balances to after a session ends"
              >
                <Send size={16} className="mr-2" />
                Set up Auto-Return
              </Button>
            )}
          </div>

          {/* Explanation text */}
          <p className="text-sm text-zinc-400 mt-1">
            Protect this wallet with a passphrase so bots can’t auto-trade unless you unlock it.
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            <strong>What is Arming?</strong> Arming unlocks your wallet for bot trading without exposing your private key. You control when the bot is allowed to trade by entering your passphrase and 2FA (if enabled). It lasts a few hours and auto-locks again when it expires.
          </p>

          {/* subtle status row for auto-return */}
          {(activeWalletHasPassphrase || hasGlobalPassphrase) && (
            <div className="mt-3 text-xs text-zinc-400">
              Auto-Return:{" "}
              {autoReturnConfigured ? (
                <span className="text-emerald-400">
                  Configured {autoReturnDefaultEnabled ? "(default on)" : "(default off)"} →{" "}
                  <span className="font-mono">{autoReturnDest.slice(0, 6)}…{autoReturnDest.slice(-6)}</span>
                </span>
              ) : (
                <span className="text-amber-400">Not configured</span>
              )}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between">
            <div className="text-sm flex items-center">
              {(activeWalletHasPassphrase || hasGlobalPassphrase) ? (
                <Button
                  variant="ghost"
                  className="text-red-400 bg-red-500/10 text-xs px-2 py-1"
                  onClick={() => setRemoveModalOpen(true)}
                >
                  Remove&nbsp;Protection
                </Button>
              ) : (
                <span className="text-zinc-500 text-xs">Protection&nbsp;not&nbsp;set</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {!armStatus.armed ? (
                armMode === "firstTime" ? (
                  <Button className="bg-emerald-600 text-white" onClick={handleOpenArm}>
                    <Lock className="mr-1" size={16} />
                    Set Up Protection
                  </Button>
                ) : (
                  <Button className="bg-emerald-600 text-white" onClick={handleOpenArm}>
                    <Unlock className="mr-1" size={16} />
                    Arm Now
                  </Button>
                )
              ) : (
                <Button
                  variant="outline"
                  className="border-emerald-500 text-emerald-300"
                  onClick={() => handleExtend(120)}
                  disabled={extendBusy}
                >
                  <Timer className="mr-1" size={16} />
                  Extend +2h
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Arm Modal */}
        {/* (unchanged content below) */}
        <Dialog open={armModalOpen} onOpenChange={setArmModalOpen}>
          <DialogContent>
            <h3 className="text-xl font-bold mb-2">
              {armMode === "firstTime" ? "Set Up Wallet Protection" : "Unlock Wallet"}
            </h3>
            <p className="text-sm text-zinc-400 mb-4">
              {armMode === "firstTime"
                ? (
                    <>
                      Protect this wallet with a passphrase so bots can’t auto-trade unless you unlock it. Enter and confirm your passphrase below. This is a one-time setup for this wallet (or apply it to all wallets).
                      {require2faArm && is2FAEnabled && (
                        <span className="block mt-1 text-amber-400">
                          You do not need to enter a 2FA code when setting up a wallet passphrase. 2FA is only required when unlocking the wallet later for trading.
                        </span>
                      )}
                    </>
                  )
                : `Use your passphrase${require2faArm && is2FAEnabled ? " and 2FA code" : ""} to unlock this wallet for trading.`}
            </p>
            <div className="space-y-3">
              <label className="text-sm">Active Wallet</label>
              <div className="w-full p-2 rounded bg-zinc-900 border border-zinc-700 text-emerald-400 text-xs font-mono">
                {activeWallet?.label || `ID#${activeWallet?.id || "—"}`}
              </div>

              {armMode === "firstTime" && (
                <>
                  <label className="text-sm">Pass-phrase</label>
                  <input
                    type="password"
                    placeholder="Wallet pass-phrase"
                    value={armPassphrase}
                    onChange={(e) => setArmPassphrase(e.target.value)}
                    className="w-full p-2 rounded text-black"
                  />
                  <label className="text-sm">Confirm Pass-phrase</label>
                  <input
                    type="password"
                    placeholder="Confirm pass-phrase"
                    value={armPassphraseConfirm}
                    onChange={(e) => setArmPassphraseConfirm(e.target.value)}
                    className="w-full p-2 rounded text-black"
                  />
                  {hasGlobalPassphrase ? (
                    <div className="flex flex-col gap-1">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked disabled />
                        Use this pass-phrase for all my current and future wallets
                      </label>
                      <p className="text-xs text-zinc-500">
                        New wallets will inherit your saved pass-phrase automatically.
                      </p>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={armUseForAll}
                        onChange={(e) => handleUseForAllToggle(e.target.checked)}
                      />
                      Use this pass-phrase for all my current and future wallets
                    </label>
                  )}
                  <label className="text-sm">Pass-phrase Hint (optional)</label>
                  <input
                    type="text"
                    placeholder="Hint (optional)"
                    value={armPassphraseHint}
                    onChange={(e) => setArmPassphraseHint(e.target.value)}
                    className="w-full p-2 rounded text-black"
                  />
                  <p className="text-xs text-amber-400">
                    ⚠️ You will never see this pass-phrase again. Save it in a password manager.
                  </p>
                </>
              )}

              {armMode === "existing" && (
                <>
                  <label className="text-sm">Pass-phrase</label>
                  <input
                    type="password"
                    placeholder="Wallet pass-phrase"
                    value={armPassphrase}
                    onChange={(e) => setArmPassphrase(e.target.value)}
                    className="w-full p-2 rounded text-black"
                  />
                  {passphraseHint && (
                    <p className="mt-1 text-xs text-zinc-500">Hint: {passphraseHint}</p>
                  )}
                </>
              )}

              {/* 2FA Code */}
              {armMode !== "firstTime" && require2faArm && is2FAEnabled && (
                <>
                  <label className="text-sm">2FA Code</label>
                  <input
                    type="text"
                    placeholder="123456"
                    value={twoFAToken}
                    onChange={(e) => setTwoFAToken(e.target.value)}
                    className="w-full p-2 rounded text-black"
                  />
                </>
              )}

              {/* Duration */}
              {armMode !== "firstTime" && (
                <>
                  <label className="text-sm">Duration</label>
                  <select
                    className="w-full p-2 rounded text-black"
                    value={armDuration}
                    onChange={(e) => setArmDuration(Number(e.target.value))}
                  >
                    <option value={120}>2 hours</option>
                    <option value={240}>4 hours (default)</option>
                    <option value={480}>8 hours</option>
                  </select>
                </>
              )}

              {/* Legacy migration */}
              {armMode !== "firstTime" && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={armMigrateLegacy}
                    onChange={(e) => setArmMigrateLegacy(e.target.checked)}
                  />
                  Upgrade legacy wallet encryption during this arm
                </label>
              )}

              {/* NEW: Auto-Return per-session checkbox */}
              {armMode !== "firstTime" && (
                <div className="mt-2 p-3 rounded bg-emerald-900/20 border border-emerald-800">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={armAutoReturn}
                      onChange={(e) => setArmAutoReturn(e.target.checked)}
                    />
                    Auto-return all balances (keep ~0.01 SOL) to safe wallet when this session ends
                  </label>
                  {autoReturnDest ? (
                    <p className="text-xs text-zinc-400 mt-1">
                      Safe wallet: <span className="font-mono">{autoReturnDest.slice(0, 6)}…{autoReturnDest.slice(-6)}</span>
                    </p>
                  ) : (
                    <div className="text-xs text-amber-400 mt-1 flex items-center justify-between">
                      <span>No safe wallet configured yet.</span>
                      <button
                        className="underline text-emerald-400"
                        onClick={() => setAutoReturnModalOpen(true)}
                      >
                        Set one up
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setArmModalOpen(false)}>
                  Cancel
                </Button>
                <Button className="bg-emerald-600 text-white" onClick={handleArm} disabled={armBusy}>
                  {armBusy ? (armMode === "firstTime" ? "Saving…" : "Unlocking…") : armMode === "firstTime" ? "Set Up Protection" : "Unlock"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Auto-Return Setup Modal */}
        {/* (unchanged) */}
        <Dialog open={autoReturnModalOpen} onOpenChange={setAutoReturnModalOpen}>
          <DialogContent>
            <h3 className="text-xl font-bold mb-2">Set up Auto-Return</h3>
            <p className="text-sm text-zinc-400 mb-4">
              Choose a safe wallet to sweep balances to after a session ends. We'll keep ~0.01 SOL for rent/fees.
            </p>
            <div className="space-y-3">
              <label className="text-sm">Safe Wallet (public key)</label>
              <input
                type="text"
                placeholder="Paste destination pubkey"
                value={autoReturnDest}
                onChange={(e) => setAutoReturnDest(e.target.value.trim())}
                className="w-full p-2 rounded text-black"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoReturnDefaultEnabled}
                  onChange={(e) => setAutoReturnDefaultEnabled(e.target.checked)}
                />
                Enable Auto-Return by default when arming
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setAutoReturnModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  className="bg-emerald-600 text-white"
                  disabled={autoReturnSaving || !autoReturnDest}
                  onClick={async () => {
                    setAutoReturnSaving(true);
                    try {
                      await saveAutoReturnSettings({
                        destPubkey: autoReturnDest,
                        defaultEnabled: autoReturnDefaultEnabled,
                      });
                      setAutoReturnConfigured(true);
                      toast.success("Auto-Return destination saved.");
                      setAutoReturnModalOpen(false);
                    } catch (e) {
                      toast.error(e.message || "Failed to save Auto-Return settings.");
                    } finally {
                      setAutoReturnSaving(false);
                    }
                  }}
                >
                  {autoReturnSaving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Remove Protection Modal */}
        {/* (unchanged) */}
        <Dialog open={removeModalOpen} onOpenChange={setRemoveModalOpen}>
          <DialogContent>
            <h3 className="text-xl font-bold mb-2">Remove Wallet Protection</h3>
            <p className="text-sm text-zinc-400 mb-4">
              Enter your current pass-phrase to permanently remove protection from this wallet. Bots will be able to trade without unlocking once removed.
            </p>
            <div className="space-y-3">
              <label className="text-sm">Active Wallet</label>
              <div className="w-full p-2 rounded bg-zinc-900 border border-zinc-700 text-emerald-400 text-xs font-mono">
                {activeWallet?.label || `ID#${activeWallet?.id || "—"}`}
              </div>
              <label className="text-sm">Pass-phrase</label>
              <input
                type="password"
                placeholder="Wallet pass-phrase"
                value={removePassphrase}
                onChange={(e) => setRemovePassphrase(e.target.value)}
                className="w-full p-2 rounded text-black"
              />
              {passphraseHint && <p className="mt-1 text-xs text-zinc-500">Hint: {passphraseHint}</p>}
              {removeError && <div className="rounded bg-red-500/20 p-2 text-sm text-red-400">{removeError}</div>}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setRemoveModalOpen(false);
                    setRemovePassphrase("");
                    setRemoveError("");
                  }}
                >
                  Cancel
                </Button>
                <Button className="bg-red-600 text-white" disabled={removeBusy} onClick={handleRemoveProtection}>
                  {removeBusy ? "Removing…" : "Remove Protection"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* ───── Subscription ───── */}
        <div className="bg-zinc-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold flex items-center gap-2">💳 Subscription</h3>
          <p className="text-sm mt-1">
            <span className="font-medium">Current Plan:</span>{" "}
            <span className="text-emerald-400">{plan}</span>
          </p>
          <p className="text-sm">
            <span className="font-medium">Usage:</span>{" "}
            {usage.toLocaleString()} / {limit.toLocaleString()} CU
          </p>
          <a href="/payments" className="inline-block mt-2 text-emerald-400 hover:underline text-sm">
            Manage Subscription →
          </a>
        </div>

        {/* ───── Telegram Alerts ───── */}
        <div className="bg-zinc-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold flex items-center gap-2">📲 Telegram Alerts</h3>
          {telegramChatId ? (
            <p className="text-sm mt-1">
              Connected to Chat ID: <span className="text-emerald-400">@{telegramChatId}</span>
            </p>
          ) : (
            <p className="text-sm mt-1 text-red-400">Not connected</p>
          )}
          <a href="/telegram" className="inline-block mt-2 text-emerald-400 hover:underline text-sm">
            {telegramChatId ? "Manage Alerts →" : "Set up Alerts →"}
          </a>
        </div>

        {/* ───── Two-Factor Auth ───── */}
        <div className="bg-zinc-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold flex items-center gap-2">🔒 Two-Factor Authentication</h3>
          {is2FAEnabled ? (
            <>
              <p className="text-sm mt-1 text-emerald-400">2FA is enabled on your account.</p>
              <div className="flex flex-col gap-2 mt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={require2faLogin} onChange={handleToggleLogin2FA} />
                  <span>Require 2FA on Login (extra secure)</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={require2faArm} onChange={handleToggleArm2FA} />
                  <span>Require 2FA when arming (Arm-to-Trade)</span>
                </label>
              </div>
              <Dialog open={disableDialogOpen} onOpenChange={setDisableDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="mt-2 bg-red-600 text-white" onClick={() => setDisableDialogOpen(true)}>
                    Disable 2FA
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <h3 className="text-lg text-white mb-2">Confirm Disable 2FA</h3>
                  <p className="text-sm text-gray-400 mb-4">Are you sure you want to disable two-factor authentication?</p>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setDisableDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      className="bg-red-600 text-white"
                      onClick={async () => {
                        await handleDisable2FA();
                        setDisableDialogOpen(false);
                      }}
                    >
                      Confirm Disable
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <>
              <p className="text-sm mt-1 text-red-400">2FA is not enabled.</p>
              <Button className="mt-2 bg-emerald-600 text-white" onClick={handleEnable2FA}>
                Enable 2FA
              </Button>
            </>
          )}

          {/* 2FA setup / success modal */}
          <Dialog
            open={!!qrCodeUrl}
            onOpenChange={(open) => {
              if (!open) {
                setQrCodeUrl(null);
                setTwoFASuccess(false);
              }
            }}
          >
            <DialogContent>
              {twoFASuccess ? (
                <div className="flex flex-col items-center justify-center">
                  <h3 className="flex items-center gap-2 text-2xl font-bold mb-4 text-emerald-400">
                    <CheckCircle size={28} />
                    2FA Enabled!
                  </h3>
                  <p className="text-zinc-400 mb-6 text-center max-w-xs">Your two-factor authentication is now active.</p>
                  <Button
                    onClick={() => {
                      toast.success("2FA setup complete!");
                      setQrCodeUrl(null);
                      setTwoFASuccess(false);
                    }}
                    className="bg-emerald-600 text-white w-full"
                  >
                    Close
                  </Button>
                </div>
              ) : (
                <>
                  <h3 className="text-xl font-bold mb-3">Setup Two-Factor Auth</h3>
                  <p className="text-sm text-zinc-400 mb-4">Scan this QR in Google Authenticator and enter the 6-digit code below.</p>
                  <img src={qrCodeUrl} alt="2FA QR" className="mb-4 rounded shadow" />
                  {recoveryCodes.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-md font-semibold text-emerald-400 mb-2">Backup Recovery Codes</h4>
                      <p className="text-xs text-zinc-400 mb-2">Store these safely. Each can be used once if you lose your Authenticator.</p>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {recoveryCodes.map((code) => (
                          <div key={code} className="bg-zinc-900 p-2 rounded text-center text-white font-mono text-sm">
                            {code}
                          </div>
                        ))}
                      </div>
                      <Button
                        onClick={() => {
                          navigator.clipboard.writeText(recoveryCodes.join("\n"));
                          toast.success("Backup codes copied!");
                        }}
                        className="w-full bg-emerald-600 text-white"
                      >
                        Copy Backup Codes
                      </Button>
                    </div>
                  )}
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="123456"
                    value={twoFAToken}
                    onChange={(e) => setTwoFAToken(e.target.value)}
                    className="w-full p-3 rounded text-white mb-4 border-2 border-emerald-500"
                  />
                  <Button onClick={handleVerify2FA} className="w-full bg-emerald-600 text-white">
                    Verify & Enable 2FA
                  </Button>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>

        {/* ───── Support ───── */}
        <div className="bg-zinc-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold flex items-center gap-2">🆘 Support</h3>
          <p className="text-sm mt-1">
            Questions? Visit our{" "}
            <a href="/faq" className="text-emerald-400 hover:underline">
              FAQ
            </a>{" "}
            or email{" "}
            <a href="mailto:support@yourapp.com" className="text-emerald-400 hover:underline">
              support@yourapp.com
            </a>
            .
          </p>
        </div>

        {/* ───── Danger Zone ───── */}
        <div className="bg-red-800/50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold text-red-400">Danger Zone</h3>
          <p className="text-sm text-red-300 mt-1">Deleting your account is permanent and cannot be undone.</p>
          <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <DialogTrigger asChild>
              <Button className="bg-red-600 mt-3 text-white">Delete Account</Button>
            </DialogTrigger>
            <DialogContent>
              <h3 className="text-lg text-white mb-2">Confirm Account Deletion</h3>
              <p className="text-sm text-gray-400 mb-4">Are you sure? This will permanently delete your account and all data.</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setShowDeleteDialog(false)}>
                  Cancel
                </Button>
                <Button className="bg-red-600 text-white" onClick={handleDeleteAccount}>
                  Confirm Delete
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
};

export default MyAccountTab;
