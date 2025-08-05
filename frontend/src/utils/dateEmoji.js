// utils/dateEmoji.js  (or inline helper)
export function dateKeycap(day) {
    return String(day)
      .split("")
      .map((d) => d + "\uFE0F\u20E3") // ➜  "1️⃣"
      .join("");
  }