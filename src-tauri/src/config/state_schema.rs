//! `state.toml` schema. Field names mirror hiz.toml so a future import script is
//! a straight-through copy.

use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StateRoot {
    #[serde(default = "default_last_route")]
    pub last_route: String,
    #[serde(default)]
    pub main_window:      MainWindow,
    #[serde(default)]
    pub settings:         Settings,
    #[serde(default)]
    pub shortcuts:        Shortcuts,
    #[serde(default)]
    pub homepage:         Homepage,
    #[serde(default)]
    pub mtk:              Mtk,
    #[serde(default)]
    pub isp6s_ae_visual:  Isp6sAeVisual,
    #[serde(default)]
    pub image_table_columns: Option<ImageTableColumns>,
}
fn default_last_route() -> String { "/home".into() }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImageTableColumns {
    #[serde(default)] pub isp6s: ImageTableModeColumns,
    #[serde(default)] pub tone: ImageTableModeColumns,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImageTableModeColumns {
    #[serde(default)] pub all: ImageTableScopeColumns,
    #[serde(default)] pub face: ImageTableScopeColumns,
    #[serde(default)] pub normal: ImageTableScopeColumns,
    #[serde(default)] pub color_thresholds: ImageTableColorThresholds,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImageTableScopeColumns {
    #[serde(default)] pub order: Vec<String>,
    #[serde(default)] pub pinned: Vec<String>,
    #[serde(default)] pub hidden: Vec<String>,
    #[serde(default)] pub deleted: Vec<String>,
    #[serde(default)] pub edits: BTreeMap<String, ImageTableColumnEdit>,
    #[serde(default)] pub custom: Vec<ImageTableCustomColumn>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageTableColorThresholds {
    #[serde(default = "default_ae_gain_threshold")] pub ae_gain: f64,
    #[serde(default = "default_ev_threshold")] pub ev: f64,
    #[serde(default = "default_delta_threshold")] pub delta: f64,
}
fn default_ae_gain_threshold() -> f64 { 0.05 }
fn default_ev_threshold() -> f64 { 0.005 }
fn default_delta_threshold() -> f64 { 5.0 }
impl Default for ImageTableColorThresholds {
    fn default() -> Self {
        Self { ae_gain: default_ae_gain_threshold(), ev: default_ev_threshold(), delta: default_delta_threshold() }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImageTableColumnEdit {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageTableCustomColumn {
    pub id: String,
    pub label: String,
    pub source: String,
    pub scope: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MainWindow {
    #[serde(default)] pub width:     u32,
    #[serde(default)] pub height:    u32,
    #[serde(default)] pub screen_w:  u32,
    #[serde(default)] pub screen_h:  u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_close_behavior")] pub close_behavior: u8,    // 0/1/2
    #[serde(default)]                            pub language:       u32,   // _LANGUAGE_LOCALES index
    #[serde(default = "default_theme")]          pub theme:          String, // "dark" | "light" | "system"
    #[serde(default = "default_scale")]          pub scale:          u32,   // 50..=200 (percent)
    #[serde(default)]                            pub cache_path:     String,
    #[serde(default)]                            pub auto_update:    bool,
    #[serde(default = "default_true_settings")]  pub update_notify:  bool,
}

fn default_close_behavior() -> u8 { 0 }
fn default_theme() -> String { "dark".into() }
fn default_scale() -> u32 { 100 }
fn default_true_settings() -> bool { true }

impl Default for Settings {
    fn default() -> Self {
        Self {
            close_behavior: 0,
            language:       0,
            theme:          "dark".into(),
            scale:          100,
            cache_path:     String::new(),
            auto_update:    false,
            update_notify:  true,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Shortcuts {
    #[serde(default)] pub home:     String,
    #[serde(default)] pub settings: String,
    #[serde(default)] pub exit:     String,
    #[serde(default)] pub poetry:   String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Homepage {
    #[serde(default = "default_card_order")] pub card_order: Vec<String>,
}
fn default_card_order() -> Vec<String> {
    vec!["mtk".into(), "qualcomm".into(), "unisoc".into()]
}
impl Default for Homepage {
    fn default() -> Self { Self { card_order: default_card_order() } }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Mtk {
    #[serde(default = "default_current_isp")] pub current_isp:    u32,   // ISP46=0, ISP6S=1, ISP7S=2 — default 1
    #[serde(default)]                         pub current_tab:    u32,
    #[serde(default, deserialize_with = "deserialize_splitter_sizes")]
    pub outer_splitter: Vec<f64>,
    #[serde(default, deserialize_with = "deserialize_splitter_sizes")]
    pub inner_splitter: Vec<f64>,
    #[serde(default)]                         pub cpp_path: Option<String>,
    #[serde(default)]                         pub cpp_paths: BTreeMap<String, String>,
    #[serde(default)]                         pub debug_parser_path: Option<String>,
    #[serde(default)]                         pub image_workspaces: BTreeMap<String, ImageWorkspace>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ImageWorkspace {
    #[serde(default)] pub dir: String,
    #[serde(default)] pub selected_image: Option<String>,
}
fn default_current_isp() -> u32 { 1 }

fn deserialize_splitter_sizes<'de, D>(deserializer: D) -> Result<Vec<f64>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Size {
        Integer(u32),
        Fraction(f64),
    }

    Vec::<Size>::deserialize(deserializer).map(|sizes| {
        sizes.into_iter().map(|size| match size {
            Size::Integer(value) => f64::from(value),
            Size::Fraction(value) => value,
        }).collect()
    })
}

#[cfg(test)]
mod mtk_splitter_tests {
    use super::StateRoot;

    #[test]
    fn legacy_integer_ratios_remain_readable() {
        let old: StateRoot = toml::from_str(
            "[mtk]\nouter_splitter = [40, 60]\ninner_splitter = [16, 84]\n",
        ).unwrap();
        assert_eq!(old.mtk.outer_splitter, vec![40.0, 60.0]);
        assert_eq!(old.mtk.inner_splitter, vec![16.0, 84.0]);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Isp6sAeVisual {
    #[serde(default)] pub split_mode:                 bool,
    #[serde(default = "default_split_ratio")]
    pub split_ratio:                                  f32,
    #[serde(default = "default_true")]
    pub split_cards_on_left:                          bool,
    #[serde(default = "default_image_splitter_ratio")]
    pub image_splitter_ratio:                         f32,
    #[serde(default = "default_image_splitter_orientation")]
    pub image_splitter_orientation:                   String,           // "V" | "H"
    #[serde(default)] pub image_inner_ratios:         Vec<f32>,
    #[serde(default = "default_preview_mode")]
    pub preview_mode:                                 String,           // image / image_split / para_check / param_map / chart_map
    #[serde(default = "default_preview_mode")]
    pub tone_preview_mode:                            String,           // param_map / chart_map
    #[serde(default = "default_workspace_column_ratios")]
    pub workspace_column_ratios:                      Vec<f32>,
    #[serde(default = "default_workspace_details_ratio")]
    pub workspace_details_ratio:                      f32,
    #[serde(default)] pub table_collapsed: bool,
    #[serde(default = "default_table_header_ratios")]
    pub table_header_ratios:                          Vec<f32>,
    #[serde(default = "default_chart_main_t_card_order")]
    pub chart_main_t_card_order:                       Vec<String>,
    #[serde(default)] pub chart_main_t_card_collapsed: Vec<String>,
    #[serde(default = "default_chart_hs_card_order")]
    pub chart_hs_card_order:                           Vec<String>,
    #[serde(default)] pub chart_hs_card_collapsed:     Vec<String>,
    #[serde(default = "default_chart_hs_area_layout")]
    pub chart_hs_area_layout:                         String,
    #[serde(default = "default_chart_ns_card_order")]
    pub chart_ns_card_order:                           Vec<String>,
    #[serde(default)] pub chart_ns_card_collapsed:     Vec<String>,
    #[serde(default)] pub chart_face_card_collapsed:   Vec<String>,
    #[serde(default)] pub chart_face_heatmap_modes:    BTreeMap<String, FaceHeatmapMode>,
    #[serde(default)] pub chart_face_sync_modes:       BTreeMap<String, bool>,
    #[serde(default = "default_chart_main_t_mid_chart_mode")]
    pub chart_main_t_mid_chart_mode:                   String,
    #[serde(default = "default_chart_main_t_mid_chart_source")]
    pub chart_main_t_mid_chart_source:                 String,
    #[serde(default = "default_chart_main_t_mid_readout_mode")]
    pub chart_main_t_mid_readout_mode:                 String,
    #[serde(default = "default_chart_map_tab")]
    pub chart_map_tab:                                 String,
    #[serde(default = "default_tone_chart_map_tab")]
    pub tone_chart_map_tab:                            String,
    #[serde(default = "default_image_table_kind_filter")]
    pub image_table_kind_filter:                        String,
    #[serde(default = "default_image_table_kind_filter")]
    pub tone_image_table_kind_filter:                   String,
}
fn default_image_table_kind_filter() -> String { "all".into() }
fn default_true() -> bool { true }
fn default_split_ratio() -> f32 { 0.7 }
fn default_image_splitter_ratio() -> f32 { 0.5 }
fn default_image_splitter_orientation() -> String { "V".into() }
fn default_preview_mode() -> String { "chart_map".into() }
fn default_workspace_column_ratios() -> Vec<f32> { vec![67.0, 33.0] }
fn default_workspace_details_ratio() -> f32 { 42.0 }
fn default_table_header_ratios() -> Vec<f32> { vec![24.0, 18.0, 58.0] }
fn default_chart_main_t_card_order() -> Vec<String> {
    vec!["mainThd".into(), "mtwv".into(), "mainTarget".into()]
}
fn default_chart_hs_card_order() -> Vec<String> {
    vec!["hsTarget".into(), "hsWeight".into(), "hsBright".into(), "hsMiddle".into(), "hsDark".into()]
}
fn default_chart_hs_area_layout() -> String { "auto".into() }
fn default_chart_ns_card_order() -> Vec<String> {
    vec!["nsTarget".into(), "nsProb".into(), "nsNorT".into(), "nsBT".into(), "nsDT".into()]
}
fn default_chart_main_t_mid_chart_mode() -> String { "thd".into() }
fn default_chart_main_t_mid_chart_source() -> String { "mid".into() }
fn default_chart_main_t_mid_readout_mode() -> String { "value".into() }
fn default_chart_map_tab() -> String { "MainT".into() }
fn default_tone_chart_map_tab() -> String { "LTM".into() }

impl Default for Isp6sAeVisual {
    fn default() -> Self {
        Self {
            split_mode: false,
            split_ratio: default_split_ratio(),
            split_cards_on_left: true,
            image_splitter_ratio: default_image_splitter_ratio(),
            image_splitter_orientation: default_image_splitter_orientation(),
            image_inner_ratios: vec![],
            preview_mode: default_preview_mode(),
            tone_preview_mode: default_preview_mode(),
            workspace_column_ratios: default_workspace_column_ratios(),
            workspace_details_ratio: default_workspace_details_ratio(),
            table_collapsed: false,
            table_header_ratios: default_table_header_ratios(),
            chart_main_t_card_order: default_chart_main_t_card_order(),
            chart_main_t_card_collapsed: vec![],
            chart_hs_card_order: default_chart_hs_card_order(),
            chart_hs_card_collapsed: vec![],
            chart_hs_area_layout: default_chart_hs_area_layout(),
            chart_ns_card_order: default_chart_ns_card_order(),
            chart_ns_card_collapsed: vec![],
            chart_face_card_collapsed: vec![],
            chart_face_heatmap_modes: BTreeMap::new(),
            chart_face_sync_modes: BTreeMap::new(),
            chart_main_t_mid_chart_mode: default_chart_main_t_mid_chart_mode(),
            chart_main_t_mid_chart_source: default_chart_main_t_mid_chart_source(),
            chart_main_t_mid_readout_mode: default_chart_main_t_mid_readout_mode(),
            chart_map_tab: default_chart_map_tab(),
            tone_chart_map_tab: default_tone_chart_map_tab(),
            image_table_kind_filter: default_image_table_kind_filter(),
            tone_image_table_kind_filter: default_image_table_kind_filter(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaceHeatmapMode {
    #[serde(default)] pub enabled: bool,
    #[serde(default = "default_true")] pub show_hit_counts: bool,
}

impl Default for FaceHeatmapMode {
    fn default() -> Self { Self { enabled: false, show_hit_counts: true } }
}

#[cfg(test)]
mod preview_mode_tests {
    use super::Isp6sAeVisual;

    #[test]
    fn tone_preview_mode_defaults_for_older_state_and_round_trips() {
        let mut saved = serde_json::to_value(Isp6sAeVisual::default()).unwrap();
        saved.as_object_mut().unwrap().remove("tone_preview_mode");
        saved.as_object_mut().unwrap().remove("image_table_kind_filter");
        saved.as_object_mut().unwrap().remove("tone_image_table_kind_filter");
        let previous: Isp6sAeVisual = serde_json::from_value(saved).unwrap();
        assert_eq!(previous.tone_preview_mode, "chart_map");
        assert_eq!(previous.image_table_kind_filter, "all");
        assert_eq!(previous.tone_image_table_kind_filter, "all");

        let mut selected = previous;
        selected.tone_preview_mode = "param_map".into();
        selected.image_table_kind_filter = "portrait".into();
        selected.tone_image_table_kind_filter = "scene".into();
        let restored: Isp6sAeVisual = serde_json::from_str(&serde_json::to_string(&selected).unwrap()).unwrap();
        assert_eq!(restored.tone_preview_mode, "param_map");
        assert_eq!(restored.preview_mode, "chart_map");
        assert_eq!(restored.image_table_kind_filter, "portrait");
        assert_eq!(restored.tone_image_table_kind_filter, "scene");
    }
}

#[cfg(test)]
mod image_table_column_tests {
    use super::{ImageTableColumnEdit, ImageTableColumns, ImageTableCustomColumn, StateRoot};

    #[test]
    fn column_tabs_round_trip_independently_in_toml() {
        let mut state = StateRoot::default();
        let mut columns = ImageTableColumns::default();
        columns.isp6s.all.hidden.push("ev".into());
        columns.isp6s.all.pinned = vec!["cwr".into(), "ev".into()];
        columns.isp6s.color_thresholds.ev = 0.012;
        columns.isp6s.color_thresholds.ae_gain = 0.08;
        columns.isp6s.face.order = vec!["cwr".into(), "ev".into()];
        columns.isp6s.face.edits.insert("ev".into(), ImageTableColumnEdit {
            label: Some("Face EV".into()), source: None,
        });
        columns.isp6s.normal.custom.push(ImageTableCustomColumn {
            id: "custom-1".into(), label: "Normal value".into(),
            source: "AE_TAG_REALBVX1000".into(), scope: "normal".into(),
        });
        state.image_table_columns = Some(columns);

        let text = toml::to_string_pretty(&state).unwrap();
        let restored: StateRoot = toml::from_str(&text).unwrap();
        let saved = restored.image_table_columns.unwrap().isp6s;
        assert_eq!(saved.all.hidden, vec!["ev"]);
        assert_eq!(saved.all.pinned, vec!["cwr", "ev"]);
        assert_eq!(saved.color_thresholds.ev, 0.012);
        assert_eq!(saved.color_thresholds.ae_gain, 0.08);
        assert_eq!(saved.color_thresholds.delta, 5.0);
        assert!(saved.face.hidden.is_empty());
        assert_eq!(saved.face.order, vec!["cwr", "ev"]);
        assert_eq!(saved.face.edits["ev"].label.as_deref(), Some("Face EV"));
        assert_eq!(saved.normal.custom[0].scope, "normal");
        assert!(saved.all.custom.is_empty());
    }

    #[test]
    fn older_state_has_no_column_settings_to_allow_migration() {
        let old = toml::to_string_pretty(&StateRoot::default()).unwrap();
        let restored: StateRoot = toml::from_str(&old).unwrap();
        assert!(restored.image_table_columns.is_none());
    }
}
