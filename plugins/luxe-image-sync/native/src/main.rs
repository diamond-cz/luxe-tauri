use std::{
    io::{BufReader, Write},
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, State};
use tokio::sync::watch;

const PIPE_NAME: &str = r"\\.\pipe\luxe-image-sync-v1";
const PLUGIN_ID: &str = "luxe.image-sync";
const PROTOCOL_VERSION: u8 = 1;
const MAX_SELECTION_PATHS: usize = 2;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ViewerSnapshot {
    source: String,
    sequence: u64,
    test_machine_column_path: Option<String>,
    #[serde(default)]
    files: Vec<String>,
    current_path: Option<String>,
    #[serde(default)]
    test_machine_files: Vec<String>,
    #[serde(default)]
    test_machine_current_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncEnvelope {
    protocol_version: u8,
    kind: String,
    source_instance: String,
    sequence: u64,
    #[serde(default)]
    image_path: Option<String>,
    #[serde(default)]
    image_paths: Option<Vec<String>>,
    #[serde(default)]
    accepted: Option<bool>,
    #[serde(default)]
    reason: Option<String>,
}

struct BridgeState {
    pipe_tx: Mutex<Option<watch::Sender<Vec<u8>>>>,
    pending_selection: Mutex<Option<Vec<String>>>,
    pending_sequence: Mutex<Option<u64>>,
    sequence: std::sync::atomic::AtomicU64,
    luxe_connected: std::sync::atomic::AtomicBool,
    snapshot: RwLock<ViewerSnapshot>,
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            pipe_tx: Mutex::new(None),
            pending_selection: Mutex::new(None),
            pending_sequence: Mutex::new(None),
            sequence: std::sync::atomic::AtomicU64::new(0),
            luxe_connected: std::sync::atomic::AtomicBool::new(false),
            snapshot: RwLock::new(ViewerSnapshot::default()),
        }
    }
}

#[tauri::command]
fn select_image(image_path: String, state: State<'_, Arc<BridgeState>>) -> Result<(), String> {
    if !is_absolute_windows_path(&image_path) {
        return Err("image path must be absolute".into());
    }
    let normalized = normalize_windows_path(&image_path);
    let snapshot = state
        .snapshot
        .read()
        .map_err(|_| "snapshot state poisoned")?;
    if !snapshot
        .files
        .iter()
        .chain(snapshot.test_machine_files.iter())
        .any(|path| normalize_windows_path(path) == normalized)
    {
        return Err("image path is not in the current HiViewer snapshot".into());
    }
    drop(snapshot);
    queue_image_selection(&state, vec![image_path])
}

#[tauri::command]
fn is_luxe_connected(state: State<'_, Arc<BridgeState>>) -> bool {
    state
        .luxe_connected
        .load(std::sync::atomic::Ordering::Acquire)
}

fn selection_message(state: &BridgeState, paths: &[String]) -> Result<(u64, Vec<u8>), String> {
    let sequence = state
        .sequence
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        + 1;
    let envelope = SyncEnvelope {
        protocol_version: PROTOCOL_VERSION,
        kind: "selection".into(),
        source_instance: format!("hiviewer-plugin-{}", std::process::id()),
        sequence,
        image_path: paths.first().cloned(),
        image_paths: Some(paths.to_vec()),
        accepted: None,
        reason: None,
    };
    let mut bytes = serde_json::to_vec(&envelope).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    Ok((sequence, bytes))
}

fn queue_image_selection(state: &BridgeState, paths: Vec<String>) -> Result<(), String> {
    let paths = paths
        .into_iter()
        .take(MAX_SELECTION_PATHS)
        .collect::<Vec<_>>();
    if paths.is_empty() {
        return Err("no image paths provided".into());
    }
    let (sequence, bytes) = selection_message(state, &paths)?;
    *state
        .pending_selection
        .lock()
        .map_err(|_| "pending selection state poisoned")? = Some(paths.clone());
    *state
        .pending_sequence
        .lock()
        .map_err(|_| "pending sequence state poisoned")? = Some(sequence);
    let sender = state.pipe_tx.lock().map_err(|_| "pipe state poisoned")?;
    if let Some(sender) = sender.as_ref() {
        sender.send_replace(bytes);
        Ok(())
    } else {
        *state
            .pending_selection
            .lock()
            .map_err(|_| "pending selection state poisoned")? = Some(paths);
        Ok(())
    }
}

fn flush_pending_selection(state: &BridgeState) {
    let pending = state
        .pending_selection
        .lock()
        .ok()
        .and_then(|mut pending| pending.take());
    let Some(paths) = pending else { return };
    if queue_image_selection(state, paths.clone()).is_err() {
        if let Ok(mut pending) = state.pending_selection.lock() {
            *pending = Some(paths);
        }
    }
}

