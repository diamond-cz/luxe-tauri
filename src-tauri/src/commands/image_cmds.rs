use std::collections::HashMap;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::image_scan;

#[tauri::command]
pub fn scan_image_dir(dir: String) -> AppResult<Vec<image_scan::ImageEntry>> {
    image_scan::scan_directory(&PathBuf::from(dir))
}

#[tauri::command]
pub async fn load_image_toml(path: String) -> AppResult<HashMap<String, String>> {
    tauri::async_runtime::spawn_blocking(move || image_scan::load_image_toml(&PathBuf::from(path)))
        .await
        .map_err(|err| AppError::Other(format!("TOML task failed: {err}")))?
}

#[tauri::command]
pub async fn load_image_toml_batch(
    paths: Vec<String>,
) -> AppResult<HashMap<String, HashMap<String, String>>> {
    tauri::async_runtime::spawn_blocking(move || image_scan::load_image_toml_batch(paths))
        .await
        .map_err(|err| AppError::Other(format!("TOML batch task failed: {err}")))?
}

#[tauri::command]
pub async fn load_image_toml_fields_batch(
    paths: Vec<String>,
    keys: Vec<String>,
) -> AppResult<HashMap<String, HashMap<String, String>>> {
    tauri::async_runtime::spawn_blocking(move || {
        image_scan::load_image_toml_fields_batch(paths, keys)
    })
    .await
    .map_err(|err| AppError::Other(format!("TOML field batch task failed: {err}")))?
}

#[tauri::command]
pub async fn load_image_thumbnail_batch(
    paths: Vec<String>,
    size: u32,
    embedded_only: Option<bool>,
) -> AppResult<HashMap<String, String>> {
    tauri::async_runtime::spawn_blocking(move || {
        image_scan::load_image_thumbnail_batch(paths, size, embedded_only.unwrap_or(false))
    })
    .await
    .map_err(|err| AppError::Other(format!("thumbnail batch task failed: {err}")))?
}
