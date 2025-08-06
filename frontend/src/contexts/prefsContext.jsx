import React, { useState, useEffect } from "react";
export const PrefsContext = React.createContext(null);
import { getPrefs } from "../utils/api";

export function PrefsProvider({ children }) {
  const [prefs, set] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const p = await getPrefs("default");
        set(p || {});
      } catch {
        set({});
      }
    })();
  }, []);

  return <PrefsContext.Provider value={prefs}>{children}</PrefsContext.Provider>;
}
