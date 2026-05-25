use serde_json::Value;
use tauri::State;

use crate::config::StateRoot;
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub fn load_state(state: State<'_, AppState>) -> StateRoot {
    state.state_store.snapshot()
}

#[tauri::command]
pub async fn save_state_section(
    state: State<'_, AppState>,
    section: String,
    value: Value,
) -> AppResult<()> {
    state.state_store.patch_section(&section, value).await
}

#[tauri::command]
pub async fn flush_state_now(state: State<'_, AppState>) -> AppResult<()> {
    state.state_store.flush_now().await
}
