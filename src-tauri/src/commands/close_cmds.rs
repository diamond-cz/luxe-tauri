use tauri::{Manager, State, WebviewWindow};

use crate::error::AppResult;
use crate::state::AppState;

/// Resolved close action returned to the frontend.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CloseDecision {
    /// Show the "remember choice" confirmation dialog (close_behavior == 0)
    Ask,
    /// Hide to tray (close_behavior == 1)
    Tray,
    /// Quit the app (close_behavior == 2)
    Quit,
}

/// Look at current close_behavior and decide what to do. Frontend calls this
/// from a `CloseRequested` handler.
#[tauri::command]
pub fn resolve_close_decision(state: State<'_, AppState>) -> CloseDecision {
    let snap = state.state_store.snapshot();
    match snap.settings.close_behavior {
        1 => CloseDecision::Tray,
        2 => CloseDecision::Quit,
        _ => CloseDecision::Ask,
    }
}

#[tauri::command]
pub fn hide_main_window(window: WebviewWindow) -> AppResult<()> {
    window.hide()?;
    Ok(())
}

#[tauri::command]
pub fn show_main_window(window: WebviewWindow) -> AppResult<()> {
    window.show()?;
    window.unminimize()?;
    window.set_focus()?;
    Ok(())
}

#[tauri::command]
pub fn quit_app(window: WebviewWindow) -> AppResult<()> {
    window.app_handle().exit(0);
    Ok(())
}
