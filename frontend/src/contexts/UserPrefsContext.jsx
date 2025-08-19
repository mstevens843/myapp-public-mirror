// UserPrefsContext.jsx
import { createContext, useContext, useState, useEffect } from "react";
import { getPrefs, savePrefs } from "@/utils/api";

const CTX = "default";
const PREF_KEY = "userPrefs";

const defaults = {
  defaultMaxSlippage: 1.0,
  defaultPriorityFee: 1_000,       // μLAM (int)
  confirmManual     : true,
  confirmBotStart   : true,
  confirmBeforeTrade: true,
  alertsEnabled     : true,
  autoBuy           : { enabled: false, amount: 0.05 },
  slippage          : 1.0,
  mevMode           : "fast",
  briberyAmount     : 0,           // in SOL on the client
};

function safeParse(raw) {
  if (raw == null) return null;
  if (raw === "undefined" || raw === "null" || raw === "") return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}
function loadLocal() {
  const parsed = safeParse(localStorage.getItem(PREF_KEY));
  if (parsed === null) {
    localStorage.removeItem(PREF_KEY);
    return {};
  }
  return parsed;
}
function normalize(p) {
  const src = { ...(p || {}) };
  const autoBuy = {
    enabled: !!(src.autoBuy?.enabled ?? src.autoBuyEnabled ?? defaults.autoBuy.enabled),
    amount : Number(src.autoBuy?.amount  ?? src.autoBuyAmount  ?? defaults.autoBuy.amount) || 0,
  };
  return {
    ...defaults,
    ...src,
    autoBuy,
    slippage           : Number(src.slippage ?? defaults.slippage) || defaults.slippage,
    defaultMaxSlippage : Number(src.defaultMaxSlippage ?? defaults.defaultMaxSlippage) || defaults.defaultMaxSlippage,
    defaultPriorityFee : Number(src.defaultPriorityFee ?? defaults.defaultPriorityFee) || defaults.defaultPriorityFee,
    briberyAmount      : Number(src.briberyAmount ?? defaults.briberyAmount) || 0,
    mevMode            : src.mevMode === "secure" ? "secure" : "fast",
    alertsEnabled      : !!(src.alertsEnabled ?? defaults.alertsEnabled),
    confirmBeforeTrade : !!(src.confirmBeforeTrade ?? defaults.confirmBeforeTrade),
  };
}
// Flatten to the backend's expected shape.
// Note: Your backend currently stores briberyAmount as Int; if you want SOL decimals,
// switch the DB column to Float/Decimal or convert to lamports here.
function toServerShape(p) {
  return {
    confirmBeforeTrade : p.confirmBeforeTrade,
    alertsEnabled      : p.alertsEnabled,
    slippage           : p.slippage,
    defaultMaxSlippage : p.defaultMaxSlippage,
    defaultPriorityFee : p.defaultPriorityFee,
    mevMode            : p.mevMode,
    briberyAmount      : p.briberyAmount, // ⚠ see note above
    autoBuy            : { enabled: !!p.autoBuy?.enabled, amount: Number(p.autoBuy?.amount || 0) },
  };
}

const UserPrefsContext = createContext(null);

export function UserPrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(null);

  // Single source of truth bootstrapping
  useEffect(() => {
    (async () => {
      const local = normalize(loadLocal());
      let merged = local;
      try {
        const remote = await getPrefs(CTX); // {} if not found
        if (remote && typeof remote === "object") {
          merged = normalize({ ...local, ...remote });
        }
      } catch { /* ignore offline */ }
      setPrefs(merged);
      try { localStorage.setItem(PREF_KEY, JSON.stringify(merged)); } catch {}
    })();
  }, []);

  // Accept object OR function
  const updatePrefs = (nextOrFn) => {
    setPrefs((prev) => {
      const rawNext = typeof nextOrFn === "function" ? nextOrFn(prev) : nextOrFn;
      const next = normalize(rawNext);
      try { localStorage.setItem(PREF_KEY, JSON.stringify(next)); } catch {}
      // fire-and-forget server save; it upserts
      savePrefs(CTX, toServerShape(next)).catch(() =>
        console.warn("⚠️ savePrefs failed; will retry on next mutation")
      );
      return next;
    });
  };

  return (
    <UserPrefsContext.Provider value={{ prefs, setPrefs, updatePrefs }}>
      {children}
    </UserPrefsContext.Provider>
  );
}

export function useUserPrefs() {
  return useContext(UserPrefsContext);
}
