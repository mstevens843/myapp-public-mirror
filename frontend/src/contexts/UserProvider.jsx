// UserProvider.jsx
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

  // -- helpers -------------------------------------------------------------

  // Normalize a login payload (which might be just a "user" object)
  // into the same "me" shape that /auth/me returns.
  const normalizeToMeShape = (raw) => {
    if (!raw) return null;

    // If it already looks like /auth/me (has top-level user)
    if (raw.user) {
      // Ensure top-level wallets/activeWallet are present if backend nests them
      const u = raw.user || {};
      const active =
        raw.activeWallet ||
        u.activeWallet ||
        (raw.wallets || u.wallets || []).find((w) => w.id === (u.activeWalletId ?? raw.activeWalletId)) ||
        null;

      return {
        ...raw,
        activeWallet: active ?? null,
        wallets: raw.wallets ?? u.wallets ?? [],
      };
    }

    // Otherwise assume it's a "user" object
    const u = raw;
    const wallets = u.wallets ?? [];
    const active =
      u.activeWallet ||
      wallets.find((w) => w.id === u.activeWalletId) ||
      null;

    return {
      user: u,
      plan: null,
      preferences: null,
      telegram: null,
      counts: null,
      activeWallet: active ?? null,
      wallets,
    };
  };

  const flattenProfile = (data) => {
    const active = data.activeWallet ?? null;
    const wallets = (data.wallets ?? []).map((w) => ({
      id: w.id,
      label: w.label,
      publicKey: w.publicKey,
      isProtected: !!w.isProtected,
      passphraseHint: w.passphraseHint || null,
    }));

    return {
      // everything from user (id, username, email, type, etc.)
      ...(data.user || {}),
      plan:               data.plan?.plan,
      subscriptionStatus: data.plan?.subscriptionStatus,
      usage:              data.plan?.usage,
      usageResetAt:       data.plan?.usageResetAt,
      credits:            data.plan?.credits,
      preferences:        data.preferences,
      telegram:           data.telegram,

      // active wallet (object + convenience flags)
      activeWallet: active
        ? {
            id:            active.id,
            label:         active.label,
            publicKey:     active.publicKey,
            isProtected:   !!active.isProtected,
            passphraseHint: active.passphraseHint || null,
          }
        : null,
      activeWalletId:    active?.id ?? (data.user?.activeWalletId ?? null),
      isWalletProtected: !!active?.isProtected,

      // full wallet list
      wallets,

      counts: data.counts,
    };
  };

  // Public: refresh from /auth/me (canonical source)
  const refreshProfile = async () => {
    try {
      const data = await getUserProfile(); // ← /auth/me payload
      if (!data) {
        setLoading(false);
        return;
      }
      const flat = flattenProfile(normalizeToMeShape(data));
      setProfile(flat);
    } catch (err) {
      console.error("❌ Failed to load user profile:", err);
      toast.error("Failed to load user profile.");
    } finally {
      setLoading(false);
    }
  };

  // Public: hydrate immediately from a login response (no fetch)
  const hydrateFromLogin = (raw) => {
    try {
      const normalized = normalizeToMeShape(raw);
      if (!normalized) return;
      const flat = flattenProfile(normalized);
      setProfile(flat);
    } catch (err) {
      console.error("❌ Failed to hydrate profile from login payload:", err);
    } finally {
      setLoading(false);
    }
  };

  // Initial load
  useEffect(() => {
    refreshProfile();
  }, []);

  // Listen for auth events so we can hydrate immediately on sign-in,
  // and clear state on sign-out.
  useEffect(() => {
    const onLogin = (e) => {
      // Accept either CustomEvent<{user:...}> or raw user/me-shape in detail
      const payload = e?.detail?.user ?? e?.detail ?? null;
      if (payload) {
        hydrateFromLogin(payload);
      } else {
        setLoading(true);
        refreshProfile();
      }
    };
    const onLogout = () => {
      setProfile({});
      setLoading(false);
    };

    window.addEventListener("auth:login", onLogin);
    window.addEventListener("auth:profile", onLogin); // optional: direct profile push
    window.addEventListener("auth:logout", onLogout);

    return () => {
      window.removeEventListener("auth:login", onLogin);
      window.removeEventListener("auth:profile", onLogin);
      window.removeEventListener("auth:logout", onLogout);
    };
  }, []);

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
        hydrateFromLogin, // 🆕 allow callers (login flow) to push profile directly
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
