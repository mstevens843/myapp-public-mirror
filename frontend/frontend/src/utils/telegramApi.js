// utils/telegramApi.js  —  v3  (alert‑types parity w/ backend)

import { authFetch } from "@/utils/authFetch";

/* ---------- POST /api/telegram/set-chat-id ---------- */
export async function setTelegramChatId(chatId) {
  try {
    if (!chatId || typeof chatId !== "string") throw new Error("Invalid chat ID");

    const res = await authFetch("/api/telegram/set-chat-id", {
      method: "POST",
      body: JSON.stringify({ chatId }),
    });
    return await res.json();
  } catch (err) {
    console.error("Failed to set chat ID:", err);
    return false;
  }
}

/* ---------- POST /api/telegram/test ---------- */
export async function sendTelegramTest() {
  try {
    const res = await authFetch("/api/telegram/test", { method: "POST" });
    return res.json();
  } catch (err) {
    console.error("Failed to send test message:", err);
    return null;
  }
}

/* ---------- GET /api/telegram/chat-id ---------- */
export async function getTelegramChatId() {
  try {
    const res = await authFetch("/api/telegram/chat-id");
    const { chatId } = await res.json();
    return chatId;
  } catch (err) {
    console.error("Failed to fetch Telegram Chat ID:", err);
    return null;
  }
}

/* ---------- GET /api/telegram/preferences ---------- */
export async function getTelegramPreferences() {
  try {
    const res = await authFetch("/api/telegram/preferences");
    return res.json();
  } catch (err) {
    console.error("Failed to fetch Telegram preferences:", err);
    // sensible defaults (Safety OFF)
    return {
      trade: true,
      orders: true,
      tpSl: true,
      autoBots: true,
      scheduled: true,
      safety: false,
    };
  }
}

/* ---------- POST /api/telegram/preferences ---------- */
export async function setTelegramPreferences(prefs) {
  try {
    if (!prefs || typeof prefs !== "object") throw new Error("Invalid preferences");

    const res = await authFetch("/api/telegram/preferences", {
      method: "POST",
      body: JSON.stringify(prefs),
    });
    return await res.json();
  } catch (err) {
    console.error("Failed to save Telegram preferences:", err);
    return false;
  }
}

/* ---------- POST /api/telegram/clear ---------- */
export async function disconnectTelegram() {
  try {
    const res = await authFetch("/api/telegram/clear", { method: "POST" });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    return res.json().catch(() => ({ success: true }));
  } catch (err) {
    console.error("Failed to disconnect Telegram:", err);
    throw err;
  }
}
