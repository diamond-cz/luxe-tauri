use tauri::{AppHandle, Emitter};

use crate::error::AppResult;
use crate::events::POETRY_UPDATED;

#[tauri::command]
pub async fn fetch_poetry(app: AppHandle) -> AppResult<String> {
    let line = crate::poetry::fetch_one().await?;
    let _ = app.emit(POETRY_UPDATED, &line);
    Ok(line)
}
