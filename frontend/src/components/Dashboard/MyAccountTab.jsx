import React, { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { Info, CheckCircle, Shield, Timer, Lock, Unlock, Power } from "lucide-react";
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

// 🔐 Encrypted Wallet Session helpers
import {
  getArmStatus,
  armEncryptedWallet,
  extendEncryptedWallet,
  disarmEncryptedWallet,
  setRequireArmToTrade,
  formatCountdown,
  setupWalletProtection,
  removeWalletProtection,
} from "@/utils/encryptedWalletSession";

// Confirmation modal for potentially destructive actions (e.g. overwriting
// pass‑phrases on other wallets). We import the helper which renders a
// ConfirmModal on demand and returns a promise resolved with the user's
// choice. See src/hooks/useConfirm.jsx for implementation.
import { openConfirmModal } from "@/hooks/useConfirm";
import { useLocation } from "react-router-dom";

const PRE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

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
  const [require2faLogin, setRequire2faLogin] = useState(false); // ★ NEW
  const [require2faArm, setRequire2faArm] = useState(false);   // ★ NEW
  const [hasGlobalPassphrase, setHasGlobalPassphrase] = useState(false); // ★ NEW
  const [armUseForAll, setArmUseForAll] = useState(false);     // ★ NEW
  const [armPassphraseHint, setArmPassphraseHint] = useState("");      // ★ NEW
  const [qrCodeUrl, setQrCodeUrl] = useState(null);
  const [twoFAToken, setTwoFAToken] = useState("");
  const inputRef = useRef(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [twoFASuccess, setTwoFASuccess] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);

  const [showPhantom, setShowPhantom] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswordForm, setShowPasswordForm] = useState(false);

  // 🔐 Protected Mode + Arm modal state
  const [requireArm, setRequireArm] = useState(false);
  const [armStatus, setArmStatus] = useState({ armed: false, msLeft: 0 });
  const [warned, setWarned] = useState(false); // pre-expiry toast guard

  const [armModalOpen, setArmModalOpen] = useState(false);
  const [armPassphrase, setArmPassphrase] = useState("");
  const [armDuration, setArmDuration] = useState(240); // minutes: 4h default
  const [armMigrateLegacy, setArmMigrateLegacy] = useState(false);
  const [armBusy, setArmBusy] = useState(false);
  const [extendBusy, setExtendBusy] = useState(false);
  const [disarmBusy, setDisarmBusy] = useState(false);

  // Additional state for pass‑phrase confirmation on first arm and
  // destructive overwrites
  const [armPassphraseConfirm, setArmPassphraseConfirm] = useState("");
  const [forceOverwrite, setForceOverwrite] = useState(false);

  /* ───────── Derived helpers ───────── */
  // Determine whether the currently active wallet has its own pass‑phrase.
  // We attempt to infer this from multiple potential fields on the wallet.
  // Some API responses expose a boolean `hasPassphrase` flag, while others
  // surface a `passphraseHash` property.  If either value is truthy we
  // consider the wallet protected.  We intentionally coalesce to false
  // when these fields are undefined to avoid incorrectly marking a wallet
  // as unprotected.  If the user has a global pass‑phrase (hasGlobalPassphrase)
  // then the wallet is also effectively protected.
  const activeWalletHasPassphrase = !!(
    activeWallet?.hasPassphrase ||
    // Some endpoints expose `passphraseHash` instead of `hasPassphrase`.  A
    // non‑null/undefined value indicates a wallet-level passphrase.
    (activeWallet?.passphraseHash !== null && activeWallet?.passphraseHash !== undefined) ||
    // Fallback: Prisma may expose an `isProtected` flag when a pass‑phrase or
    // default pass‑phrase is set.  Treat this as protected if true.
    activeWallet?.isProtected
  );
  const armMode = (!activeWalletHasPassphrase && !hasGlobalPassphrase) ? "firstTime" : "existing";

  /**
   * handleUseForAllToggle
   * Invoked when the user toggles the "Use for ALL wallets" checkbox. If
   * the checkbox is being turned on and there are existing wallets with
   * custom pass‑phrases, a confirmation dialog is shown. If the user
   * proceeds we set forceOverwrite=true so that the backend overwrites
   * those wallets; otherwise we revert the toggle. When toggling off or
   * when no custom wallets exist, forceOverwrite is reset.
   *
   * @param {boolean} checked - The new state of the checkbox
   */
  const handleUseForAllToggle = async (checked) => {
    if (checked) {
      // Count wallets (excluding active) that already have a custom pass‑phrase.  When
      // available we inspect `hasPassphrase` directly; otherwise fall back to
      // examining a non‑null `passphraseHash`.  Some clients may also expose
      // an `isProtected` flag which serves the same purpose.  Any truthy
      // value indicates a wallet is already protected and will be overwritten
      // if the user chooses to apply the new pass‑phrase to all wallets.
      const customCount = wallets.filter((w) => {
        if (w.id === activeWallet?.id) return false;
        const hasCustom = w.hasPassphrase ||
          (w.passphraseHash !== null && w.passphraseHash !== undefined) ||
          w.isProtected;
        return !!hasCustom;
      }).length;
      if (customCount > 0) {
        const ok = await openConfirmModal(
          `This will overwrite the pass‑phrase on ${customCount} wallet${customCount > 1 ? 's' : ''}. Proceed?`
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
    // Either toggling off or no custom wallets
    setArmUseForAll(checked);
    setForceOverwrite(false);
  };

  /* ───────── Helpers ───────── */
  const { type, phantomPublicKey } = useUser();
  const isWeb3 = type === "web3";
  

  /* ───────── Focus token field when QR shows ───────── */
  useEffect(() => {
    if (qrCodeUrl && inputRef.current) inputRef.current.focus();
  }, [qrCodeUrl]);

  /* ───────── Fetch data ───────── */
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

      // Fix email/username swap for web users
      if (type !== "web3") {
        if (!profileData.email && profileData.username?.includes("@")) {
          profileData.email = profileData.username;
          profileData.username = "";
        }
      } else {
        profileData.email = null;
        profileData.username = null;
      }

      setProfile(profileData || null);
      // We'll fetch additional auth details (2FA toggles, global passphrase)
      // from /api/auth/me below. Fallback to profileData for basic info.
      setIs2FAEnabled(profileData?.is2FAEnabled || false);
      setRequire2faLogin(!!profileData?.require2faLogin);
      setRequireArm(!!profileData?.requireArmToTrade);

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
  }, []);

  // Load extended auth info (2FA toggles, global passphrase) on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch('/api/auth/me', { method: 'GET' });
        if (!res.ok) return;
        const data = await res.json();
        const u = data?.user;
        if (u) {
          setIs2FAEnabled(!!u.is2FAEnabled);
          setRequire2faLogin(!!u.require2faLogin);
          setRequire2faArm(!!u.require2faArm);
          setRequireArm(!!u.requireArmToTrade);
          setHasGlobalPassphrase(!!u.hasGlobalPassphrase);
        }
      } catch (err) {
        console.error('Failed to load auth/me:', err);
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

  

  // ⏱️ Local 1-second countdown between polls + pre-expiry toast at T-15m
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

  /* ───────── Profile actions ───────── */
  const handleSaveProfile = async () => {
    if (await updateProfile(profile)) toast.success("Profile updated.");
    else toast.error("Failed to update profile.");
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword)
      return toast.error("Fill out every password field.");

    if (newPassword !== confirmPassword)
      return toast.error("New passwords do not match.");

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

  /* ───────── 2FA actions ───────── */
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


    /* ───────── Toggles ───────── */
  const handleToggleLogin2FA = async () => {                         // ★ NEW
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
  }

  // Toggle requiring 2FA when arming a wallet
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

  /* ───────── Protected Mode actions ───────── */
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
    // When arming we require 2FA only if the user has enabled 2FA and
    // require2faArm is on. Simply enabling 2FA isn't enough; the arm
    // requirement gate is a separate toggle.
    // If the user has requested 2FA for arm/unlock and they haven't set up 2FA
    // yet, block unlocking existing wallets.  However, initial pass‑phrase
    // setup should not require enabling 2FA.
    if (armMode !== "firstTime" && require2faArm && !is2FAEnabled) {
      return toast.error("Enable 2FA before you can arm this wallet. Go to the Security tab to set up 2FA.");
    }
    setArmModalOpen(true);
  };

  const handleArm = async () => {
    // Basic validation: pass‑phrase is required. On first arm ensure the
    // confirmation matches.
    if (!armPassphrase) {
      return toast.error("Enter your wallet pass‑phrase.");
    }
    if (armMode === "firstTime") {
      if (!armPassphraseConfirm) {
        return toast.error("Confirm your pass‑phrase.");
      }
      if (armPassphrase !== armPassphraseConfirm) {
        return toast.error("Pass‑phrases do not match.");
      }
    }
    // If 2FA is required but no token provided, abort early.  Two‑factor
    // authentication is only enforced when unlocking an existing wallet.
    if (armMode !== "firstTime" && require2faArm && is2FAEnabled && !twoFAToken) {
      return toast.error("Enter your 2FA code.");
    }
    setArmBusy(true);
    try {
      if (armMode === "firstTime") {
        // For first‑time setup we only protect the wallet; do not arm it yet.
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
        // Update local state to reflect that the wallet is now protected.  We
        // leave the session unarmed so the user must explicitly unlock.
        setArmStatus({ armed: false, msLeft: 0 });
        setWarned(false);
        setArmModalOpen(false);
        // Clear form fields
        setArmPassphrase("");
        setArmPassphraseConfirm("");
        setTwoFAToken("");
        setArmUseForAll(false);
        setForceOverwrite(false);
        setArmPassphraseHint("");
        // Update wallet state locally so that the UI switches to existing mode
        if (activeWallet) {
          setActiveWallet((prev) =>
            prev && prev.id === activeWallet.id
              ? {
                  ...prev,
                  isProtected: true,
                  hasPassphrase: true,
                  passphraseHash: prev.passphraseHash || "set",
                }
              : prev,
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
                : w,
            ),
          );
        }
        // If the user applied the pass‑phrase globally, flag global state
        if (armUseForAll) {
          setHasGlobalPassphrase(true);
        }
        toast.success(
          armUseForAll
            ? "Pass‑phrase applied to all wallets. Your wallets are now protected."
            : "Wallet protected. Unlock when you’re ready to trade."
        );
      } else {
        const res = await armEncryptedWallet({
          walletId: activeWallet.id,
          passphrase: armPassphrase,
          twoFactorToken:
            armMode !== "firstTime" && require2faArm && is2FAEnabled
              ? twoFAToken
              : undefined,
          ttlMinutes: armDuration,
          migrateLegacy: armMigrateLegacy,
          applyToAll: armUseForAll,
          passphraseHint: undefined,
          forceOverwrite,
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
      // If the backend signals that 2FA is required (needs2FA) or returns
      // a 403 Forbidden status, show a dedicated toast rather than a generic
      // error. The underlying httpJson helper surfaces only the message,
      // but our 2FA middleware returns an object without an `error` field,
      // which results in the generic status text "Forbidden". We treat
      // both markers as an indicator that 2FA setup is required.
      const msg = e.message || "";
      if (/needs2FA/i.test(msg) || /forbidden/i.test(msg)) {
        toast.error(
          "Enable 2FA before you can arm this wallet. Visit the Security tab."
        );
      } else {
        toast.error(msg || (armMode === "firstTime" ? "Failed to set up protection." : "Failed to arm."));
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
      setArmStatus((prev) => ({ armed: true, msLeft: Math.max(prev.msLeft, 0) + minutes * 60 * 1000 }));
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

  /**
   * Remove pass‑phrase protection from the currently active wallet.  This will
   * prompt the user for the current pass‑phrase and then call the backend
   * API to remove protection.  After success the local state is updated to
   * reflect an unprotected wallet and the requireArm flag is cleared.
   */
  const handleRemoveProtection = async () => {
    if (!activeWallet?.id) return toast.error("No active wallet selected.");
    // Confirm intent
    const ok = await openConfirmModal(
      "Remove protection from this wallet? This will allow bots to trade without unlocking."
    );
    if (!ok) return;
    const passphrase = window.prompt("Enter current wallet pass‑phrase to remove protection:");
    if (!passphrase) {
      toast.error("Pass‑phrase required to remove protection.");
      return;
    }
    try {
      await removeWalletProtection({ walletId: activeWallet.id, passphrase });
      // Reset Protected Mode requirement at user level
      try {
        await setRequireArmToTrade(false);
      } catch {}
      setRequireArm(false);
      // Reload wallet list to update protection flags
      const [allWallets, activeW] = await Promise.all([
        loadWallet(),
        fetchActiveWallet(),
      ]);
      setWallets(allWallets || []);
      setActiveWallet(activeW || null);
      toast.success("Protection removed.");
    } catch (e) {
      toast.error(e.message || "Failed to remove protection.");
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

      {/* 🔐 Armed banner (sticky-ish) */}
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
            <Button
              className="bg-red-600 text-white"
              disabled={disarmBusy}
              onClick={handleDisarm}
            >
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
            {/* Web users: email + username */}
            {!isWeb3 && (
              <>
                <label>Email (read-only)</label>
                <input
                  type="email"
                  value={profile.email || ""}
                  disabled
                  className="w-full p-2 rounded"
                />

                <label>Username</label>
                <input
                  type="text"
                  value={profile.username || ""}
                  onChange={(e) =>
                    setProfile((prev) => ({ ...prev, username: e.target.value }))
                  }
                  className="w-full p-2 rounded"
                />
              </>
            )}

            {/* Web3 users: Phantom public key only */}
            {isWeb3 && (
              <>
                <label>Phantom Wallet</label>
                <div className="flex justify-between items-center bg-zinc-900 border border-zinc-700 p-2 rounded font-mono text-xs text-emerald-400">
                  <span className="truncate">
                    {showPhantom ? phantomPublicKey : "●●●●●●●●●●●●●●●●●●●"}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowPhantom(!showPhantom)}
                      className="text-zinc-400 hover:text-white"
                    >
                      {showPhantom ? "Hide" : "Show"}
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(phantomPublicKey);
                        toast.success("Phantom pubkey copied");
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
              <Button
                onClick={handleSaveProfile}
                className="mt-2 bg-emerald-600 text-white"
              >
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
              <button
                onClick={() => setShowPasswordForm((prev) => !prev)}
                className="text-sm text-emerald-400 hover:underline"
              >
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
                <Button
                  onClick={handleChangePassword}
                  className="bg-emerald-600 text-white"
                >
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
          <a
            href="/wallets"
            className="inline-block mt-2 text-emerald-400 hover:underline text-sm"
          >
            Manage Wallets →
          </a>
        </div>

        {/* 🔐 Wallet Protection (Protected Mode) */}
        <div className="bg-zinc-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Shield size={18} />
            Wallet Protection
          </h3>
          {/* Explanation text for wallet protection and arming */}
          <p className="text-sm text-zinc-400 mt-1">
            Protect this wallet with a passphrase so bots can’t auto‑trade unless you unlock it.
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            <strong>What is Arming?</strong> Arming unlocks your wallet for bot trading without exposing your private key. You control when the bot is allowed to trade by entering your passphrase and 2FA (if enabled). It lasts a few hours and auto‑locks again when it expires.
          </p>

          <div className="mt-3 flex items-center justify-between">
            {/* Left side: show Remove Protection when wallet is protected */}
            <div className="text-sm flex items-center">
              {activeWalletHasPassphrase || hasGlobalPassphrase ? (
                <Button
                  variant="outline"
                  className="border-red-500 text-red-400 text-xs px-3 py-1"
                  onClick={handleRemoveProtection}
                >
                  Remove Protection
                </Button>
              ) : (
                <span className="text-zinc-500 text-xs">Protection not set</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {!armStatus.armed ? (
                armMode === "firstTime" ? (
                  <Button
                    className="bg-emerald-600 text-white"
                    onClick={handleOpenArm}
                  >
                    <Lock className="mr-1" size={16} />
                    Set Up Protection
                  </Button>
                ) : (
                  <Button
                    className="bg-emerald-600 text-white"
                    onClick={handleOpenArm}
                  >
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
        <Dialog open={armModalOpen} onOpenChange={setArmModalOpen}>
          <DialogContent>
            <h3 className="text-xl font-bold mb-2">
              {armMode === "firstTime" ? "Set Up Wallet Protection" : "Unlock Wallet"}
            </h3>
            <p className="text-sm text-zinc-400 mb-4">
              {armMode === "firstTime"
                ? (
                    <>
                      Protect this wallet with a passphrase so bots can’t auto‑trade unless you unlock it. Enter and confirm your passphrase below. This is a one‑time setup for this wallet (or apply it to all wallets).
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
                  <label className="text-sm">Pass‑phrase</label>
                  <input
                    type="password"
                    placeholder="Wallet pass‑phrase"
                    value={armPassphrase}
                    onChange={(e) => setArmPassphrase(e.target.value)}
                    className="w-full p-2 rounded text-black"
                  />
                  <label className="text-sm">Confirm Pass‑phrase</label>
                  <input
                    type="password"
                    placeholder="Confirm pass‑phrase"
                    value={armPassphraseConfirm}
                    onChange={(e) => setArmPassphraseConfirm(e.target.value)}
                    className="w-full p-2 rounded text-black"
                  />
                  {/* Global pass‑phrase option on first arm */}
                  {hasGlobalPassphrase ? (
                    <div className="flex flex-col gap-1">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked disabled />
                        Use this pass‑phrase for all my current and future wallets
                      </label>
                      <p className="text-xs text-zinc-500">
                        New wallets will inherit your saved pass‑phrase automatically.
                      </p>
                    </div>
                  ) : (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={armUseForAll}
                        onChange={(e) => handleUseForAllToggle(e.target.checked)}
                      />
                      Use this pass‑phrase for all my current and future wallets
                    </label>
                  )}
                  <label className="text-sm">Pass‑phrase Hint (optional)</label>
                  <input
                    type="text"
                    placeholder="Hint (optional)"
                    value={armPassphraseHint}
                    onChange={(e) => setArmPassphraseHint(e.target.value)}
                    className="w-full p-2 rounded text-black"
                  />
                  <p className="text-xs text-amber-400">
                    ⚠️ You will never see this pass‑phrase again. Save it in a password manager.
                  </p>
                </>
              )}

              {armMode === "existing" && (
                <>
                  <label className="text-sm">Pass‑phrase</label>
                  <input
                    type="password"
                    placeholder="Wallet pass‑phrase"
                    value={armPassphrase}
                    onChange={(e) => setArmPassphrase(e.target.value)}
                    className="w-full p-2 rounded text-black"
                  />
                </>
              )}

              {/* 2FA Code: show only when unlocking and required */}
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

              {/* Duration selector: only shown when unlocking */}
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

              {/* Legacy migration option (hide on first arm) */}
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

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setArmModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  className="bg-emerald-600 text-white"
                  onClick={handleArm}
                  disabled={armBusy}
                >
                  {armBusy
                    ? armMode === "firstTime"
                      ? "Saving…"
                      : "Unlocking…"
                    : armMode === "firstTime"
                    ? "Set Up Protection"
                    : "Unlock"}
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
          <a
            href="/payments"
            className="inline-block mt-2 text-emerald-400 hover:underline text-sm"
          >
            Manage Subscription →
          </a>
        </div>

        {/* ───── Telegram Alerts ───── */}
        <div className="bg-zinc-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold flex items-center gap-2">📲 Telegram Alerts</h3>
          {telegramChatId ? (
            <p className="text-sm mt-1">
              Connected to Chat ID:{" "}
              <span className="text-emerald-400">@{telegramChatId}</span>
            </p>
          ) : (
            <p className="text-sm mt-1 text-red-400">Not connected</p>
          )}
          <a
            href="/telegram"
            className="inline-block mt-2 text-emerald-400 hover:underline text-sm"
          >
            {telegramChatId ? "Manage Alerts →" : "Set up Alerts →"}
          </a>
        </div>

        {/* ───── Two-Factor Auth ───── */}
        <div className="bg-zinc-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            🔒 Two-Factor Authentication
          </h3>

          {is2FAEnabled ? (
            <>
              <p className="text-sm mt-1 text-emerald-400">
                2FA is enabled on your account.
              </p>

              {/* 2FA toggles */}
              <div className="flex flex-col gap-2 mt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={require2faLogin}
                    onChange={handleToggleLogin2FA}
                  />
                  <span>Require 2FA on Login (extra secure)</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={require2faArm}
                    onChange={handleToggleArm2FA}
                  />
                  <span>Require 2FA when arming (Arm‑to‑Trade)</span>
                </label>
              </div>

              <Dialog open={disableDialogOpen} onOpenChange={setDisableDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    className="mt-2 bg-red-600 text-white"
                    onClick={() => setDisableDialogOpen(true)}
                  >
                    Disable 2FA
                  </Button>
                </DialogTrigger>

                <DialogContent>
                  <h3 className="text-lg text-white mb-2">Confirm Disable 2FA</h3>
                  <p className="text-sm text-gray-400 mb-4">
                    Are you sure you want to disable two-factor authentication?
                  </p>
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
              <Button
                className="mt-2 bg-emerald-600 text-white"
                onClick={handleEnable2FA}
              >
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
                  <p className="text-zinc-400 mb-6 text-center max-w-xs">
                    Your two-factor authentication is now active.
                  </p>
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
                  <p className="text-sm text-zinc-400 mb-4">
                    Scan this QR in Google Authenticator and enter the 6-digit code
                    below.
                  </p>
                  <img src={qrCodeUrl} alt="2FA QR" className="mb-4 rounded shadow" />

                  {recoveryCodes.length > 0 && (
                    <div className="mb-4">
                      <h4 className="text-md font-semibold text-emerald-400 mb-2">
                        Backup Recovery Codes
                      </h4>
                      <p className="text-xs text-zinc-400 mb-2">
                        Store these safely. Each can be used once if you lose your
                        Authenticator.
                      </p>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {recoveryCodes.map((code) => (
                          <div
                            key={code}
                            className="bg-zinc-900 p-2 rounded text-center text-white font-mono text-sm"
                          >
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
                  <Button
                    onClick={handleVerify2FA}
                    className="w-full bg-emerald-600 text-white"
                  >
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
            <a
              href="mailto:support@yourapp.com"
              className="text-emerald-400 hover:underline"
            >
              support@yourapp.com
            </a>
            .
          </p>
        </div>

        {/* ───── Danger Zone ───── */}
        <div className="bg-red-800/50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold text-red-400">Danger Zone</h3>
          <p className="text-sm text-red-300 mt-1">
            Deleting your account is permanent and cannot be undone.
          </p>
          <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <DialogTrigger asChild>
              <Button className="bg-red-600 mt-3 text-white">Delete Account</Button>
            </DialogTrigger>
            <DialogContent>
              <h3 className="text-lg text-white mb-2">Confirm Account Deletion</h3>
              <p className="text-sm text-gray-400 mb-4">
                Are you sure? This will permanently delete your account and all data.
              </p>
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

      {/* 🔘 Floating Arm Status Chip
          Show only when the current wallet is protected (either has its own
          passphrase or inherits a global passphrase).  If the wallet is not
          protected at all, hide the Arm button entirely to avoid confusing
          users when protection has not yet been set up. */}
      { (activeWalletHasPassphrase || hasGlobalPassphrase) && (
        <ArmStatusChip
          armed={armStatus.armed}
          msLeft={armStatus.msLeft}
          onExtend={() => handleExtend(120)}
          onDisarm={handleDisarm}
          onArm={handleOpenArm}
          busy={extendBusy || disarmBusy}
        />
      ) }
    </div>
  );
};

export default MyAccountTab;

/* ==========================================================
   Small, floating status chip for quick extend / disarm
   ========================================================== */
function ArmStatusChip({ armed, msLeft, onExtend, onDisarm, onArm, busy }) {
  return (
    <div className="fixed bottom-6 right-6 z-[9998]">
      {!armed ? (
        <button
          onClick={onArm}
          className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-emerald-700"
          title="Arm-to-Trade"
        >
          <Power size={16} />
          Arm
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-full bg-emerald-700/90 px-3 py-2 text-sm text-white shadow-lg">
          <Timer size={16} />
          <span className="font-mono">{formatCountdown(msLeft)}</span>
          <button
            onClick={onExtend}
            disabled={busy}
            className="rounded-full bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-50"
            title="Extend +2h"
          >
            +2h
          </button>
          <button
            onClick={onDisarm}
            disabled={busy}
            className="rounded-full bg-red-600 px-2 py-1 text-xs hover:bg-red-700 disabled:opacity-50"
            title="Disarm"
          >
            Disarm
          </button>
        </div>
      )}
    </div>
  );
}
