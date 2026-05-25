//! Locale bundles loaded at boot from `src-tauri/resources/translations/*.json`.
//!
//! Mirrors the contract from hiz's `src/core/i18n.py`:
//! - `_LANGUAGE_LOCALES` order is the canonical settings.language index
//! - tr(key) falls back  current_locale → zh_CN → key string

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;
use tauri::AppHandle;
use tauri::Manager;

use crate::error::{AppError, AppResult};

/// Canonical ordering. settings.language stores the **index** into this list.
/// Must stay aligned with `src/locales/index.ts` on the front-end.
pub const LANGUAGE_LOCALES: &[&str] = &[
    "zh_CN", "zh_TW", "en_US", "ja_JP", "ko_KR",
    "de_DE", "fr_FR", "es_ES", "pt_BR", "ru_RU",
    "it_IT", "tr_TR", "pl_PL", "cs_CZ", "vi_VN", "ar_SA",
];

pub type LocaleBundle = HashMap<String, String>;

#[derive(Debug, Default, Serialize)]
pub struct LocaleCatalog {
    /// locale → flat key/value map
    pub bundles: HashMap<String, LocaleBundle>,
    /// canonical locale order; front-end re-uses this to render the picker
    pub order:   Vec<String>,
}

impl LocaleCatalog {
    pub fn load(app: &AppHandle) -> AppResult<Self> {
        let dir = resolve_translations_dir(app)?;
        let mut bundles = HashMap::new();

        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .ok_or_else(|| AppError::Path(format!("invalid name: {path:?}")))?
                .to_owned();
            let text = std::fs::read_to_string(&path)?;
            let bundle: LocaleBundle = serde_json::from_str(&text)?;
            bundles.insert(stem, bundle);
        }

        Ok(Self {
            bundles,
            order: LANGUAGE_LOCALES.iter().map(|s| s.to_string()).collect(),
        })
    }

    pub fn locale_at(&self, index: u32) -> &str {
        LANGUAGE_LOCALES
            .get(index as usize)
            .copied()
            .unwrap_or("zh_CN")
    }
}

fn resolve_translations_dir(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    // Try resource_dir first (production build); fall back to dev-time path.
    if let Ok(base) = app.path().resource_dir() {
        let dir = base.join("resources").join("translations");
        if dir.is_dir() {
            return Ok(dir);
        }
        // Tauri also flattens resources under <resource_dir>/translations on some builds.
        let alt = base.join("translations");
        if alt.is_dir() {
            return Ok(alt);
        }
    }
    // Dev: walk up from CARGO_MANIFEST_DIR
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let dev = manifest.join("resources").join("translations");
    if dev.is_dir() {
        return Ok(dev);
    }
    Err(AppError::NotFound("translations directory".into()))
}
