use std::{
    io::{BufReader, Write},
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager, State};
use tokio::sync::watch;

#[path = "../../../../src-tauri/src/image_sync/protocol.rs"]
mod protocol;
mod selection_queue;
use protocol::{
    is_absolute_windows_path, parse_message, read_bounded_line, SyncEnvelope, PIPE_NAME,
};
use selection_queue::SelectionQueue;
const PLUGIN_ID: &str = "luxe.image-sync";

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

struct BridgeState {
    queue: Mutex<SelectionQueue>,
    last_selection: RwLock<Option<SyncEnvelope>>,
    luxe_connected: std::sync::atomic::AtomicBool,
    snapshot: RwLock<ViewerSnapshot>,
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            queue: Mutex::new(SelectionQueue::default()),
            last_selection: RwLock::new(None),
            luxe_connected: std::sync::atomic::AtomicBool::new(false),
            snapshot: RwLock::new(ViewerSnapshot::default()),
        }
    }
}

#[tauri::command]
fn select_image(
    app: tauri::AppHandle,
    image_path: String,
    state: State<'_, Arc<BridgeState>>,
) -> Result<(), String> {
    if !is_absolute_windows_path(&image_path) {
        return Err("image path must be absolute".into());
    }
    let normalized = normalize_windows_path(&image_path);
    let snapshot = state
        .snapshot
        .read()
        .map_err(|_| "snapshot state poisoned")?;
    let active_files = if snapshot.test_machine_column_path.is_some() {
        &snapshot.test_machine_files
    } else {
        &snapshot.files
    };
    if !active_files
        .iter()
        .any(|path| normalize_windows_path(path) == normalized)
    {
        return Err("image path is not in the current HiViewer snapshot".into());
    }
    queue_image_selection(&app, &state, vec![image_path])
}

#[tauri::command]
fn is_luxe_connected(state: State<'_, Arc<BridgeState>>) -> bool {
    state
        .luxe_connected
        .load(std::sync::atomic::Ordering::Acquire)
}

#[tauri::command]
fn get_bridge_state(state: State<'_, Arc<BridgeState>>) -> Result<Value, String> {
    let queue = state.queue.lock().map_err(|_| "queue state poisoned")?;
    let snapshot = state
        .snapshot
        .read()
        .map_err(|_| "snapshot state poisoned")?;
    let selection = state
        .last_selection
        .read()
        .map_err(|_| "selection state poisoned")?;
    Ok(
        json!({ "snapshot": *snapshot, "connected": is_connected(&state),
        "pendingSequence": queue.pending_sequence(), "lastAck": queue.last_ack, "lastSelection": *selection }),
    )
}

#[tauri::command]
fn get_all_locale_bundles() -> Result<Value, String> {
    // Use the same five resources as LUXE; no second set of plugin translations.
    let bundles = [
        (
            "zh_CN",
            include_str!("../../../../src-tauri/resources/translations/zh_CN.json"),
        ),
        (
            "zh_TW",
            include_str!("../../../../src-tauri/resources/translations/zh_TW.json"),
        ),
        (
            "en_US",
            include_str!("../../../../src-tauri/resources/translations/en_US.json"),
        ),
        (
            "ja_JP",
            include_str!("../../../../src-tauri/resources/translations/ja_JP.json"),
        ),
        (
            "tr_TR",
            include_str!("../../../../src-tauri/resources/translations/tr_TR.json"),
        ),
    ];
    let mut result = serde_json::Map::new();
    for (locale, raw) in bundles {
        let bundle: serde_json::Map<String, Value> =
            serde_json::from_str(raw).map_err(|error| error.to_string())?;
        result.insert(
            locale.into(),
            Value::Object(
                bundle
                    .into_iter()
                    .filter(|(key, _)| key.starts_with("image_sync."))
                    .collect(),
            ),
        );
    }
    Ok(Value::Object(result))
}

fn is_connected(state: &BridgeState) -> bool {
    state
        .luxe_connected
        .load(std::sync::atomic::Ordering::Acquire)
}

fn queue_image_selection(
    app: &tauri::AppHandle,
    state: &BridgeState,
    paths: Vec<String>,
) -> Result<(), String> {
    let mut queue = state.queue.lock().map_err(|_| "queue state poisoned")?;
    let sequence = queue.enqueue(paths)?;
    let _ = app.emit("luxe-sync-pending", sequence);
    Ok(())
}

