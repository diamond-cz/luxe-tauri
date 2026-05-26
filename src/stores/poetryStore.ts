import { create } from "zustand";

interface PoetryState {
  /** Current line shown in the title bar. */
  line: string;
  setLine: (line: string) => void;
}

const DEFAULT = "少年听雨歌楼上，红烛昏罗帐";

export const usePoetryStore = create<PoetryState>((set) => ({
  line: DEFAULT,
  setLine: (line) => set({ line: line || DEFAULT }),
}));
