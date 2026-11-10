use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast;

pub const PIPE_NAME: &str = r"\\.\pipe\luxe-image-sync-v1";
pub const SELECTION_EVENT: &str = "image_sync_selection";
const MAX_MESSAGE_BYTES: usize = 16 * 1024;
const MAX_CLIENTS_PER_PROCESS: usize = 32;

static LOCAL_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncEnvelope {
    pub protocol_version: u8,
    pub kind: String,
    pub source_instance: String,
    pub sequence: u64,
    #[serde(default)]
    pub image_path: Option<String>,
    #[serde(default)]
    pub accepted: Option<bool>,
    #[serde(default)]
    pub reason: Option<String>,
}

impl SyncEnvelope {
    pub fn selection(source_instance: impl Into<String>, image_path: impl Into<String>) -> Self {
        Self {
            protocol_version: 1,
            kind: "selection".into(),
            source_instance: source_instance.into(),
            sequence: LOCAL_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1,
            image_path: Some(image_path.into()),
            accepted: None,
            reason: None,
        }
    }

    fn ack(source_instance: &str, sequence: u64, accepted: bool, reason: Option<&str>) -> Self {
        Self {
            protocol_version: 1,
            kind: "ack".into(),
            source_instance: source_instance.into(),
            sequence,
            image_path: None,
            accepted: Some(accepted),
            reason: reason.map(str::to_owned),
        }
    }
}

#[derive(Clone)]
pub struct ImageSyncHub {
    outbound: broadcast::Sender<SyncEnvelope>,
}

impl Default for ImageSyncHub {
    fn default() -> Self {
        let (outbound, _) = broadcast::channel(64);
        Self { outbound }
    }
}

impl ImageSyncHub {
    pub fn publish(&self, message: SyncEnvelope) {
        let _ = self.outbound.send(message);
    }

    fn subscribe(&self) -> broadcast::Receiver<SyncEnvelope> {
        self.outbound.subscribe()
    }
}

pub fn start(app: AppHandle, hub: ImageSyncHub) {
    #[cfg(windows)]
    tauri::async_runtime::spawn(run_pipe_server(app, hub));

    #[cfg(not(windows))]
    {
        let _ = (app, hub);
    }
}

#[cfg(windows)]
async fn run_pipe_server(app: AppHandle, hub: ImageSyncHub) {
    use tokio::{
        io::{AsyncWriteExt, BufReader},
        net::windows::named_pipe::ServerOptions,
        time::{sleep, Duration},
    };

    loop {
        let mut options = ServerOptions::new();
        options
            .max_instances(MAX_CLIENTS_PER_PROCESS)
            .reject_remote_clients(true)
            .in_buffer_size(MAX_MESSAGE_BYTES as u32)
            .out_buffer_size(MAX_MESSAGE_BYTES as u32);
        let server = match options.create(PIPE_NAME) {
            Ok(server) => server,
            Err(error) => {
                tracing::warn!(%error, "image sync named pipe unavailable; retrying");
                sleep(Duration::from_secs(2)).await;
                continue;
            }
        };
        if let Err(error) = server.connect().await {
            tracing::debug!(%error, "image sync named pipe client disconnected before connect");
            continue;
        }

        let app = app.clone();
        let mut outbound = hub.subscribe();
        tokio::spawn(async move {
            let (read_half, mut write_half) = tokio::io::split(server);
            let mut reader = BufReader::new(read_half);
            let mut line = Vec::with_capacity(1024);
            let mut last_sequence = std::collections::HashMap::<String, u64>::new();
            loop {
                tokio::select! {
                    read = read_bounded_line(&mut reader, &mut line) => {
                        let read = match read {
                            Ok(read) => read,
                            Err(error) => {
                                tracing::debug!(%error, "image sync pipe read failed");
                                break;
                            }
                        };
                        if read == 0 { break; }
                        let payload = line.strip_suffix(b"\n").unwrap_or(&line);
                        let payload = payload.strip_suffix(b"\r").unwrap_or(payload);
                        if payload.len() > MAX_MESSAGE_BYTES {
                            tracing::warn!("image sync pipe message exceeded size limit");
                            break;
                        }
                        let raw = std::str::from_utf8(payload).map(str::to_owned);
                        line.clear();
                        let raw = match raw {
                            Ok(raw) => raw,
                            Err(_) => continue,
                        };
                        let message = match parse_message(raw.trim_end()) {
                            Ok(message) => message,
                            Err(reason) => {
                                tracing::debug!(reason, "discarding invalid image sync message");
                                continue;
                            }
                        };
                        if message.kind != "selection" || message.source_instance.starts_with("luxe-") {
                            continue;
                        }
                        if !last_sequence.contains_key(&message.source_instance)
                            && last_sequence.len() >= MAX_CLIENTS_PER_PROCESS
                        {
                            continue;
                        }
                        if last_sequence.get(&message.source_instance)
                            .is_some_and(|last| message.sequence <= *last) {
                            continue;
                        }
                        last_sequence.insert(message.source_instance.clone(), message.sequence);
                        let Some(path) = message.image_path.as_deref() else { continue };
                        if !std::path::Path::new(path).is_absolute() { continue; }
                        let accepted = app.emit(SELECTION_EVENT, &message).is_ok();
                        let ack = SyncEnvelope::ack(
                            &format!("luxe-{}", std::process::id()),
                            message.sequence,
                            accepted,
                            if accepted { None } else { Some("frontend-unavailable") },
                        );
                        if let Ok(mut response) = serde_json::to_vec(&ack) {
                            response.push(b'\n');
                            if write_half.write_all(&response).await.is_err() { break; }
                        }
                    }
                    message = outbound.recv() => {
                        let Ok(message) = message else { continue; };
                        if let Ok(mut response) = serde_json::to_vec(&message) {
                            response.push(b'\n');
                            if write_half.write_all(&response).await.is_err() { break; }
                        }
                    }
                }
            }
        });
    }
}

