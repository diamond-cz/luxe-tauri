use tauri::{AppHandle, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::error::AppResult;
use crate::shortcuts::{self, ShortcutMap};
use crate::state::AppState;

#[tauri::command]
pub async fn update_shortcuts(
    app: AppHandle,
    state: State<'_, AppState>,
    map: ShortcutMap,
) -> AppResult<()> {
    let registry = shortcuts::get_registry(&app)?;
    shortcuts::apply_map(&app, &registry, &map)?;

    // Persist into state.toml [shortcuts].
    let value = serde_json::to_value(&map)?;
    state.state_store.patch_section("shortcuts", value).await?;
    Ok(())
}

/// Temporarily unregister all global shortcuts so the frontend can record a
/// new accelerator without the OS swallowing the keypress.
#[tauri::command]
pub fn pause_shortcuts(app: AppHandle) -> AppResult<()> {
    let registry = shortcuts::get_registry(&app)?;
    let gs = app.global_shortcut();
    for (_id, sc) in registry.read().iter() {
        let _ = gs.unregister(sc.clone());
    }
    Ok(())
}

/// Re-register every accelerator currently held in state.toml — pair with
/// `pause_shortcuts` once recording is done (or cancelled).
#[tauri::command]
pub fn resume_shortcuts(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let registry = shortcuts::get_registry(&app)?;
    let snap = state.state_store.snapshot();
    let map = ShortcutMap {
        home:     snap.shortcuts.home,
        settings: snap.shortcuts.settings,
        exit:     snap.shortcuts.exit,
        poetry:   snap.shortcuts.poetry,
    };
    shortcuts::apply_map(&app, &registry, &map)
}
