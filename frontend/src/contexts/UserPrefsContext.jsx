import { createContext, useContext, useState, useEffect } from "react";
import { getPrefs, savePrefs } from "@/utils/api";

const CTX = "default";           
const PREF_KEY = "userPrefs";

const UserPrefsContext = createContext(null);

export function UserPrefsProvider({ children }) {
  const [prefs, setPrefs] = useState(null);

  // initial load
  useEffect(() => {
    (async () => {
      const stored = JSON.parse(localStorage.getItem(PREF_KEY) || "null") ?? {};
      let initial  = { ...defaults, ...stored };

      try {
        const remote = await getPrefs(CTX);
        initial = { ...initial, ...remote };
      } catch {/* silent */}

      setPrefs(initial);
    })();
  }, []);

  // upsert + localStorage sync
  const updatePrefs = async (next) => {
    setPrefs(next);
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
    try {
      await savePrefs(CTX, next);
    } catch {
      console.warn("⚠️ savePrefs failed; will retry on next mutation");
    }
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

const defaults = {
  defaultMaxSlippage: 1.0,
  defaultPriorityFee: 1_000,
  confirmManual     : true,
  confirmBotStart   : true,
  confirmBeforeTrade: true,
  alertsEnabled     : true,
  autoBuy           : { enabled: false, amount: 0.05 },
  slippage          : 1.0,
};
