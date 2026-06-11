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
}

export interface NormalSubOrder {
  MainT: string[];
  HS:    string[];
  NS:    string[];
}

export interface Isp6sAeVisual {
  split_mode:                 boolean;
  split_ratio:                number;
  split_cards_on_left:        boolean;
  image_splitter_ratio:       number;
  image_splitter_orientation: "V" | "H";
  image_inner_ratios:         number[];
  preview_mode:               "param_map" | "chart_map" | "image_split" | "para_check" | "image";
  top_card_order:             string[];
  normal_collapsed:           boolean;
  face_collapsed:             boolean;
  normal_wf_row_mode:         boolean;
  face_wf_row_mode:           boolean;
  normal_card_order:          string[];
  face_card_order:            string[];
  normal_col_ratios:          number[];
  face_col_ratios:            number[];
  normal_sub_order:           NormalSubOrder;
  table_collapsed:            boolean;
  table_header_ratios:        number[];
}

export interface StateRoot {
  main_window:     MainWindow;
  settings:        Settings;
  shortcuts:       Shortcuts;
  homepage:        Homepage;
  mtk:             Mtk;
  isp6s_ae_visual: Isp6sAeVisual;
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