fn normalize_windows_path(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
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
                Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "truncated HiViewer frame",
                ))
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
                        "result": { "protocolVersion": 1, "plugin": { "id": PLUGIN_ID, "version": env!("CARGO_PKG_VERSION") }, "capabilities": [] }
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
                                    if let Ok(mut selection) = state.last_selection.write() {
                                        *selection = None;
                                    }
                                    let _ = app.emit("viewer-updated", snapshot);
                                    drop(current);
                                    let mut paths = sync_path.into_iter().collect::<Vec<_>>();
                                    if !paths.is_empty() {
                                        let mut unique = std::collections::HashSet::new();
                                        paths.retain(|path| {
                                            unique.insert(normalize_windows_path(path))
                                        });
                                        let _ = queue_image_selection(&app, &state, paths);
                                    } else {
                                        if let Ok(mut queue) = state.queue.lock() {
                                            queue.clear();
                                            let _ = app.emit("luxe-sync-cleared", ());
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
                    if accepted
                        && message.get("method").and_then(Value::as_str) == Some("view/open")
                    {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
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
            if let Ok(mut queue) = state.queue.lock() {
                if let Ok(Some(sequence)) = queue.connect(tx) {
                    let _ = app.emit("luxe-sync-pending", sequence);
                }
            }
            state
                .luxe_connected
                .store(true, std::sync::atomic::Ordering::Release);
            let _ = app.emit("luxe-connection", true);
            let mut reader = BufReader::new(read_half);
            let mut line = Vec::with_capacity(1024);
            let mut last_sequences = std::collections::HashMap::<String, u64>::new();
            let mut ack_deadline = None;
            loop {
                tokio::select! {
                    _ = async {
                        if let Some(deadline) = ack_deadline { tokio::time::sleep_until(deadline).await; }
                        else { std::future::pending::<()>().await; }
                    } => { break; }
                    changed = rx.changed() => {
                        if changed.is_err() { break; }
                        let bytes = rx.borrow_and_update().clone();
                        if bytes.is_empty() { ack_deadline = None; continue; }
                        if !matches!(tokio::time::timeout(Duration::from_secs(3), write_half.write_all(&bytes)).await, Ok(Ok(_))) { break; }
                        ack_deadline = Some(tokio::time::Instant::now() + Duration::from_secs(5));
                    }
                    result = read_bounded_line(&mut reader, &mut line) => {
                        let Ok(size) = result else { break; };
                        if size == 0 { break; }
                        let payload = line.strip_suffix(b"\n").unwrap_or(&line);
                        let payload = payload.strip_suffix(b"\r").unwrap_or(payload);
                        if let Ok(raw) = std::str::from_utf8(payload) {
                            if let Ok(message) = parse_message(raw) {
                                if message.source_instance.starts_with("luxe-") {
                                    if message.kind == "selection" {
                                        if !last_sequences.contains_key(&message.source_instance) && last_sequences.len() >= 32 {
                                            line.clear();
                                            continue;
                                        }
                                        let last = last_sequences.entry(message.source_instance.clone()).or_default();
                                        if message.sequence > *last {
                                            *last = message.sequence;
                                            if let Ok(mut selection) = state.last_selection.write() {
                                                *selection = Some(message.clone());
                                            }
                                            let _ = app.emit("luxe-selection", message);
                                        }
                                    } else if let Ok(mut queue) = state.queue.lock() {
                                        if queue.acknowledge(message.clone()) {
                                            ack_deadline = None;
                                            let _ = app.emit("luxe-sync-result", message);
                                        }
                                    }
                                }
                            }
                        }
                        line.clear();
                    }
                }
            }
            if let Ok(mut queue) = state.queue.lock() {
                queue.disconnect();
            }
            state
                .luxe_connected
                .store(false, std::sync::atomic::Ordering::Release);
            let _ = app.emit("luxe-connection", false);
            sleep(Duration::from_secs(1)).await;
        }
    });
}

#[cfg(not(windows))]
fn start_pipe_bridge(_app: tauri::AppHandle, _state: Arc<BridgeState>) {}

fn main() {
    let state = Arc::new(BridgeState::default());
    let protocol_state = state.clone();
    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            select_image,
            is_luxe_connected,
            get_bridge_state,
            get_all_locale_bundles
        ])
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
