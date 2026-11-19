use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub sequence: u64,
    pub phase: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
}

fn publish(
    app: &tauri::AppHandle,
    state: &crate::BridgeState,
    phase: &str,
    downloaded: u64,
    total: Option<u64>,
    version: Option<String>,
    path: Option<String>,
    error: Option<String>,
) {
    if let Ok(mut latest) = state.update_progress.lock() {
        let progress = UpdateProgress {
            sequence: latest.as_ref().map_or(1, |old| old.sequence + 1),
            phase: phase.into(),
            downloaded,
            total,
            version,
            path,
            error,
        };
        *latest = Some(progress.clone());
        // Store before emitting: listeners registered later recover this snapshot.
        let _ = app.emit("plugin-update-progress", &progress);
        // Existing plugin/progress transports a bounded card snapshot without
        // adding permissions or changing the installed manifest contract.
        let _ = state.host_update.send(&serde_json::json!({
            "jsonrpc": "2.0", "method": "plugin/progress", "params": {
                "value": total.filter(|total| *total > 0)
                    .map_or(0.0, |total| downloaded as f64 / total as f64),
                "message": card_progress(&progress).to_string()
            }
        }));
    }
}

fn begin(app: &tauri::AppHandle, state: &crate::BridgeState) -> Result<UpdateGuard, String> {
    if UPDATING.swap(true, Ordering::AcqRel) {
        return Err("plugin update already running".into());
    }
    publish(app, state, "checking", 0, None, None, None, None);
    Ok(UpdateGuard)
}

fn execute(
    app: &tauri::AppHandle,
    state: &crate::BridgeState,
    download: bool,
) -> Result<UpdateProgress, String> {
    let report = |phase: &str, downloaded, total, version| {
        publish(app, state, phase, downloaded, total, version, None, None)
    };
    match run_update(download, &state.host_update, &report) {
        Ok(result) => {
            let phase = if result.installed {
                "installed"
            } else if result.path.is_some() {
                "manual"
            } else if result.available {
                "available"
            } else {
                "latest"
            };
            publish(
                app,
                state,
                phase,
                0,
                None,
                Some(result.version),
                result.path,
                None,
            );
        }
        Err(error) => publish(app, state, "error", 0, None, None, None, Some(error)),
    }
    state
        .update_progress
        .lock()
        .map_err(|_| "update state poisoned".to_owned())?
        .clone()
        .ok_or_else(|| "update state unavailable".into())
}

/// A card click starts work here, independently of WebView initialization.
pub fn start_from_host(app: tauri::AppHandle, state: Arc<crate::BridgeState>, download: bool) {
    let Ok(guard) = begin(&app, &state) else {
        return;
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let _ = execute(&app, &state, download);
    });
}

fn card_progress(progress: &UpdateProgress) -> Value {
    serde_json::json!({
        "kind": "plugin-update-v1", "sequence": progress.sequence,
        "phase": progress.phase, "downloaded": progress.downloaded,
        "total": progress.total, "version": progress.version.as_ref().map(|version| version.chars().take(48).collect::<String>()),
        "error": progress.error.as_ref().map(|error| error.chars().take(40).collect::<String>())
    })
}

pub fn host_download(params: &Value) -> Result<bool, &'static str> {
    match params.get("updateAction").and_then(Value::as_str) {
        None | Some("check") => Ok(false),
        Some("install") => Ok(true),
        _ => Err("invalid update action"),
    }
}

