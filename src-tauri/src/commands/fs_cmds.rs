use std::path::Path;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// Resolve a dropped Windows shortcut to the file it points to. Native drag
/// and drop reports the `.lnk` file itself, while the parsers need the target.
#[tauri::command]
pub fn resolve_dropped_path(path: String) -> AppResult<String> {
    let input = Path::new(&path);
    if !input.is_file() {
        return Err(AppError::NotFound(format!("path: {path}")));
    }
    #[cfg(windows)]
    {
        if input.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("lnk")) == Some(true) {
            return resolve_windows_shortcut(input).ok_or_else(|| AppError::NotFound(format!("shortcut target: {path}")));
        }
    }
    Ok(path)
}

#[cfg(windows)]
fn resolve_windows_shortcut(path: &Path) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ};
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = (|| {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
            let persist: IPersistFile = link.cast().ok()?;
            let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            persist.Load(PCWSTR(wide.as_ptr()), STGM_READ).ok()?;
            let mut target = [0u16; 32768];
            link.GetPath(&mut target, std::ptr::null_mut(), 0).ok()?;
            let end = target.iter().position(|value| *value == 0).unwrap_or(target.len());
            let resolved = String::from_utf16_lossy(&target[..end]);
            (!resolved.is_empty()).then_some(resolved)
        })();
        if initialized { CoUninitialize(); }
        result
    }
}

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

/// Open an external HTTP(S) URL in the user's default browser.
#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::Invalid(format!("unsupported url: {url}")));
    }
    #[cfg(windows)]
    {
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&url).spawn()?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn()?;
    }
    Ok(())
}

#[tauri::command]
pub fn is_dir(path: String) -> bool {
    Path::new(&path).is_dir()
}

#[tauri::command]
pub fn is_file(path: String) -> bool {
    Path::new(&path).is_file()
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
