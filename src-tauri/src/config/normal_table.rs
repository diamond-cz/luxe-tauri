use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NormalTableSchema {
    #[serde(default)]
    pub block: Vec<NormalTableBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NormalTableBlock {
    Kv {
        #[serde(default)]
        items: Vec<NormalKvItem>,
    },
    Note {
        #[serde(default)]
        text: String,
    },
    Grid {
        #[serde(default)]
        title: String,
        #[serde(default)]
        title_style: String,
        #[serde(default)]
        columns: Vec<String>,
        #[serde(default)]
        rows: Vec<NormalGridRow>,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NormalKvItem {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NormalGridRow {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub cells: Vec<String>,
}

impl NormalTableSchema {
    pub fn load(path: &Path) -> AppResult<Self> {
        let text = std::fs::read_to_string(path)?;
        Ok(toml::from_str(&text)?)
    }
}
