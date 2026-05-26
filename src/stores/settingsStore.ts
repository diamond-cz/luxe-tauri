import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Settings } from "@/types/ipc";

const DEFAULT_SETTINGS: Settings = {
  close_behavior: 0,
  language:       0,
  theme:          "dark",
  scale:          100,
  cache_path:     "",
  auto_update:    false,
  update_notify:  true,
};

interface SettingsState {
  settings: Settings;
  setSettings: (next: Settings) => void;
  patch: (patch: Partial<Settings>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  immer((set) => ({
    settings: DEFAULT_SETTINGS,
    setSettings: (next) => set((s) => { s.settings = { ...DEFAULT_SETTINGS, ...next }; }),
    patch: (patch) => set((s) => { s.settings = { ...s.settings, ...patch }; }),
  }))
);
