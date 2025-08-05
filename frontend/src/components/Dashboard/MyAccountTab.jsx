import React, { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { Info, CheckCircle } from "lucide-react";
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

  const [is2FAEnabled, setIs2FAEnabled] = useState(false);
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

      const [
        profileData,
        subStatus,
        chatId,
        allWallets,
        activeW,
      ] = await Promise.all([
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
      setIs2FAEnabled(profileData?.is2FAEnabled || false);

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

  /* ───────── Profile actions ───────── */
  const handleSaveProfile = async () => {
    if (await updateProfile(profile)) toast.success("Profile updated.");
    else toast.error("Failed to update profile.");
  };

// ───────── handler ─────────
// ───────── handler ─────────
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
}
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

  /* ───────── Early returns ───────── */
  if (loading)  return <div className="p-6 text-white">Loading profile…</div>;
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

      <h2 className="text-2xl font-bold mb-4">My Account</h2>

      <div className="space-y-4">
        {/* ───────── Profile Information ───────── */}
        <div className="bg-zinc-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold">Profile Information</h3>
          <div className="mt-2 space-y-2">
            {/* Web users: email + username */}
            {!isWeb3 && (
              <>
                <label>Email (read‑only)</label>
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
                  {showPhantom
                    ? phantomPublicKey
                    : "●●●●●●●●●●●●●●●●●●●"}
=                  </span>
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

        {/* ───── Two‑Factor Auth ───── */}
        <div className="bg-zinc-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            🔒 Two‑Factor Authentication
          </h3>

          {is2FAEnabled ? (
            <>
              <p className="text-sm mt-1 text-emerald-400">
                2FA is enabled on your account.
              </p>

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
                    Are you sure you want to disable two‑factor authentication?
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
                    Your two‑factor authentication is now active.
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
                  <h3 className="text-xl font-bold mb-3">Setup Two‑Factor Auth</h3>
                  <p className="text-sm text-zinc-400 mb-4">
                    Scan this QR in Google Authenticator and enter the 6‑digit code
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
    </div>
  );
};

export default MyAccountTab;
