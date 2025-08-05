import { authFetch } from "@/utils/authFetch";

/** POST /api/schedule/create */
export const scheduleStrategy = async ({
  name = null, 
  mode,
  config,
  launchISO,
  targetToken = null,
  limit = null,
  buyMode = "interval",
  walletId = null,          // ✅ NEW
  walletLabel = null,       // ✅ (optional fallback)
}) => {    
  const res = await authFetch("/api/schedule/create", {
    method: "POST",
  body: JSON.stringify({  name, mode, config, launchISO, targetToken, limit, buyMode, walletId, walletLabel }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to schedule strategy");
  return data; // { ok: true, jobId }
};

/** POST /api/schedule/cancel */
export const cancelSchedule = async (jobId) => {
  const res = await authFetch("/api/schedule/cancel", {
    method: "POST",
    body: JSON.stringify({ jobId }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to cancel schedule");
  return data;
};

/** GET /api/schedule/list */
export const listSchedules = async () => {
  const res = await authFetch("/api/schedule/list");
  if (!res.ok) throw new Error("Failed to fetch schedules");
  return res.json(); // { jobs: [...] }
};

/** POST /api/schedule/update */
export const editSchedule = async (payload) => {
  const res = await authFetch("/api/schedule/update", {
    method: "PUT",
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to edit schedule");
  return data;
};
