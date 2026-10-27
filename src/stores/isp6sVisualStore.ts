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
  preview_mode:               "chart_map",
  tone_preview_mode:          "chart_map",
  workspace_column_ratios:    [67, 33],
  workspace_details_ratio:    42,
  table_collapsed:            false,
  table_header_ratios:        [24, 18, 58],
  chart_main_t_card_order:     ["mainThd", "mtwv", "mainTarget"],
  chart_main_t_card_collapsed: [],
  chart_hs_card_order:         ["hsTarget", "hsWeight", "hsBright", "hsMiddle", "hsDark"],
  chart_hs_card_collapsed:     [],
  chart_hs_area_layout:        "auto",
  chart_ns_card_order:         ["nsTarget", "nsProb", "nsNorT", "nsBT", "nsDT"],
  chart_ns_card_collapsed:     [],
  chart_face_card_collapsed:   [],
  chart_face_heatmap_modes:    {},
  chart_face_sync_modes:       {},
  chart_face_flt_exif_use_parameter_fdsz_ra: false,
  chart_main_t_mid_chart_mode: "thd",
  chart_main_t_mid_chart_source: "mid",
  chart_main_t_mid_readout_mode: "value",
  chart_map_tab:              "MainT",
  tone_chart_map_tab:         "LTM",
  image_table_kind_filter:    "all",
  tone_image_table_kind_filter: "all",
};

function withoutRemovedImageInfo(next: Isp6sAeVisual): Isp6sAeVisual {
  const oldRatios = next.workspace_column_ratios;
  const sourceRatio = oldRatios.at(-1);
  const sourceSize = sourceRatio !== undefined && Number.isFinite(sourceRatio)
    ? Math.min(70, Math.max(24, sourceRatio)) : 33;
  return {
    ...next,
    workspace_column_ratios: [100 - sourceSize, sourceSize],
  };
}

interface VisualState {
  visual: Isp6sAeVisual;
  selectionSyncEnabled: boolean;
  setVisual: (next: Isp6sAeVisual) => void;
  patch:     (patch: Partial<Isp6sAeVisual>) => void;
  setSelectionSyncEnabled: (enabled: boolean) => void;
}

export const useIsp6sVisualStore = create<VisualState>()(
  immer((set) => ({
    visual: DEFAULT,
    selectionSyncEnabled: true,
    setVisual: (next) => set((s) => {
      // Merge defaults with whatever came from state.toml so newly-added
      // fields (e.g. after a schema bump) always have a sane value.
      s.visual = withoutRemovedImageInfo({ ...DEFAULT, ...next });
    }),
    patch: (patch) => set((s) => {
      s.visual = withoutRemovedImageInfo({ ...s.visual, ...patch });
    }),
    setSelectionSyncEnabled: (enabled) => set({ selectionSyncEnabled: enabled }),
  })),
);

export const DEFAULT_VISUAL = DEFAULT;
