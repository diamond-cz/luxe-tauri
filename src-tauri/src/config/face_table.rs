use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;
use toml::Value;

use crate::error::AppResult;

#[derive(Debug, Clone, Default, Serialize)]
pub struct FaceTableSchema {
    #[serde(default)]
    pub top_kv: BTreeMap<String, String>,
    #[serde(default, rename = "FBT")]
    pub fbt: BTreeMap<String, String>,
    #[serde(default, rename = "FLT")]
    pub flt: BTreeMap<String, String>,
}

impl FaceTableSchema {
    pub fn load(path: &Path) -> AppResult<Self> {
        let text = std::fs::read_to_string(path)?;
        let value: Value = toml::from_str(&text)?;
        let mut out = FaceTableSchema::default();

        if let Some(table) = value.as_table() {
            for (key, value) in table {
                match key.as_str() {
                    "FBT" => out.fbt = value_to_map(value),
                    "FLT" => out.flt = value_to_map(value),
                    _ => {
                        if let Some(text) = value_to_string(value) {
                            out.top_kv.insert(key.clone(), text);
                        }
                    }
                }
            }
        }

        Ok(out)
    }
}

fn value_to_map(value: &Value) -> BTreeMap<String, String> {
    value
        .as_table()
        .map(|table| {
            table
                .iter()
                .filter_map(|(key, value)| value_to_string(value).map(|text| (key.clone(), text)))
                .collect()
        })
        .unwrap_or_default()
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(v) => Some(v.clone()),
        Value::Integer(v) => Some(v.to_string()),
        Value::Float(v) => Some(v.to_string()),
        Value::Boolean(v) => Some(v.to_string()),
        _ => None,
    }
}