#[tauri::command]
pub async fn update_plugin(
    app: tauri::AppHandle,
    download: bool,
    state: tauri::State<'_, std::sync::Arc<crate::BridgeState>>,
) -> Result<UpdateProgress, String> {
    let guard = match begin(&app, &state) {
        Ok(guard) => guard,
        Err(error) => {
            return state
                .update_progress
                .lock()
                .map_err(|_| "update state poisoned".to_owned())?
                .clone()
                .ok_or(error)
        }
    };
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        execute(&app, &state, download)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(windows)]
fn run_update(
    download: bool,
    host: &crate::host_update::HostUpdate,
    report: &impl Fn(&str, u64, Option<u64>, Option<String>),
) -> Result<UpdateResult, String> {
    use std::{
        os::windows::process::CommandExt,
        path::PathBuf,
        process::{Command, Stdio},
    };
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
    let mut child = Command::new(powershell)
        .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
        .arg(include_str!("../update.ps1"))
        .env(
            "LUXE_PLUGIN_UPDATE_MODE",
            if download { "download" } else { "check" },
        )
        .env("LUXE_PLUGIN_CURRENT_VERSION", env!("CARGO_PKG_VERSION"))
        .env("LUXE_PLUGIN_PROGRESS", "1")
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
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let stderr = child.stderr.take().ok_or("updater stderr unavailable")?;
    let error_reader = std::thread::spawn(move || {
        use std::io::Read;
        let mut bytes = Vec::new();
        let _ = stderr.take(8192).read_to_end(&mut bytes);
        String::from_utf8_lossy(&bytes).trim().to_owned()
    });
    let stdout = child.stdout.take().ok_or("updater stdout unavailable")?;
    let parsed = read_update_stream(std::io::BufReader::new(stdout), report);
    if parsed.is_err() {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|error| error.to_string())?;
    let stderr = error_reader
        .join()
        .unwrap_or_else(|_| "updater stderr reader failed".into());
    if !status.success() {
        return Err(if stderr.is_empty() {
            parsed
                .err()
                .unwrap_or_else(|| "plugin updater failed".into())
        } else {
            stderr
        });
    }
    let mut result = parsed?;
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
            report("preparing", 0, None, Some(result.version.clone()));
            let receipt = match host.install_with_progress(executable, &result.version, || {
                report("installing", 0, None, Some(result.version.clone()))
            }) {
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
            report("installed", 0, None, Some(result.version.clone()));
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
    _report: &impl Fn(&str, u64, Option<u64>, Option<String>),
) -> Result<UpdateResult, String> {
    Err("plugin updates require Windows x64".into())
}

fn read_update_stream(
    mut reader: impl std::io::BufRead,
    report: &impl Fn(&str, u64, Option<u64>, Option<String>),
) -> Result<UpdateResult, String> {
    let mut result = None;
    loop {
        let mut line = Vec::new();
        loop {
            let chunk = reader.fill_buf().map_err(|error| error.to_string())?;
            if chunk.is_empty() {
                if line.is_empty() {
                    return result.ok_or_else(|| "updater returned no result".into());
                }
                return Err("truncated update progress frame".into());
            }
            let count = chunk
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(chunk.len(), |index| index + 1);
            if line.len() + count > 16384 {
                return Err("update progress frame exceeds limit".into());
            }
            let complete = chunk[count - 1] == b'\n';
            line.extend_from_slice(&chunk[..count]);
            reader.consume(count);
            if complete {
                break;
            }
        }
        let frame: Value = serde_json::from_slice(&line).map_err(|error| error.to_string())?;
        match frame["kind"].as_str() {
            Some("progress") => {
                let phase = frame["phase"].as_str().ok_or("missing update phase")?;
                if !matches!(
                    phase,
                    "checking" | "downloading" | "verifying" | "extracting"
                ) {
                    return Err("invalid updater phase".into());
                }
                let downloaded = frame["downloaded"].as_u64().unwrap_or(0);
                let total = frame["total"].as_u64().filter(|total| *total > 0);
                if downloaded > 128 * 1024 * 1024
                    || total.is_some_and(|total| downloaded > total || total > 128 * 1024 * 1024)
                {
                    return Err("invalid update byte progress".into());
                }
                report(
                    phase,
                    downloaded,
                    total,
                    frame["version"].as_str().map(str::to_owned),
                );
            }
            Some("result") if result.is_none() => {
                result = Some(
                    serde_json::from_value(frame["result"].clone())
                        .map_err(|error| error.to_string())?,
                );
            }
            _ => return Err("invalid updater response".into()),
        }
    }
}

#[cfg(test)]
mod progress_tests {
    use super::*;
    #[test]
    fn card_check_does_not_download_and_install_is_explicit() {
        assert_eq!(host_download(&serde_json::json!({})), Ok(false));
        assert_eq!(
            host_download(&serde_json::json!({"updateAction":"check"})),
            Ok(false)
        );
        assert_eq!(
            host_download(&serde_json::json!({"updateAction":"install"})),
            Ok(true)
        );
        assert!(host_download(&serde_json::json!({"updateAction":"anything"})).is_err());
    }

    #[test]
    fn card_snapshot_fits_the_existing_host_message_budget() {
        let progress = UpdateProgress {
            sequence: u64::MAX,
            phase: "error".into(),
            downloaded: 128 * 1024 * 1024,
            total: Some(128 * 1024 * 1024),
            version: Some("0.1.8".into()),
            path: Some("x".repeat(8192)),
            error: Some("\"\\\n".repeat(200)),
        };
        let snapshot = card_progress(&progress);
        assert!(snapshot.to_string().chars().count() <= 500);
        assert!(snapshot.get("path").is_none());
        assert_eq!(snapshot["kind"], "plugin-update-v1");
    }
    #[test]
    fn progress_stream_preserves_bytes_and_requires_final_result() {
        let frames = concat!("{\"kind\":\"progress\",\"phase\":\"downloading\",\"downloaded\":64,\"total\":128,\"version\":\"0.1.8\"}\n",
            "{\"kind\":\"result\",\"result\":{\"available\":true,\"version\":\"0.1.8\",\"path\":null}}\n");
        let observed = std::cell::RefCell::new(Vec::new());
        let result = read_update_stream(
            std::io::Cursor::new(frames),
            &|phase, bytes, total, version| {
                observed
                    .borrow_mut()
                    .push((phase.to_owned(), bytes, total, version))
            },
        )
        .unwrap();
        assert_eq!(result.version, "0.1.8");
        assert_eq!(
            observed.borrow()[0],
            ("downloading".into(), 64, Some(128), Some("0.1.8".into()))
        );
        for invalid in [
            "",
            "{}\n",
            "{\"kind\":\"progress\",\"phase\":\"installed\"}\n",
            "{\"kind\":\"progress\",\"phase\":\"downloading\",\"downloaded\":2,\"total\":1}\n",
        ] {
            assert!(read_update_stream(std::io::Cursor::new(invalid), &|_, _, _, _| {}).is_err());
        }
        assert!(
            read_update_stream(std::io::Cursor::new(vec![b'x'; 16385]), &|_, _, _, _| {}).is_err()
        );
    }
}
