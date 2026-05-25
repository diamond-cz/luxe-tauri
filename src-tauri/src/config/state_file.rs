//! Persistent state stored at `%APPDATA%/luxe-tauri/state.toml`.
//!
//! Strategy:
//! - Boot: load_or_default() reads file, falls back to defaults on missing/parse-error.
//! - Update: in-memory write under RwLock, debounced 200ms before flushing.
//! - Exit:  flush_now() called from `RunEvent::ExitRequested`.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::RwLock;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tokio::time::sleep;

use super::state_schema::StateRoot;
use crate::error::{AppError, AppResult};

const STATE_FILE_NAME: &str = "state.toml";
const DEBOUNCE_MS:     u64  = 200;

pub struct StateStore {
    pub root:      Arc<RwLock<StateRoot>>,
    pub path:      PathBuf,
    debouncer:     Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl StateStore {
    pub fn load(app: &AppHandle) -> AppResult<Self> {
        let path = Self::resolve_path(app)?;
        let root = if path.exists() {
            let text = std::fs::read_to_string(&path)?;
            toml::from_str::<StateRoot>(&text).unwrap_or_else(|err| {
                tracing::warn!(?path, %err, "state.toml malformed; falling back to defaults");
                StateRoot::default()
            })
        } else {
            tracing::info!(?path, "state.toml missing; bootstrapping defaults");
            StateRoot::default()
        };

        let store = Self {
            root:      Arc::new(RwLock::new(root)),
            path,
            debouncer: Arc::new(Mutex::new(None)),
        };

        if !store.path.exists() {
            // Make sure the file exists right away so users can inspect it.
            store.write_now()?;
        }

        Ok(store)
    }

    fn resolve_path(app: &AppHandle) -> AppResult<PathBuf> {
        let dir = app
            .path()
            .app_config_dir()
            .map_err(|err| AppError::Path(err.to_string()))?;
        std::fs::create_dir_all(&dir)?;
        Ok(dir.join(STATE_FILE_NAME))
    }

    pub fn snapshot(&self) -> StateRoot {
        self.root.read().clone()
    }

    /// Apply a JSON patch onto a section, then schedule a debounced write.
    pub async fn patch_section(
        self: &Arc<Self>,
        section: &str,
        value: serde_json::Value,
    ) -> AppResult<()> {
        // Round-trip via JSON for an easy "section-as-value" update.
        let current = self.root.read().clone();
        let mut json = serde_json::to_value(&current)?;
        let obj = json.as_object_mut().ok_or_else(|| {
            AppError::Other("StateRoot must serialise as JSON object".into())
        })?;
        obj.insert(section.to_string(), value);
        let next: StateRoot = serde_json::from_value(json)?;
        *self.root.write() = next;

        self.schedule_flush().await;
        Ok(())
    }

    pub async fn schedule_flush(self: &Arc<Self>) {
        let mut guard = self.debouncer.lock().await;
        if let Some(prev) = guard.take() {
            prev.abort();
        }
        let me = Arc::clone(self);
        let task = tauri::async_runtime::spawn(async move {
            sleep(Duration::from_millis(DEBOUNCE_MS)).await;
            if let Err(err) = me.write_now() {
                tracing::error!(%err, "state.toml flush failed");
            }
        });
        *guard = Some(task);
    }

    pub fn write_now(&self) -> AppResult<()> {
        let snapshot = self.root.read().clone();
        let text = toml::to_string_pretty(&snapshot)?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.path, text)?;
        Ok(())
    }

    pub async fn flush_now(self: &Arc<Self>) -> AppResult<()> {
        // Cancel any pending debounce, then write synchronously.
        let mut guard = self.debouncer.lock().await;
        if let Some(prev) = guard.take() {
            prev.abort();
        }
        self.write_now()
    }
}
