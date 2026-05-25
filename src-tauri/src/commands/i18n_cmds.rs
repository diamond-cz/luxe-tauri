use tauri::{AppHandle, Manager, State};

use crate::config::{LocaleBundle, LocaleCatalog};
use crate::error::{AppError, AppResult};

#[tauri::command]
pub fn list_locales(catalog: State<'_, LocaleCatalog>) -> Vec<String> {
    catalog.order.clone()
}

#[tauri::command]
pub fn get_locale_bundle(
    catalog: State<'_, LocaleCatalog>,
    locale: String,
) -> AppResult<LocaleBundle> {
    catalog
        .bundles
        .get(&locale)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("locale: {locale}")))
}

#[tauri::command]
pub fn get_all_locale_bundles(
    catalog: State<'_, LocaleCatalog>,
) -> std::collections::HashMap<String, LocaleBundle> {
    catalog.bundles.clone()
}

/// Frontend pushes locale changes back so the tray menu (Rust-rendered) can
/// stay in sync once we re-translate it in M6.
#[tauri::command]
pub fn announce_locale_changed(_app: AppHandle, _locale: String) -> AppResult<()> {
    // Reserved hook — kept now so the IPC shape is stable.
    let _ = _app.path(); // touch to silence unused warning
    Ok(())
}
