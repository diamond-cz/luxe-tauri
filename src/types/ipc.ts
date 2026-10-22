/* TypeScript mirror of the Rust types. Keep field names in sync with
 * `src-tauri/src/config/state_schema.rs` and `src-tauri/src/window_geom.rs`. */

export interface MainWindow {
  width:    number;
  height:   number;
  screen_w: number;
  screen_h: number;
}

export interface Settings {
  close_behavior: 0 | 1 | 2;
  language:       number;
  theme:          "dark" | "light" | "system" | string;
  scale:          number;       // percent, 50..=200
  cache_path:     string;
  auto_update:    boolean;
  update_notify:  boolean;
}

export interface Shortcuts {
  home:     string;
  settings: string;
  exit:     string;
  poetry:   string;
}

export interface Homepage {
  card_order: string[];
}

export interface Mtk {
  current_isp:    number;
  current_tab:    number;
  outer_splitter: number[];
  inner_splitter: number[];
  cpp_path?: string | null;
  cpp_paths?: Record<string, string>;
  debug_parser_path?: string | null;
  image_workspaces?: Record<string, { dir: string; selected_image?: string | null }>;
}

export interface Isp6sAeVisual {
  split_mode:                 boolean;
  split_ratio:                number;
  split_cards_on_left:        boolean;
  image_splitter_ratio:       number;
  image_splitter_orientation: "V" | "H";
  image_inner_ratios:         number[];
  preview_mode:               "param_map" | "chart_map" | "image_split" | "para_check" | "image";
  tone_preview_mode?:         "param_map" | "chart_map";
  workspace_column_ratios:    number[];
  workspace_details_ratio:    number;
  table_collapsed:            boolean;
  table_header_ratios:        number[];
  chart_main_t_card_order:     string[];
  chart_main_t_card_collapsed: string[];
  chart_hs_card_order:         string[];
  chart_hs_card_collapsed:     string[];
  chart_hs_area_layout:        "auto" | "horizontal" | "vertical";
  chart_ns_card_order:         string[];
  chart_ns_card_collapsed:     string[];
  chart_face_card_collapsed:   string[];
  chart_face_heatmap_modes:    Record<string, { enabled: boolean; show_hit_counts: boolean }>;
  chart_face_sync_modes:       Record<string, boolean>;
  chart_main_t_mid_chart_mode: string;
  chart_main_t_mid_chart_source: string;
  chart_main_t_mid_readout_mode: string;
  chart_map_tab:              string;
  tone_chart_map_tab:         string;
}

export interface StateRoot {
  last_route?: string;
  main_window:     MainWindow;
  settings:        Settings;
  shortcuts:       Shortcuts;
  homepage:        Homepage;
  mtk:             Mtk;
  isp6s_ae_visual: Isp6sAeVisual;
  image_table_columns?: ImageTableColumns | null;
}

export interface ImageTableScopeColumns {
  order: string[];
  pinned: string[];
  hidden: string[];
  deleted: string[];
  edits: Record<string, { label?: string; source?: string }>;
  custom: Array<{ id: string; label: string; source: string; scope: "all" | "face" | "normal" }>;
}

export interface ImageTableModeColumns {
  all: ImageTableScopeColumns;
  face: ImageTableScopeColumns;
  normal: ImageTableScopeColumns;
}

export interface ImageTableColumns {
  isp6s: ImageTableModeColumns;
  tone: ImageTableModeColumns;
}

export interface SavedGeom {
  width:    number;
  height:   number;
  screen_w: number;
  screen_h: number;
}

export interface AvailRect {
  x:      number;
  y:      number;
  width:  number;
  height: number;
}

export interface TargetGeom {
  x:      number;
  y:      number;
  width:  number;
  height: number;
}
