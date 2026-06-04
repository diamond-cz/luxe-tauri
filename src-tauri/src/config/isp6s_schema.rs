//! Strong-typed view of `configs/Isp6s.toml`. The schema mirrors hiz's
//! comments exactly — fields names are NOT to be renamed (front-end & cpp
//! parsers depend on them).

use std::collections::HashMap;
use std::path::Path;

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

use crate::cpp_parser::card_source::CardSourceSpec;
use crate::error::AppResult;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Isp6sSchema {
    #[serde(default)] pub card:         CardSection,
    #[serde(default, rename = "Image")] pub image:    IndexMap<String, String>,
    #[serde(default)] pub lce:          LceSection,
    #[serde(default)] pub para_check:   ParaCheckSection,
    #[serde(default)] pub preview_info: PreviewInfoSection,
    /// `[card_source.<CardName>]` blocks keyed by card name.
    #[serde(default)] pub card_source:  HashMap<String, CardSourceSpec>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CardSection {
    #[serde(default, rename = "Normal")]      pub normal:     NormalCard,
    #[serde(default, rename = "face_touch")]  pub face_touch: FaceTouchCard,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NormalCard {
    #[serde(rename = "CWR", default)] pub cwr: String,
    #[serde(default)]                 pub wt:  HashMap<String, String>,
    #[serde(default)]                 pub tar: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FaceTouchCard {
    #[serde(rename = "CWR", default)]          pub cwr:           String,
    #[serde(rename = "LCE_Gain_num", default)] pub lce_gain_num:  String,
    #[serde(rename = "LCE_Gain_den", default)] pub lce_gain_den:  String,
    #[serde(rename = "Face", default)]         pub face:          FaceSub,
    #[serde(rename = "Touch", default)]        pub touch:         TouchSub,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FaceSub {
    #[serde(default)]                pub wt_max: Vec<String>,
    #[serde(rename = "FBT", default)] pub fbt:   String,
    #[serde(rename = "FLT", default)] pub flt:   String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TouchSub {
    #[serde(default)] pub wt_max: Vec<String>,
    #[serde(default)] pub tar:    String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LceSection {
    #[serde(default, rename = "group")] pub groups: Vec<LceGroup>,
}

/// `type = "row" | "series"`. Use a tagged enum so serde picks the right
/// variant from the `type` field.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LceGroup {
    Row {
        #[serde(default)] row_label: String,
        #[serde(default)] columns:   Vec<String>,
        #[serde(default)] keys:      Vec<String>,
    },
    Series {
        #[serde(default)] columns:  Vec<String>,
        #[serde(default)] labels:   Vec<String>,
        #[serde(default)] patterns: Vec<String>,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ParaCheckSection {
    #[serde(default)] pub items: Vec<ParaCheckItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ParaCheckItem {
    pub label:    String,
    #[serde(default)] pub cpp_path: String,
    #[serde(default)] pub toml_key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PreviewInfoSection {
    #[serde(default)] pub items: Vec<PreviewInfoItem>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PreviewInfoItem {
    pub label:    String,
    #[serde(default)] pub toml_key: String,
}

impl Isp6sSchema {
    pub fn load(path: &Path) -> AppResult<Self> {
        let text = std::fs::read_to_string(path)?;
        Ok(toml::from_str(&text)?)
    }
}
