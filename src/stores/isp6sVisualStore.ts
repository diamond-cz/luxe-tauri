import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Isp6sAeVisual } from "@/types/ipc";

const DEFAULT: Isp6sAeVisual = {
  split_mode:                 false,
  split_ratio:                0.7,
  split_cards_on_left:        true,
  image_splitter_ratio:       0.5,
  image_splitter_orientation: "V",
  image_inner_ratios:         [],
  preview_mode:               "image",
  top_card_order:             ["Normal", "Face/Touch"],
  normal_collapsed:           false,
  face_collapsed:             false,
  normal_wf_row_mode:         false,   // false = grid, true = single-row horizontal
  face_wf_row_mode:           false,
  normal_card_order:          ["MainT", "HS", "ABL", "NS"],
  face_card_order:            ["Face", "Touch"],
  normal_col_ratios:          [],
  face_col_ratios:            [],
  normal_sub_order:           { MainT: [], HS: [], NS: [] },
  table_collapsed:            false,
};

interface VisualState {
  visual: Isp6sAeVisual;
  setVisual: (next: Isp6sAeVisual) => void;
  patch:     (patch: Partial<Isp6sAeVisual>) => void;
}

export const useIsp6sVisualStore = create<VisualState>()(
  immer((set) => ({
    visual: DEFAULT,
    setVisual: (next) => set((s) => {
      // Merge defaults with whatever came from state.toml so newly-added
      // fields (e.g. after a schema bump) always have a sane value.
      s.visual = { ...DEFAULT, ...next };
    }),
    patch: (patch) => set((s) => {
      s.visual = { ...s.visual, ...patch };
    }),
  })),
);

export const DEFAULT_VISUAL = DEFAULT;
