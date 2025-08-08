// Default to an empty string when VITE_API_BASE_URL is undefined.  This
// ensures relative paths are used instead of "undefined/...".
const BASE = import.meta.env.VITE_API_BASE_URL || "";
export async function authFetch(url, options = {}) {
  const token = localStorage.getItem("accessToken") || sessionStorage.getItem("accessToken");
  // Auto add Authorization
  options.headers = {
    ...(options.headers || {}),
    "Authorization": `Bearer ${token}`,
    ...((options.method && options.method !== "GET") && { "Content-Type": "application/json" }),
  };
  return fetch(url, options);
}
 

export async function launchMultiStrategyBot(config) {
    try {
      const res = await authFetch(`${BASE}/api/launch-multi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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