use std::collections::HashMap;
use std::path::PathBuf;

use crate::error::{AppError, AppResult};
use crate::image_scan;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use tauri::ipc::Channel;

static PREVIEW_TASKS: Lazy<tokio::sync::Semaphore> = Lazy::new(|| tokio::sync::Semaphore::new(1));
static HOVER_PREVIEW_TASKS: Lazy<tokio::sync::Semaphore> = Lazy::new(|| tokio::sync::Semaphore::new(1));
// TOML parsing and image decoding are CPU-heavy. Keep concurrent IPC requests
// bounded because the table can issue several overlapping requests while it
// virtualizes rows or changes the selected image.
static TOML_TASKS: Lazy<tokio::sync::Semaphore> = Lazy::new(|| tokio::sync::Semaphore::new(2));
static THUMBNAIL_TASKS: Lazy<tokio::sync::Semaphore> = Lazy::new(|| tokio::sync::Semaphore::new(2));
static PREVIEW_SELECTION: Lazy<Mutex<(String, u64)>> = Lazy::new(|| Mutex::new((String::new(), 0)));
static HOVER_PREVIEW_SELECTION: Lazy<Mutex<(String, u64)>> = Lazy::new(|| Mutex::new((String::new(), 0)));

#[tauri::command]
pub async fn parse_image_exif(
    parser_path: String,
    image_dir: String,
    on_progress: Channel<image_scan::ExifParseProgress>,
) -> AppResult<image_scan::ExifParseSummary> {
    tauri::async_runtime::spawn_blocking(move || {
        image_scan::parse_exif_directory(
            &PathBuf::from(parser_path),
            &PathBuf::from(image_dir),
            |progress| { let _ = on_progress.send(progress); },
        )
    })
    .await
    .map_err(|error| AppError::Other(format!("EXIF task failed: {error}")))?
}

#[tauri::command]
pub async fn scan_image_dir(dir: String) -> AppResult<Vec<image_scan::ImageEntry>> {
    tauri::async_runtime::spawn_blocking(move || image_scan::scan_directory(&PathBuf::from(dir)))
        .await
        .map_err(|err| AppError::Other(format!("image scan task failed: {err}")))?
}

#[tauri::command]
pub async fn load_image_toml(path: String) -> AppResult<HashMap<String, String>> {
    tauri::async_runtime::spawn_blocking(move || image_scan::load_image_toml(&PathBuf::from(path)))
        .await
        .map_err(|err| AppError::Other(format!("TOML task failed: {err}")))?
}

#[tauri::command]
pub async fn load_image_toml_sections(path: String) -> AppResult<Vec<image_scan::ImageTomlSection>> {
    let _permit = TOML_TASKS.acquire().await
        .map_err(|err| AppError::Other(format!("TOML queue closed: {err}")))?;
    tauri::async_runtime::spawn_blocking(move || image_scan::load_image_toml_sections(&PathBuf::from(path)))
        .await
        .map_err(|err| AppError::Other(format!("TOML sections task failed: {err}")))?
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
    let _permit = TOML_TASKS.acquire().await
        .map_err(|err| AppError::Other(format!("TOML queue closed: {err}")))?;
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
    let _permit = THUMBNAIL_TASKS.acquire().await
        .map_err(|err| AppError::Other(format!("thumbnail queue closed: {err}")))?;
    tauri::async_runtime::spawn_blocking(move || {
        image_scan::load_image_thumbnail_batch(paths, size, embedded_only.unwrap_or(false))
    })
    .await
    .map_err(|err| AppError::Other(format!("thumbnail batch task failed: {err}")))?
}

#[tauri::command]
pub async fn load_image_preview(path: String) -> AppResult<String> {
    let generation = {
        let mut selection = PREVIEW_SELECTION.lock();
        if selection.0 != path {
            selection.0 = path.clone();
            selection.1 = selection.1.wrapping_add(1);
        }
        selection.1
    };
    let _permit = PREVIEW_TASKS.acquire().await
        .map_err(|err| AppError::Other(format!("image preview queue closed: {err}")))?;
    if PREVIEW_SELECTION.lock().1 != generation {
        return Err(AppError::Other("image preview superseded".into()));
    }
    tauri::async_runtime::spawn_blocking(move || image_scan::load_image_preview(&PathBuf::from(path)))
        .await
        .map_err(|err| AppError::Other(format!("image preview task failed: {err}")))?
}

#[tauri::command]
pub async fn load_image_hover_preview(path: String) -> AppResult<String> {
    let generation = {
        let mut selection = HOVER_PREVIEW_SELECTION.lock();
        if selection.0 != path {
            selection.0 = path.clone();
            selection.1 = selection.1.wrapping_add(1);
        }
        selection.1
    };
    let _permit = HOVER_PREVIEW_TASKS.acquire().await
        .map_err(|err| AppError::Other(format!("hover preview queue closed: {err}")))?;
    if HOVER_PREVIEW_SELECTION.lock().1 != generation {
        return Err(AppError::Other("image hover preview superseded".into()));
    }
    tauri::async_runtime::spawn_blocking(move || image_scan::load_image_hover_preview(&PathBuf::from(path)))
        .await
        .map_err(|err| AppError::Other(format!("image hover preview task failed: {err}")))?
}
