use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

static UPDATING: AtomicBool = AtomicBool::new(false);

struct UpdateGuard;
impl Drop for UpdateGuard {
    fn drop(&mut self) {
        UPDATING.store(false, Ordering::Release);
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    available: bool,
    version: String,
    path: Option<String>,
}

#[tauri::command]
pub async fn update_plugin(download: bool) -> Result<UpdateResult, String> {
    if UPDATING.swap(true, Ordering::AcqRel) {
        return Err("plugin update already running".into());
    }
    let guard = UpdateGuard;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        run_update(download)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(windows)]
fn run_update(download: bool) -> Result<UpdateResult, String> {
    use std::{os::windows::process::CommandExt, path::PathBuf, process::Command};
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let directory = PathBuf::from(
        std::env::var_os("HIVIEWER_PLUGIN_DATA_DIR").ok_or("plugin data directory unavailable")?,
    )
    .join("updates");
    if !directory.is_absolute() {
        return Err("plugin data directory must be absolute".into());
    }
    let system_root =
        PathBuf::from(std::env::var_os("SystemRoot").ok_or("SystemRoot unavailable")?);
    let powershell = system_root.join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let output = Command::new(powershell)
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
        .arg(include_str!("../update.ps1"))
        .env(
            "LUXE_PLUGIN_UPDATE_MODE",
            if download { "download" } else { "check" },
        )
        .env("LUXE_PLUGIN_CURRENT_VERSION", env!("CARGO_PKG_VERSION"))
        .env("LUXE_PLUGIN_UPDATE_DIRECTORY", &directory)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    let result: UpdateResult =
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    if let Some(path) = &result.path {
        let expected = directory.join(format!(
            "luxe-image-sync-{}-windows-x86_64.hvp",
            result.version
        ));
        if PathBuf::from(path) != expected || !expected.is_file() {
            return Err("unexpected update package path".into());
        }
        // Installation must use HiViewer's package inspector and confirmation.
        // Replacing this running EXE would invalidate the host's package digest.
        Command::new(system_root.join("explorer.exe"))
            .arg(format!("/select,{}", expected.display()))
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(result)
}

#[cfg(not(windows))]
fn run_update(_download: bool) -> Result<UpdateResult, String> {
    Err("plugin updates require Windows x64".into())
}
