// Default to an empty string when VITE_API_BASE_URL is undefined.
// We rely on authFetch for all API calls, which automatically attaches
// cookies and CSRF tokens and does not inject a Bearer header.
const BASE = import.meta.env.VITE_API_BASE_URL || "";
import { authFetch } from "./authFetch";

export async function launchMultiStrategyBot(config) {
  try {
    const res = await authFetch(`/api/launch-multi`, {
      method: "POST",
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error("Failed to launch multi-strategy bot");
    return await res.json();
  } catch (err) {
    console.error("❌ Multi-strategy launch failed:", err.message);
    throw err;
  }
}


  export function buildMultiStrategyConfig(selectedStrategies, configsByStrategy) {
    const payload = {};
  
    for (const strategy of selectedStrategies) {
      if (configsByStrategy[strategy]) {
        payload[strategy] = {
          ...configsByStrategy[strategy],
          enabled: true,
        };
      }
    }
  
    return payload;
  }