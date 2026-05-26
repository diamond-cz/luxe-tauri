import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Shortcuts } from "@/types/ipc";

interface ShortcutState {
  shortcuts: Shortcuts;
  setAll:    (next: Shortcuts) => void;
  patch:     (action: keyof Shortcuts, accel: string) => void;
}

export const useShortcutStore = create<ShortcutState>()(
  immer((set) => ({
    shortcuts: { home: "", settings: "", exit: "", poetry: "" },
    setAll: (next) => set((s) => { s.shortcuts = next; }),
    patch:  (action, accel) => set((s) => { s.shortcuts[action] = accel; }),
  })),
);