fn normalize_windows_path(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn is_absolute_windows_path(path: &str) -> bool {
    path.len() > 3 && path.as_bytes()[1] == b':' && matches!(path.as_bytes()[2], b'\\' | b'/')
        || path.starts_with(r"\\")
}

fn send_host_message(stdout: &Arc<Mutex<std::io::Stdout>>, message: Value) {
    if let Ok(mut bytes) = serde_json::to_vec(&message) {
        bytes.push(b'\n');
        if let Ok(mut output) = stdout.lock() {
            let _ = output.write_all(&bytes);
            let _ = output.flush();
        }
    }
}

fn read_host_line<R: std::io::BufRead>(reader: &mut R) -> std::io::Result<Option<Vec<u8>>> {
    const MAX_HOST_MESSAGE_BYTES: usize = 1024 * 1024;
    let mut line = Vec::with_capacity(4096);
    loop {
        let chunk = reader.fill_buf()?;
        if chunk.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Ok(Some(line))
            };
        }
        let newline = chunk.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(chunk.len(), |index| index + 1);
        if line.len() + take > MAX_HOST_MESSAGE_BYTES + 1 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "HiViewer message exceeded size limit",
            ));
        }
        line.extend_from_slice(&chunk[..take]);
        reader.consume(take);
        if newline.is_some() {
            return Ok(Some(line));
        }
    }
}

fn start_host_protocol(app: tauri::AppHandle, state: Arc<BridgeState>) {
    let stdout = Arc::new(Mutex::new(std::io::stdout()));
    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut reader = BufReader::new(stdin.lock());
        loop {
            let Ok(Some(line)) = read_host_line(&mut reader) else {
                break;
            };
            let line = line.strip_suffix(b"\n").unwrap_or(&line);
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            let Ok(message) = serde_json::from_slice::<Value>(line) else {
                continue;
            };
            let id = message.get("id").cloned().unwrap_or(Value::Null);
            match message.get("method").and_then(Value::as_str) {
                Some("plugin/initialize") => send_host_message(
                    &stdout,
                    json!({
                        "jsonrpc": "2.0", "id": id,
                        "result": { "protocolVersion": 1, "plugin": { "id": PLUGIN_ID, "version": "0.1.2" }, "capabilities": [] }
                    }),
                ),
                Some("view/open") | Some("viewer/update") => {
                    let snapshot = message
                        .get("params")
                        .and_then(|params| params.get("viewer"))
                        .cloned()
                        .and_then(|value| serde_json::from_value::<ViewerSnapshot>(value).ok());
                    let accepted = if let Some(snapshot) = snapshot {
                        if snapshot.files.len() <= 1000
                            && snapshot.test_machine_files.len() <= 1000
                            && snapshot
                                .files
                                .iter()
                                .all(|path| is_absolute_windows_path(path))
                            && snapshot
                                .test_machine_files
                                .iter()
                                .all(|path| is_absolute_windows_path(path))
                            && snapshot.current_path.as_deref().is_none_or(|current| {
                                snapshot.files.iter().any(|path| {
                                    normalize_windows_path(path) == normalize_windows_path(current)
                                })
                            })
                            && snapshot
                                .test_machine_current_path
                                .as_deref()
                                .is_none_or(|current| {
                                    snapshot.test_machine_files.iter().any(|path| {
                                        normalize_windows_path(path)
                                            == normalize_windows_path(current)
                                    })
                                })
                        {
                            if let Ok(mut current) = state.snapshot.write() {
                                if snapshot.sequence >= current.sequence {
                                    let sync_path = if snapshot.test_machine_column_path.is_some() {
                                        snapshot.test_machine_current_path.clone()
                                    } else {
                                        snapshot.current_path.clone()
                                    };
                                    *current = snapshot.clone();
                                    let _ = app.emit("viewer-updated", snapshot);
                                    drop(current);
                                    let paths = sync_path.into_iter().collect::<Vec<_>>();
                                    if !paths.is_empty() {
                                        let mut unique = std::collections::HashSet::new();
                                        paths.retain(|path| {
                                            unique.insert(normalize_windows_path(path))
                                        });
                                        let _ = queue_image_selection(&state, paths);
                                    } else {
                                        if let Ok(mut pending) = state.pending_selection.lock() {
                                            *pending = None;
                                        }
                                        if let Ok(mut pending) = state.pending_sequence.lock() {
                                            *pending = None;
                                        }
                                        if let Ok(sender) = state.pipe_tx.lock() {
                                            if let Some(sender) = sender.as_ref() {
                                                sender.send_replace(Vec::new());
                                            }
                                        }
                                    }
                                    true
                                } else {
                                    false
                                }
                            } else {
                                false
                            }
                        } else {
                            false
                        }
                    } else {
                        false
                    };
                    send_host_message(
                        &stdout,
                        json!({
                            "jsonrpc": "2.0", "id": id, "result": { "accepted": accepted }
                        }),
                    );
                }
                Some("plugin/shutdown") => break,
                _ => {
                    if !id.is_null() {
                        send_host_message(
                            &stdout,
                            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "method not found" } }),
                        );
                    }
                }
            }
        }
        std::process::exit(0);
    });
}

