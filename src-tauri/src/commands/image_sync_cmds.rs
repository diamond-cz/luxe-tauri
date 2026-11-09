use std::path::Path;

use tauri::State;

use crate::{
    error::{AppError, AppResult},
    image_sync::{ImageSyncHub, SyncEnvelope},
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
