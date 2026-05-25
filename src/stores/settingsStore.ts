import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Settings } from "@/types/ipc";

interface SettingsState {
  settings: Settings;
  setSettings: (next: Settings) => void;
  patch: (patch: Partial<Settings>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  immer((set) => ({
    settings: { close_behavior: 0, language: 0, theme: "dark" },
    setSettings: (next) => set((s) => { s.settings = next; }),
    patch: (patch) => set((s) => { s.settings = { ...s.settings, ...patch }; }),
  }))
);
