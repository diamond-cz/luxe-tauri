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
    let p = std::path::Path::new(&path);
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
