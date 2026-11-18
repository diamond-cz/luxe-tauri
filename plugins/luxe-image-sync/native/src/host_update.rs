//! Authorized callbacks share the existing JSONL session. Its reader keeps
//! servicing viewer/update while a separate updater thread waits for a reply.
use serde_json::{json, Value};
use std::{
    io::Write,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};

type Pending = Option<(String, mpsc::SyncSender<Result<Value, String>>)>;

pub struct HostUpdate {
    output: Arc<Mutex<Box<dyn Write + Send>>>,
    authorized: AtomicBool,
    connected: AtomicBool,
    sequence: AtomicU64,
    pending: Mutex<Pending>,
}

impl Default for HostUpdate {
    fn default() -> Self {
        Self {
            output: Arc::new(Mutex::new(Box::new(std::io::stdout()))),
            authorized: AtomicBool::new(false),
            connected: AtomicBool::new(false),
            sequence: AtomicU64::new(0),
            pending: Mutex::new(None),
        }
    }
}

impl HostUpdate {
    pub fn initialize(&self, params: &Value) {
        let contains = |value: &Value, key: &str| {
            value
                .as_array()
                .is_some_and(|items| items.iter().any(|item| item == key))
        };
        self.authorized.store(
            contains(&params["host"]["capabilities"], "plugin.update.v1")
                && contains(&params["permissions"], "native.update"),
            Ordering::Release,
        );
        self.connected.store(true, Ordering::Release);
    }

    pub fn available(&self) -> bool {
        self.authorized.load(Ordering::Acquire) && self.connected.load(Ordering::Acquire)
    }

    pub fn send(&self, message: &Value) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(message).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        let mut output = self.output.lock().map_err(|_| "host output poisoned")?;
        output
            .write_all(&bytes)
            .and_then(|_| output.flush())
            .map_err(|error| error.to_string())
    }

    /// Responses use string IDs; numeric host requests continue through the reader.
    pub fn receive(&self, message: &Value) -> bool {
        if message.get("method").is_some() {
            return false;
        }
        let Some(id) = message.get("id").and_then(Value::as_str) else {
            return false;
        };
        if let Ok(mut pending) = self.pending.lock() {
            if pending.as_ref().is_some_and(|(expected, _)| expected == id) {
                let (_, sender) = pending.take().expect("matched pending callback");
                let _ = sender.send(callback_result(message));
            }
        }
        true
    }

    pub fn disconnect(&self) {
        self.connected.store(false, Ordering::Release);
        if let Ok(mut pending) = self.pending.lock() {
            if let Some((_, sender)) = pending.take() {
                let _ = sender.send(Err("HiViewer update session disconnected".into()));
            }
        }
    }

    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        if !self.available() {
            return Err("native-update-unavailable".into());
        }
        let id = format!(
            "luxe:update:{}",
            self.sequence.fetch_add(1, Ordering::Relaxed)
        );
        let (sender, receiver) = mpsc::sync_channel(1);
        {
            let mut pending = self.pending.lock().map_err(|_| "host callback poisoned")?;
            if pending.is_some() {
                return Err("HiViewer update callback already pending".into());
            }
            *pending = Some((id.clone(), sender));
        }
        let result = self
            .send(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .and_then(|_| {
                receiver
                    .recv_timeout(Duration::from_secs(60))
                    .map_err(|_| {
                        "HiViewer update response timed out; check plugin status before retrying"
                            .to_owned()
                    })?
            });
        if let Ok(mut pending) = self.pending.lock() {
            if pending
                .as_ref()
                .is_some_and(|(expected, _)| expected == &id)
            {
                pending.take();
            }
        }
        result
    }

    pub fn install(&self, executable: &str, version: &str) -> Result<Value, String> {
        let prepared = self.call(
            "host/plugin.update.prepare",
            json!({"executable":executable,"version":version}),
        )?;
        let params = commit_params(&prepared, version)?;
        let receipt = self.call("host/plugin.update.commit", params)?;
        validate_receipt(&receipt, version)?;
        Ok(receipt)
    }

    /// Call only after consuming the commit receipt and finishing local writes.
    pub fn complete(&self) -> Result<(), String> {
        self.send(&json!({"jsonrpc":"2.0","method":"host/plugin.update.complete","params":{}}))
    }
}

fn callback_result(message: &Value) -> Result<Value, String> {
    if let Some(error) = message.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("HiViewer update callback failed")
            .to_owned());
    }
    message
        .get("result")
        .cloned()
        .ok_or_else(|| "invalid HiViewer update response".into())
}

fn commit_params(prepared: &Value, version: &str) -> Result<Value, String> {
    let executable = prepared["executable"]
        .as_str()
        .ok_or("invalid prepared executable")?;
    let digest = prepared["digest"]
        .as_str()
        .ok_or("invalid prepared digest")?;
    if !crate::protocol::is_absolute_windows_path(executable)
        || prepared["version"] != version
        || digest.len() != 64
        || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("invalid HiViewer prepare receipt".into());
    }
    Ok(json!({"executable":executable,"version":version,"expectedDigest":digest}))
}

