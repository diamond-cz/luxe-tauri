use tauri::{PhysicalPosition, PhysicalSize, State, WebviewWindow};

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::window_geom::{compute, AvailRect, SavedGeom, TargetGeom};

#[tauri::command]
pub fn compute_adaptive_geometry(saved: SavedGeom, avail: AvailRect) -> TargetGeom {
    compute(saved, avail)
}

/// Read the current monitor's available area for the focused window.
#[tauri::command]
pub fn current_avail_rect(window: WebviewWindow) -> AppResult<AvailRect> {
    let monitor = window
        .current_monitor()?
        .ok_or_else(|| AppError::Other("no current monitor".into()))?;
    let pos  = monitor.position();
    let size = monitor.size();
    Ok(AvailRect {
        x:      pos.x,
        y:      pos.y,
        width:  size.width,
        height: size.height,
    })
}

/// Resize + reposition the main window. Frontend calls this after computing
/// adaptive geometry on boot.
#[tauri::command]
pub fn apply_window_geometry(window: WebviewWindow, geom: TargetGeom) -> AppResult<()> {
    window.set_size(PhysicalSize::new(geom.width, geom.height))?;
    window.set_position(PhysicalPosition::new(geom.x, geom.y))?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// Persist the current window geometry into `[main_window]`. Frontend calls
/// this on resize/move (debounced) and right before close.
#[tauri::command]
pub async fn save_window_geometry(
    state: State<'_, AppState>,
    window: WebviewWindow,
) -> AppResult<()> {
    let size = window.inner_size()?;
    let monitor = window
        .current_monitor()?
        .ok_or_else(|| AppError::Other("no current monitor".into()))?;
    let avail = monitor.size();

    let value = serde_json::json!({
        "width":     size.width,
        "height":    size.height,
        "screen_w":  avail.width,
        "screen_h":  avail.height,
    });
    state
        .state_store
        .patch_section("main_window", value)
        .await
}
