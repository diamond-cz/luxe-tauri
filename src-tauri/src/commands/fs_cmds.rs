use std::path::Path;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// Return the app config directory (parent of state.toml).
#[tauri::command]
pub fn get_config_dir(app: AppHandle) -> AppResult<String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| AppError::Path(err.to_string()))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Reveal `path` in the system file explorer.
#[tauri::command]
pub fn open_path(path: String) -> AppResult<()> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::NotFound(format!("path: {path}")));
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&path).spawn()?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(&path).spawn()?;
    }
    Ok(())
}

#[tauri::command]
pub fn is_dir(path: String) -> bool {
    Path::new(&path).is_dir()
}

/// If `path` is a file → return its parent dir; if it's already a dir → return as-is.
#[tauri::command]
pub fn ensure_directory(path: String) -> AppResult<String> {
    let p = Path::new(&path);
    if p.is_dir() {
        return Ok(path);
    }
    if let Some(parent) = p.parent() {
        if parent.is_dir() {
            return Ok(parent.to_string_lossy().into_owned());
        }
    }
    Err(AppError::NotFound(format!("not a directory: {path}")))
}
