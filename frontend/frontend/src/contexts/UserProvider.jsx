import { createContext, useContext, useEffect, useState } from "react";
import { getUserProfile } from "@/utils/api";
import { toast } from "sonner";
import { setOnNeedsArm, authFetch } from "@/utils/authFetch";

const UserContext = createContext(null);

export const UserProvider = ({ children }) => {
  const [profile, setProfile] = useState({});
  const [loading, setLoading] = useState(true);

  // 🔐 Arm-to-Trade modal state
  const [armPrompt, setArmPrompt] = useState(null); // { walletId, retry }
  const [arming, setArming] = useState(false);
  const [armError, setArmError] = useState(null);

  const refreshProfile = async () => {
    try {
      const data = await getUserProfile(); // ← /auth/me payload
      if (!data) return setLoading(false);

      // 🔥  FLATTEN EVERYTHING WE ACTUALLY NEED
      const flat = {
        ...data.user, // id, username, email, type, phantomPublicKey…
        plan:               data.plan?.plan,
        subscriptionStatus: data.plan?.subscriptionStatus,
        usage:              data.plan?.usage,
        usageResetAt:       data.plan?.usageResetAt,
        credits:            data.plan?.credits,
        preferences:        data.preferences,
        telegram:           data.telegram,
        activeWallet:       data.activeWallet,
        activeWalletId:     data.activeWallet?.id ?? null,
        wallets:            data.wallets ?? [],
        counts:             data.counts,
      };

      setProfile(flat);
    } catch (err) {
      console.error("❌ Failed to load user profile:", err);
      toast.error("Failed to load user profile.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refreshProfile(); }, []);

  // Register global 401→Arm handler
  useEffect(() => {
    setOnNeedsArm(({ walletId, retry }) => {
      setArmError(null);
      setArmPrompt({ walletId, retry });
    });
    return () => setOnNeedsArm(null);
  }, []);

  // Arm action from modal
  async function armNow({ passphrase, code2fa, minutes = 240 }) {
    if (!armPrompt?.walletId) return;
    setArming(true);
    setArmError(null);
    try {
      const res = await authFetch(`/api/automation/arm`, {
        method: "POST",
        body: JSON.stringify({
          walletId: armPrompt.walletId,
          passphrase,
          ttlMinutes: minutes,
          code2fa,
          migrateLegacy: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to arm session");

      // Auto-retry the original call that failed with needsArm
      const retry = armPrompt.retry;
      setArmPrompt(null);
      if (retry) await retry();
    } catch (e) {
      setArmError(e.message || "Failed to arm");
    } finally {
      setArming(false);
    }
  }

  return (
    <UserContext.Provider
      value={{
        ...profile,
        refreshProfile,
        loading,
        // expose a manual opener if you want to trigger from settings
        openArm: setArmPrompt,
      }}
    >
      {children}

      {/* Minimal, inline modal. Replace with your design system later. */}
      {armPrompt && (
        <ArmModal
          walletId={armPrompt.walletId}
          arming={arming}
          error={armError}
          onCancel={() => setArmPrompt(null)}
          onConfirm={(payload) => armNow(payload)} // { passphrase, code2fa, minutes }
        />
      )}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const ctx = useContext(UserContext);
  if (ctx === null) throw new Error("❌ useUser must be used inside a <UserProvider>");
  return ctx;
};

/* ------------ inline modal component ------------- */
function ArmModal({ walletId, arming, error, onCancel, onConfirm }) {
  const [passphrase, setPassphrase] = useState("");
  const [code2fa, setCode2fa] = useState("");
  const [minutes, setMinutes] = useState(240); // 2h=120, 4h=240 (default), 8h=480

  return (
    <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
        <h3 className="text-lg font-semibold">Start Secure Trading Session</h3>
        <p className="mt-1 text-sm text-gray-600">
          Unlock wallet <code>{walletId}</code> for a limited time. Keys stay in memory only; session auto-expires.
        </p>

        <div className="mt-4 space-y-3">
          <input
            type="password"
            placeholder="Wallet passphrase"
            className="w-full rounded-md border px-3 py-2"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <input
            type="text"
            placeholder="2FA code (if enabled)"
            className="w-full rounded-md border px-3 py-2"
            value={code2fa}
            onChange={(e) => setCode2fa(e.target.value)}
          />
          <select
            className="w-full rounded-md border px-3 py-2"
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          >
            <option value={120}>2 hours</option>
            <option value={240}>4 hours (default)</option>
            <option value={480}>8 hours</option>
          </select>

          {error && (
            <div className="rounded bg-red-50 p-2 text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="mt-2 flex items-center justify-end gap-2">
            <button className="rounded-md border px-3 py-2" onClick={onCancel} disabled={arming}>
              Cancel
            </button>
            <button
              className="rounded-md bg-black px-3 py-2 text-white disabled:opacity-50"
              onClick={() => onConfirm({ passphrase, code2fa, minutes })}
              disabled={arming || !passphrase}
            >
              {arming ? "Arming…" : "Arm & Retry"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
