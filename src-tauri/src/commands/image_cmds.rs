use std::collections::HashMap;
use std::path::PathBuf;

use crate::error::AppResult;
use crate::image_scan;

#[tauri::command]
pub fn scan_image_dir(dir: String) -> AppResult<Vec<image_scan::ImageEntry>> {
    image_scan::scan_directory(&PathBuf::from(dir))
}

#[tauri::command]
pub fn load_image_toml(path: String) -> AppResult<HashMap<String, String>> {
    image_scan::load_image_toml(&PathBuf::from(path))
}