fn validate_receipt(receipt: &Value, version: &str) -> Result<(), String> {
    if receipt["pluginId"] != crate::PLUGIN_ID
        || receipt["version"] != version
        || receipt["enabled"] != true
        || receipt["status"] != "installed"
        || receipt["revision"].as_str().is_none_or(str::is_empty)
    {
        return Err("invalid HiViewer commit receipt; inspect installed plugin status".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Frames(mpsc::Sender<Value>);
    impl Write for Frames {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.send(serde_json::from_slice(bytes).unwrap()).unwrap();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn original_session_prepares_commits_consumes_receipt_then_completes() {
        let (tx, rx) = mpsc::channel();
        let session = Arc::new(HostUpdate {
            output: Arc::new(Mutex::new(Box::new(Frames(tx)))),
            ..HostUpdate::default()
        });
        session.initialize(
            &json!({"host":{"capabilities":["plugin.update.v1"]},"permissions":["native.update"]}),
        );
        let worker = session.clone();
        let handle = std::thread::spawn(move || {
            let receipt = worker
                .install("C:/updates/runtime/plugin.exe", "0.1.7")
                .unwrap();
            assert_eq!(receipt["status"], "installed");
            worker.complete().unwrap();
        });
        let prepare = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(prepare["method"], "host/plugin.update.prepare");
        assert!(!session.receive(
            &json!({"id":12,"method":"viewer/update","params":{"viewer":{"sequence":8}}})
        ));
        session.receive(&json!({"id":prepare["id"],"result":{"executable":"C:/canonical/plugin.exe","version":"0.1.7","digest":"a".repeat(64)}}));
        let commit = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(commit["method"], "host/plugin.update.commit");
        assert_ne!(commit["id"], prepare["id"]);
        assert_eq!(commit["params"]["executable"], "C:/canonical/plugin.exe");
        assert_eq!(commit["params"]["expectedDigest"], "a".repeat(64));
        assert!(rx.try_recv().is_err(), "complete must await commit receipt");
        session.receive(&json!({"id":commit["id"],"result":{"pluginId":crate::PLUGIN_ID,"version":"0.1.7","revision":"new","enabled":true,"status":"installed"}}));
        let complete = rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(complete["method"], "host/plugin.update.complete");
        assert!(complete.get("id").is_none());
        handle.join().unwrap();
    }

    #[test]
    fn capability_and_grant_are_both_required() {
        let session = HostUpdate::default();
        for params in [
            json!({}),
            json!({"host":{"capabilities":["plugin.update.v1"]}}),
            json!({"permissions":["native.update"]}),
        ] {
            session.initialize(&params);
            assert!(!session.available());
        }
        session.initialize(
            &json!({"host":{"capabilities":["plugin.update.v1"]},"permissions":["native.update"]}),
        );
        assert!(session.available());
        session.disconnect();
        assert!(!session.available());
    }

    #[test]
    fn replies_do_not_consume_interleaved_viewer_requests_or_unrelated_ids() {
        let session = HostUpdate::default();
        let (tx, rx) = mpsc::sync_channel(1);
        *session.pending.lock().unwrap() = Some(("luxe:update:1".into(), tx));
        assert!(!session.receive(&json!({"id":3,"method":"viewer/update","params":{}})));
        session.receive(&json!({"id":"old","result":{}}));
        assert!(rx.try_recv().is_err());
        session.receive(&json!({"id":"luxe:update:1","result":{"digest":"ok"}}));
        assert_eq!(rx.recv().unwrap().unwrap()["digest"], "ok");
        assert!(session.pending.lock().unwrap().is_none());
    }

    #[test]
    fn callbacks_fail_closed_on_errors_disconnect_and_bad_receipts() {
        assert!(
            callback_result(&json!({"error":{"message":"plugins/package-changed"}}))
                .unwrap_err()
                .contains("package-changed")
        );
        assert!(callback_result(&json!({})).is_err());
        let session = HostUpdate::default();
        let (tx, rx) = mpsc::sync_channel(1);
        *session.pending.lock().unwrap() = Some(("x".into(), tx));
        session.disconnect();
        assert!(rx.recv().unwrap().is_err());
        let prepared =
            json!({"executable":"C:/updates/plugin.exe","version":"0.1.7","digest":"a".repeat(64)});
        let params = commit_params(&prepared, "0.1.7").unwrap();
        assert_eq!(params.as_object().unwrap().len(), 3);
        assert_eq!(params["executable"], prepared["executable"]);
        assert!(commit_params(&prepared, "0.1.8").is_err());
        let receipt = json!({"pluginId":crate::PLUGIN_ID,"version":"0.1.7","enabled":true,"status":"installed","revision":"new"});
        assert!(validate_receipt(&receipt, "0.1.7").is_ok());
        assert!(validate_receipt(&receipt, "0.1.8").is_err());
    }
}