#[cfg(windows)]
use tokio::io::{AsyncBufRead, AsyncBufReadExt};

#[cfg(windows)]
async fn read_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    line: &mut Vec<u8>,
) -> std::io::Result<usize> {
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

pub fn parse_message(line: &str) -> Result<SyncEnvelope, &'static str> {
    if line.len() > MAX_MESSAGE_BYTES {
        return Err("message-too-large");
    }
    let message: SyncEnvelope = serde_json::from_str(line).map_err(|_| "invalid-json")?;
    if message.protocol_version != 1 {
        return Err("unsupported-version");
    }
    if message.source_instance.is_empty() || message.source_instance.len() > 128 {
        return Err("invalid-source-instance");
    }
    if message.kind != "selection" && message.kind != "ack" {
        return Err("invalid-kind");
    }
    if message.kind == "selection" && message.image_path.is_none() {
        return Err("missing-image-path");
    }
    Ok(message)
}

#[cfg(test)]
mod tests {
    use super::{parse_message, SyncEnvelope};

    #[test]
    fn parses_selection_and_rejects_unknown_versions() {
        let message = parse_message(r#"{"protocolVersion":1,"kind":"selection","sourceInstance":"viewer-test","sequence":7,"imagePath":"C:\\images\\a.jpg"}"#).unwrap();
        assert_eq!(message.sequence, 7);
        assert_eq!(message.image_path.as_deref(), Some(r"C:\images\a.jpg"));
        assert_eq!(
            parse_message(
                r#"{"protocolVersion":2,"kind":"selection","sourceInstance":"viewer-test","sequence":7,"imagePath":"C:\\images\\a.jpg"}"#
            ),
            Err("unsupported-version")
        );
    }

    #[test]
    fn local_selection_has_versioned_envelope() {
        let message = SyncEnvelope::selection("luxe-test", r"C:\images\a.jpg");
        assert_eq!(message.protocol_version, 1);
        assert_eq!(message.kind, "selection");
        assert!(message.sequence > 0);
    }

    #[test]
    fn rejects_oversized_messages_before_json_parsing() {
        let line = " ".repeat(super::MAX_MESSAGE_BYTES + 1);
        assert_eq!(parse_message(&line), Err("message-too-large"));
    }
}
