import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { MainWindow } from "@/types/ipc";

interface WindowState {
  main_window: MainWindow;
  setMainWindow: (next: MainWindow) => void;
}

export const useWindowStore = create<WindowState>()(
  immer((set) => ({
    main_window: { width: 0, height: 0, screen_w: 0, screen_h: 0 },
    setMainWindow: (next) => set((s) => { s.main_window = next; }),
  }))
);
