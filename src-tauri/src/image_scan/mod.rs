//! Image directory scanning + per-image TOML loading.
//!
//! Mirrors hiz's behaviour: each captured frame has a sidecar `.toml` file
//! sharing the same stem (e.g. `IMG_20260318_171433.jpg` + `IMG_20260318_171433.toml`).
//! The TOML carries flat or shallowly-nested `AE_TAG_*` keys that feed every
//! per-image badge / table value in `Isp6sAeVisual`.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
pub struct ImageEntry {
    /// Stem (no extension).
    pub name:      String,
    pub jpg_path:  String,
    pub toml_path: String,
}

/// Scan `dir` for image files (`.jpg`, `.jpeg`, `.png`) that have a sibling
/// `.toml` with the same stem. Sorted alphabetically.
pub fn scan_directory(dir: &Path) -> AppResult<Vec<ImageEntry>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        let p = entry.path();
        if !p.is_file() { continue; }
        let Some(ext) = p.extension().and_then(|s| s.to_str()) else { continue };
        if !matches!(ext.to_ascii_lowercase().as_str(), "jpg" | "jpeg" | "png") {
            continue;
        }
        let toml_path: PathBuf = p.with_extension("toml");
        if !toml_path.is_file() { continue; }
        let Some(stem) = p.file_stem().and_then(|s| s.to_str()) else { continue };
        entries.push(ImageEntry {
            name:      stem.to_string(),
            jpg_path:  p.to_string_lossy().into_owned(),
            toml_path: toml_path.to_string_lossy().into_owned(),
        });
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

/// Load a single image TOML and flatten it into a key → value map.
///
/// Flattening rules (mirrors hiz `_flatten_toml_items`):
/// - For every nested map node, walk recursively and record leaves.
/// - For every leaf, record BOTH the dotted path AND the bare leaf name —
///   that way `AE_TAG_FOO` resolves whether the TOML places it at top level
///   or under a section like `[hw_status]`.
/// - Arrays are joined with ", " (so the value is a single string just like
///   the Python flattener returns).
pub fn load_image_toml(path: &Path) -> AppResult<HashMap<String, String>> {
    let text = fs::read_to_string(path)?;
    let root: toml::Value = toml::from_str(&text)?;
    let mut out: HashMap<String, String> = HashMap::new();
    walk(&root, "", &mut out);
    Ok(out)
}

fn walk(v: &toml::Value, prefix: &str, out: &mut HashMap<String, String>) {
    match v {
        toml::Value::Table(t) => {
            for (k, child) in t.iter() {
                let full = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                walk(child, &full, out);
            }
        }
        toml::Value::Array(a) => {
            // Hiz joins arrays with ", " in the flat representation.
            let joined: Vec<String> = a.iter().map(stringify).collect();
            let s = joined.join(", ");
            insert_with_aliases(out, prefix, s);
        }
        _ => {
            insert_with_aliases(out, prefix, stringify(v));
        }
    }
}

fn insert_with_aliases(out: &mut HashMap<String, String>, full_path: &str, value: String) {
    if full_path.is_empty() {
        return;
    }
    out.insert(full_path.to_string(), value.clone());
    out.entry(full_path.to_ascii_lowercase()).or_insert(value.clone());
    // Also store the bare leaf name so `AE_TAG_*` lookups work regardless of
    // the section it lives under.
    if let Some(leaf) = full_path.rsplit('.').next() {
        if leaf != full_path {
            out.entry(leaf.to_string()).or_insert(value.clone());
            out.entry(leaf.to_ascii_lowercase()).or_insert(value);
        }
    }
}

fn stringify(v: &toml::Value) -> String {
    match v {
        toml::Value::String(s)   => s.clone(),
        toml::Value::Integer(i)  => i.to_string(),
        toml::Value::Float(f)    => {
            // Avoid the scientific notation that toml's Display can produce.
            if f.fract() == 0.0 { format!("{f:.0}") } else { format!("{f}") }
        }
        toml::Value::Boolean(b)  => b.to_string(),
        toml::Value::Datetime(d) => d.to_string(),
        toml::Value::Array(_) | toml::Value::Table(_) => String::new(),
    }
}
