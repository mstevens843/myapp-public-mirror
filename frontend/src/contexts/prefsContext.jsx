// src/contexts/PrefsContext.jsx
import React, { useState, useEffect } from "react";
export const PrefsContext = React.createContext(null);
import { getPrefs } from "../utils/api";

export function PrefsProvider({ children }) {
  const [prefs, set] = useState(null);
  useEffect(() => { getPrefs("default").then(set); }, []);
  return <PrefsContext.Provider value={prefs}>{children}</PrefsContext.Provider>;
}
