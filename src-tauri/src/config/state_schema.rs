//! `state.toml` schema. Field names mirror hiz.toml so a future import script is
//! a straight-through copy.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StateRoot {
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
    #[serde(default)]                         pub outer_splitter: Vec<u32>,
    #[serde(default)]                         pub inner_splitter: Vec<u32>,
}
fn default_current_isp() -> u32 { 1 }

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
    pub preview_mode:                                 String,           // image / image_split / para_check / param_map
    #[serde(default)] pub top_card_order:             Vec<String>,
    #[serde(default)] pub normal_collapsed:           bool,
    #[serde(default)] pub face_collapsed:             bool,
    #[serde(default)] pub normal_wf_row_mode:         bool,
    #[serde(default)] pub face_wf_row_mode:           bool,
    #[serde(default)] pub normal_card_order:          Vec<String>,
    #[serde(default)] pub face_card_order:            Vec<String>,
    #[serde(default)] pub normal_col_ratios:          Vec<f32>,
    #[serde(default)] pub face_col_ratios:            Vec<f32>,
    #[serde(default)] pub normal_sub_order:           NormalSubOrder,
    #[serde(default)] pub table_collapsed:            bool,
}
fn default_true() -> bool { true }
fn default_split_ratio() -> f32 { 0.7 }
fn default_image_splitter_ratio() -> f32 { 0.5 }
fn default_image_splitter_orientation() -> String { "V".into() }
fn default_preview_mode() -> String { "image".into() }

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
            top_card_order: vec![],
            normal_collapsed: false,
            face_collapsed: false,
            normal_wf_row_mode: false,
            face_wf_row_mode: false,
            normal_card_order: vec![],
            face_card_order: vec![],
            normal_col_ratios: vec![],
            face_col_ratios: vec![],
            normal_sub_order: NormalSubOrder::default(),
            table_collapsed: false,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NormalSubOrder {
    #[serde(default, rename = "MainT")] pub main_t: Vec<String>,
    #[serde(default, rename = "HS")]    pub hs:     Vec<String>,
    #[serde(default, rename = "NS")]    pub ns:     Vec<String>,
}
