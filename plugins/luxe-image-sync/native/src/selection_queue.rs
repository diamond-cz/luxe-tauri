use crate::protocol::SyncEnvelope;
use tokio::sync::watch;

struct PendingSelection {
    paths: Vec<String>,
    sequence: u64,
}

/// All mutations (including reconnect and ACK) take the same external mutex.
#[derive(Default)]
pub struct SelectionQueue {
    sender: Option<watch::Sender<Vec<u8>>>,
    pending: Option<PendingSelection>,
    sequence: u64,
    pub last_ack: Option<SyncEnvelope>,
}

impl SelectionQueue {
    pub fn pending_sequence(&self) -> Option<u64> {
        self.pending.as_ref().map(|pending| pending.sequence)
    }

    pub fn enqueue(&mut self, paths: Vec<String>) -> Result<u64, String> {
        if paths.is_empty() {
            return Err("no image paths provided".into());
        }
        let sequence = self
            .sequence
            .checked_add(1)
            .filter(|value| *value <= 9_007_199_254_740_991)
            .ok_or("image sync sequence exhausted")?;
        let envelope = SyncEnvelope {
            protocol_version: 1,
            kind: "selection".into(),
            source_instance: format!("hiviewer-plugin-{}", std::process::id()),
            sequence,
            image_path: paths.first().cloned(),
            image_paths: Some(paths.clone()),
            accepted: None,
            reason: None,
        };
        let mut bytes = serde_json::to_vec(&envelope).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        if bytes.len() > crate::protocol::MAX_MESSAGE_BYTES + 1 {
            return Err("image sync message too large".into());
        }
        self.sequence = sequence;
        self.pending = Some(PendingSelection { paths, sequence });
        self.last_ack = None;
        if let Some(sender) = &self.sender {
            sender.send_replace(bytes);
        }
        Ok(sequence)
    }

    pub fn connect(&mut self, sender: watch::Sender<Vec<u8>>) -> Result<Option<u64>, String> {
        self.sender = Some(sender);
        // A fresh sequence distinguishes a retry from a delivery already timed out in the WebView.
        match self.pending.as_ref().map(|pending| pending.paths.clone()) {
            Some(paths) => self.enqueue(paths).map(Some),
            None => Ok(None),
        }
    }

    pub fn disconnect(&mut self) {
        self.sender = None;
    }

    pub fn clear(&mut self) {
        self.pending = None;
        self.last_ack = None;
        if let Some(sender) = &self.sender {
            sender.send_replace(Vec::new());
        }
    }

    pub fn acknowledge(&mut self, message: SyncEnvelope) -> bool {
        if self.pending_sequence() != Some(message.sequence) {
            return false;
        }
        self.pending = None;
        self.last_ack = Some(message);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn paths(name: &str) -> Vec<String> {
        vec![format!(r"C:\images\{name}.jpg")]
    }
    fn ack(sequence: u64, accepted: bool) -> SyncEnvelope {
        SyncEnvelope {
            protocol_version: 1,
            kind: "ack".into(),
            source_instance: "luxe-test".into(),
            sequence,
            image_path: None,
            image_paths: None,
            accepted: Some(accepted),
            reason: if accepted {
                None
            } else {
                Some("image-not-indexed".into())
            },
        }
    }

    #[test]
    fn old_ack_cannot_clear_new_selection_and_rejection_is_preserved() {
        let mut queue = SelectionQueue::default();
        let old = queue.enqueue(paths("a")).unwrap();
        let new = queue.enqueue(paths("b")).unwrap();
        assert!(!queue.acknowledge(ack(old, true)));
        assert_eq!(queue.pending_sequence(), Some(new));
        assert!(queue.acknowledge(ack(new, false)));
        assert_eq!(queue.last_ack.as_ref().unwrap().accepted, Some(false));
        assert!(queue.pending_sequence().is_none());
    }

    #[test]
    fn reconnect_only_resends_latest_and_watch_has_bounded_capacity() {
        let mut queue = SelectionQueue::default();
        queue.enqueue(paths("a")).unwrap();
        let latest = queue.enqueue(paths("b")).unwrap();
        let (sender, receiver) = watch::channel(Vec::new());
        let retry = queue.connect(sender).unwrap().unwrap();
        assert!(retry > latest);
        let message =
            crate::protocol::parse_message(std::str::from_utf8(&receiver.borrow()).unwrap())
                .unwrap();
        assert_eq!(message.image_path, Some(paths("b").remove(0)));
        assert!(!queue.acknowledge(ack(latest, true)));
        queue.enqueue(paths("c")).unwrap();
        let message =
            crate::protocol::parse_message(std::str::from_utf8(&receiver.borrow()).unwrap())
                .unwrap();
        assert_eq!(message.image_path, Some(paths("c").remove(0)));
        queue.clear();
        assert!(receiver.borrow().is_empty());
    }
}