#[cfg(windows)]
fn start_pipe_bridge(app: tauri::AppHandle, state: Arc<BridgeState>) {
    tauri::async_runtime::spawn(async move {
        use tokio::{
            io::{AsyncWriteExt, BufReader},
            net::windows::named_pipe::ClientOptions,
            time::sleep,
        };
        loop {
            let client = match ClientOptions::new().open(PIPE_NAME) {
                Ok(client) => client,
                Err(_) => {
                    sleep(Duration::from_secs(1)).await;
                    continue;
                }
            };
            let (read_half, mut write_half) = tokio::io::split(client);
            let (tx, mut rx) = watch::channel::<Vec<u8>>(Vec::new());
            *state.pipe_tx.lock().unwrap() = Some(tx);
            state
                .luxe_connected
                .store(true, std::sync::atomic::Ordering::Release);
            flush_pending_selection(&state);
            let _ = app.emit("luxe-connection", true);
            let mut reader = BufReader::new(read_half);
            let mut line = Vec::with_capacity(1024);
            loop {
                tokio::select! {
                    changed = rx.changed() => {
                        if changed.is_err() { break; }
                        let bytes = rx.borrow_and_update().clone();
                        if bytes.is_empty() { continue; }
                        if write_half.write_all(&bytes).await.is_err() { break; }
                    }
                    result = read_bounded_line(&mut reader, &mut line) => {
                        let Ok(size) = result else { break; };
                        if size == 0 { break; }
                        let payload = line.strip_suffix(b"\n").unwrap_or(&line);
                        let payload = payload.strip_suffix(b"\r").unwrap_or(payload);
                        if let Ok(message) = serde_json::from_slice::<SyncEnvelope>(payload) {
                            if message.kind == "selection" {
                                let _ = app.emit("luxe-selection", message);
                            } else if message.kind == "ack"
                                && message.source_instance.starts_with("luxe-")
                            {
                                let matches_pending = state
                                    .pending_sequence
                                    .lock()
                                    .ok()
                                    .is_some_and(|pending| *pending == Some(message.sequence));
                                if matches_pending {
                                    if let Ok(mut pending) = state.pending_selection.lock() {
                                        *pending = None;
                                    }
                                    if let Ok(mut pending) = state.pending_sequence.lock() {
                                        *pending = None;
                                    }
                                }
                            }
                        }
                        line.clear();
                    }
                }
            }
            *state.pipe_tx.lock().unwrap() = None;
            state
                .luxe_connected
                .store(false, std::sync::atomic::Ordering::Release);
            let _ = app.emit("luxe-connection", false);
            sleep(Duration::from_secs(1)).await;
        }
    });
}

#[cfg(windows)]
use tokio::io::{AsyncBufRead, AsyncBufReadExt};

#[cfg(windows)]
async fn read_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    line: &mut Vec<u8>,
) -> std::io::Result<usize> {
    const MAX_MESSAGE_BYTES: usize = 16 * 1024;
    line.clear();
    loop {
        let chunk = reader.fill_buf().await?;
        if chunk.is_empty() {
            return Ok(line.len());
        }
        let newline = chunk.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(chunk.len(), |index| index + 1);
        if line.len() + take > MAX_MESSAGE_BYTES + 1 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "image sync message exceeded size limit",
            ));
        }
        line.extend_from_slice(&chunk[..take]);
        reader.consume(take);
        if newline.is_some() {
            return Ok(line.len());
        }
    }
}

#[cfg(not(windows))]
fn start_pipe_bridge(_app: tauri::AppHandle, _state: Arc<BridgeState>) {}

fn main() {
    let state = Arc::new(BridgeState::default());
    let protocol_state = state.clone();
    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![select_image, is_luxe_connected])
        .setup(move |app| {
            start_host_protocol(app.handle().clone(), protocol_state.clone());
            start_pipe_bridge(app.handle().clone(), protocol_state.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run LUXE image sync plugin");
}
