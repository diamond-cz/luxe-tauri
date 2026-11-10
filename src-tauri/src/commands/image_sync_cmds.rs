use std::path::Path;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    image_sync::{ImageSyncHub, SelectionResult, SyncEnvelope},
};

#[tauri::command]
pub fn publish_image_selection(image_path: String, hub: State<'_, ImageSyncHub>) -> AppResult<()> {
    if !Path::new(&image_path).is_absolute() {
        return Err(AppError::Invalid("image sync path must be absolute".into()));
    }
    hub.publish(SyncEnvelope::selection(
        format!("luxe-{}", std::process::id()),
        image_path,
    ));
    Ok(())
}

#[tauri::command]
pub fn complete_image_sync_selection(
    window: tauri::WebviewWindow,
    delivery_id: String,
    result: SelectionResult,
    hub: State<'_, ImageSyncHub>,
) -> AppResult<()> {
    if window.label() != "main"
        || delivery_id.len() > 32
        || result
            .reason
            .as_ref()
            .is_some_and(|reason| reason.len() > 128)
    {
        return Err(AppError::Invalid("invalid image sync completion".into()));
    }
    hub.complete(&delivery_id, result);
    Ok(())
}
