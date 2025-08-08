import { create } from "zustand";

// Maximum number of log entries to retain.  When the buffer exceeds this
// threshold older entries will be discarded.  A hard cap helps
// prevent unbounded memory growth when logs are streamed at a high
// volume.  Increased to 1 000 to support longer sessions while
// remaining well under the 10 MB memory budget (approx. ~10kB per
// thousand small log messages).
const MAX_LOGS = 1000;

export const useLogsStore = create((set) => ({
  logs: [],
  /**
   * Append a log entry to the store.  If the number of logs
   * exceeds MAX_LOGS the oldest entries are truncated so that at
   * most MAX_LOGS remain.  This prevents the logs array from
   * ballooning in memory during long sessions.
   *
   * @param {any} log The parsed log object to store
   */
  push: (log) =>
    set((state) => {
      const next = [...state.logs, log];
      return {
        logs:
          next.length > MAX_LOGS
            ? next.slice(next.length - MAX_LOGS)
            : next,
      };
    }),
  /**
   * Clear all logs from the store.
   */
  clear: () => set({ logs: [] }),
}));