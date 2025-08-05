import { create } from "zustand";

export const useLogsStore = create((set) => ({
  logs: [],
  push: (log) => set((state) => ({ logs: [...state.logs, log] })),
  clear: () => set({ logs: [] }),
}));