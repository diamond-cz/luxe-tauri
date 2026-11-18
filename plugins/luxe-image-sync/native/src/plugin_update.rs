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
    #[serde(default)]
    executable: Option<String>,
    #[serde(default)]
    installed: bool,
}

#[tauri::command]
pub async fn update_plugin(
    download: bool,
    state: tauri::State<'_, std::sync::Arc<crate::BridgeState>>,
) -> Result<UpdateResult, String> {
    if UPDATING.swap(true, Ordering::AcqRel) {
        return Err("plugin update already running".into());
    }
    let guard = UpdateGuard;
    let host = state.host_update.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        run_update(download, &host)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(windows)]
fn run_update(
    download: bool,
    host: &crate::host_update::HostUpdate,
) -> Result<UpdateResult, String> {
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
    let native_install = host.available();
    let output = Command::new(powershell)
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
        .arg(include_str!("../update.ps1"))
        .env(
            "LUXE_PLUGIN_UPDATE_MODE",
            if download { "download" } else { "check" },
        )
        .env("LUXE_PLUGIN_CURRENT_VERSION", env!("CARGO_PKG_VERSION"))
        .env("LUXE_PLUGIN_UPDATE_DIRECTORY", &directory)
        .env(
            "LUXE_PLUGIN_NATIVE_INSTALL",
            if native_install { "1" } else { "0" },
        )
        .env(
            "LUXE_PLUGIN_CURRENT_MANIFEST",
            include_str!("../../manifest.json"),
        )
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    let mut result: UpdateResult =
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    // Only our verified host commit can mark an update installed.
    result.installed = false;
    if let Some(path) = &result.path {
        let expected = directory.join(format!(
            "luxe-image-sync-{}-windows-x86_64.hvp",
            result.version
        ));
        if PathBuf::from(path) != expected || !expected.is_file() {
            return Err("unexpected update package path".into());
        }
        if native_install {
            let executable = result
                .executable
                .as_deref()
                .ok_or("verified runtime unavailable")?;
            let executable_path = PathBuf::from(executable);
            if !executable_path.is_absolute()
                || !executable_path.starts_with(&directory)
                || executable_path.file_name().and_then(|name| name.to_str())
                    != Some("luxe-image-sync.exe")
                || !executable_path.is_file()
            {
                return Err("unexpected update executable path".into());
            }
            let receipt = match host.install(executable, &result.version) {
                Ok(receipt) => receipt,
                Err(error) => {
                    // On timeout the host may still be importing; retain the
                    // bounded candidate for inspection rather than changing it.
                    if !error.contains("timed out") {
                        cleanup_runtime(&executable_path, &directory);
                    }
                    return Err(error);
                }
            };
            // Consume/persist the receipt before complete: the host can terminate
            // this process immediately afterwards. UI return is not installation authority.
            let receipt_path = directory.join(format!(
                "installed-{}-{}.json",
                result.version,
                std::process::id()
            ));
            let saved = (|| -> Result<(), String> {
                use std::io::Write;
                let mut file = std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(receipt_path)
                    .map_err(|error| error.to_string())?;
                file.write_all(&serde_json::to_vec(&receipt).map_err(|error| error.to_string())?)
                    .map_err(|error| error.to_string())?;
                file.sync_all().map_err(|error| error.to_string())
            })();
            if let Err(error) = saved {
                eprintln!("Update installed; could not save optional receipt: {error}");
            }
            result.installed = true;
            // commit copied the runtime into a managed revision. Retire our
            // candidate before complete can terminate the old process.
            cleanup_runtime(&executable_path, &directory);
            // A failed complete does not undo a successful commit. The host also
            // has a bounded handoff timeout and will retire the old process.
            if let Err(error) = host.complete() {
                eprintln!("Update installed; host handoff notification failed: {error}");
            }
        } else {
            // Legacy hosts lack the authorized callback: keep package installation
            // in HiViewer, never overwrite the running managed installation.
            Command::new(system_root.join("explorer.exe"))
                .arg(format!("/select,{}", expected.display()))
                .spawn()
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(result)
}

#[cfg(windows)]
fn cleanup_runtime(executable: &std::path::Path, directory: &std::path::Path) {
    use std::os::windows::fs::MetadataExt;
    let Some(runtime) = executable.parent() else {
        return;
    };
    if runtime.parent() != Some(directory)
        || !runtime
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("runtime-"))
    {
        return;
    }
    let Ok(metadata) = std::fs::symlink_metadata(runtime) else {
        return;
    };
    if metadata.file_attributes() & 0x400 != 0 {
        return;
    }
    if let Err(error) = std::fs::remove_dir_all(runtime) {
        eprintln!("Could not remove retired plugin update candidate: {error}");
    }
}

#[cfg(not(windows))]
fn run_update(
    _download: bool,
    _host: &crate::host_update::HostUpdate,
) -> Result<UpdateResult, String> {
    Err("plugin updates require Windows x64".into())
}
