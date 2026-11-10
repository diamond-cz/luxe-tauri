use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{broadcast, oneshot};

pub mod protocol;
#[cfg(windows)]
mod security;
pub use protocol::{parse_message, SyncEnvelope};
use protocol::{read_bounded_line, MAX_MESSAGE_BYTES, PIPE_NAME};

pub const SELECTION_EVENT: &str = crate::events::IMAGE_SYNC_SELECTION;
const MAX_CLIENTS_PER_PROCESS: usize = 32;
const MAX_PENDING_DELIVERIES: usize = 32;
static LOCAL_SEQUENCE: AtomicU64 = AtomicU64::new(0);

impl SyncEnvelope {
    pub fn selection(source_instance: impl Into<String>, image_path: impl Into<String>) -> Self {
        Self {
            protocol_version: 1,
            kind: "selection".into(),
            source_instance: source_instance.into(),
            sequence: LOCAL_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1,
            image_path: Some(image_path.into()),
            image_paths: None,
            accepted: None,
            reason: None,
        }
    }

    fn ack(sequence: u64, result: SelectionResult) -> Self {
        Self {
            protocol_version: 1,
            kind: "ack".into(),
            source_instance: format!("luxe-{}", std::process::id()),
            sequence,
            image_path: None,
            image_paths: None,
            accepted: Some(result.accepted),
            reason: result.reason,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionResult {
    pub accepted: bool,
    pub reason: Option<String>,
}

impl SelectionResult {
    fn rejected(reason: &str) -> Self {
        Self {
            accepted: false,
            reason: Some(reason.into()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectionDelivery {
    #[serde(flatten)]
    message: SyncEnvelope,
    delivery_id: String,
}

type PendingDeliveries = Arc<Mutex<HashMap<String, oneshot::Sender<SelectionResult>>>>;

// Drop on timeout, task cancellation or disconnect as well as normal completion.
struct DeliveryGuard {
    id: String,
    pending: PendingDeliveries,
}

impl Drop for DeliveryGuard {
    fn drop(&mut self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(&self.id);
        }
    }
}

#[derive(Clone)]
pub struct ImageSyncHub {
    outbound: broadcast::Sender<SyncEnvelope>,
    pending: PendingDeliveries,
    next_delivery: Arc<AtomicU64>,
}

impl Default for ImageSyncHub {
    fn default() -> Self {
        let (outbound, _) = broadcast::channel(64);
        Self {
            outbound,
            pending: Arc::default(),
            next_delivery: Arc::default(),
        }
    }
}

impl ImageSyncHub {
    pub fn publish(&self, message: SyncEnvelope) {
        let _ = self.outbound.send(message);
    }

    pub fn complete(&self, id: &str, result: SelectionResult) {
        let sender = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(id));
        if let Some(sender) = sender {
            let _ = sender.send(result);
        }
    }

    fn reserve(&self) -> Option<(DeliveryGuard, oneshot::Receiver<SelectionResult>)> {
        let mut pending = self.pending.lock().ok()?;
        if pending.len() >= MAX_PENDING_DELIVERIES {
            return None;
        }
        let id = self
            .next_delivery
            .fetch_add(1, Ordering::Relaxed)
            .to_string();
        let (sender, receiver) = oneshot::channel();
        pending.insert(id.clone(), sender);
        Some((
            DeliveryGuard {
                id,
                pending: self.pending.clone(),
            },
            receiver,
        ))
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
        task::JoinSet,
        time::{sleep, timeout, Duration},
    };
    loop {
        let mut options = ServerOptions::new();
        options
            .max_instances(MAX_CLIENTS_PER_PROCESS)
            .reject_remote_clients(true)
            .in_buffer_size(MAX_MESSAGE_BYTES as u32)
            .out_buffer_size(MAX_MESSAGE_BYTES as u32);
        let server = match security::create_private_pipe(&options, PIPE_NAME) {
            Ok(server) => server,
            Err(error) => {
                tracing::warn!(%error, "image sync named pipe unavailable; retrying");
                sleep(Duration::from_secs(2)).await;
                continue;
            }
        };
        if let Err(error) = server.connect().await {
            tracing::debug!(%error, "image sync named pipe disconnected before connect");
            continue;
        }
        let app = app.clone();
        let hub = hub.clone();
        let mut outbound = hub.outbound.subscribe();
        tokio::spawn(async move {
            let (read_half, mut write_half) = tokio::io::split(server);
            let mut reader = BufReader::new(read_half);
            let mut line = Vec::with_capacity(1024);
            let mut last_sequence = HashMap::<String, u64>::new();
            let mut confirmations = JoinSet::<SyncEnvelope>::new();
            loop {
                let response = tokio::select! {
                    read = read_bounded_line(&mut reader, &mut line) => {
                        match read { Ok(0) | Err(_) => break, _ => {} }
                        let bytes = std::mem::take(&mut line);
                        let raw = match std::str::from_utf8(&bytes) { Ok(raw) => raw, Err(_) => continue };
                        let message = match parse_message(raw.trim_end_matches(['\r', '\n'])) {
                            Ok(message) => message,
                            Err(reason) => { tracing::debug!(reason, "invalid image sync message"); continue; }
                        };
                        if message.kind != "selection" || message.source_instance.starts_with("luxe-") { continue; }
                        let rejection = if !last_sequence.contains_key(&message.source_instance) && last_sequence.len() >= MAX_CLIENTS_PER_PROCESS {
                            Some("too-many-sources")
                        } else if last_sequence.get(&message.source_instance).is_some_and(|last| message.sequence <= *last) {
                            Some("stale-sequence")
                        } else { None };
                        if let Some(reason) = rejection {
                            Some(SyncEnvelope::ack(message.sequence, SelectionResult::rejected(reason)))
                        } else {
                            last_sequence.insert(message.source_instance.clone(), message.sequence);
                            // Bound both live reservations and completed tasks awaiting the writer.
                            let reservation = if confirmations.len() < MAX_PENDING_DELIVERIES { hub.reserve() } else { None };
                            if let Some((guard, receiver)) = reservation {
                                let sequence = message.sequence;
                                let delivery = SelectionDelivery { message, delivery_id: guard.id.clone() };
                                let emitted = app.emit_to("main", SELECTION_EVENT, &delivery).is_ok();
                                confirmations.spawn(async move {
                                    let result = if emitted {
                                        timeout(Duration::from_secs(3), receiver).await.ok().and_then(Result::ok)
                                            .unwrap_or_else(|| SelectionResult::rejected("frontend-timeout"))
                                    } else { SelectionResult::rejected("frontend-unavailable") };
                                    drop(guard);
                                    SyncEnvelope::ack(sequence, result)
                                });
                                None
                            } else {
                                Some(SyncEnvelope::ack(message.sequence, SelectionResult::rejected("receiver-busy")))
                            }
                        }
                    }
                    confirmation = confirmations.join_next(), if !confirmations.is_empty() => {
                        confirmation.and_then(Result::ok)
                    }
                    message = outbound.recv() => {
                        match message {
                            Ok(message) => Some(message),
                            Err(broadcast::error::RecvError::Closed) => break,
                            Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        }
                    }
                };
                if let Some(response) = response {
                    if let Ok(mut bytes) = serde_json::to_vec(&response) {
                        bytes.push(b'\n');
                        if !matches!(
                            timeout(Duration::from_secs(3), write_half.write_all(&bytes)).await,
                            Ok(Ok(_))
                        ) {
                            break;
                        }
                    }
                }
            }
            // JoinSet drop aborts confirmations; their guards release pending deliveries.
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn confirmation_is_application_result_and_late_completion_is_ignored() {
        let hub = ImageSyncHub::default();
        let (guard, receiver) = hub.reserve().unwrap();
        hub.complete(&guard.id, SelectionResult::rejected("image-not-indexed"));
        let result = receiver.await.unwrap();
        assert!(!result.accepted);
        assert_eq!(result.reason.as_deref(), Some("image-not-indexed"));
        hub.complete(
            &guard.id,
            SelectionResult {
                accepted: true,
                reason: None,
            },
        );
        drop(guard);
        assert!(hub.pending.lock().unwrap().is_empty());
    }

    #[test]
    fn pending_deliveries_are_bounded_and_cancellation_releases_capacity() {
        let hub = ImageSyncHub::default();
        let mut reservations = (0..MAX_PENDING_DELIVERIES)
            .map(|_| hub.reserve().unwrap())
            .collect::<Vec<_>>();
        assert!(hub.reserve().is_none());
        reservations.pop();
        assert!(hub.reserve().is_some());
        drop(reservations);
        assert!(hub.pending.lock().unwrap().is_empty());
    }
}
