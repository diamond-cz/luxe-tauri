//! Persistent state in the application's resources/state.toml.
//! Read-only installations fall back to the user configuration directory.
//!
//! Strategy:
//! - Boot: read the preferred file or migrate an existing state on first use.
//! - Update: in-memory write under RwLock, debounced 200ms before flushing.
//! - Exit:  flush_now() called from `RunEvent::ExitRequested`.

use std::path::{Path, PathBuf};
use std::io::Write;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::{Mutex as SyncMutex, RwLock};
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
    writer: SyncMutex<()>,
}

impl StateStore {
    pub fn load(app: &AppHandle) -> AppResult<Self> {
        let fallback = app.path().app_config_dir()
            .map_err(|err| AppError::Path(err.to_string()))?.join(STATE_FILE_NAME);
        if cfg!(debug_assertions) {
            return Self::load_development(Path::new(env!("CARGO_MANIFEST_DIR")), fallback);
        }
        let preferred = std::env::current_exe().ok()
            .and_then(|path| path.parent().map(|dir| dir.join("resources").join(STATE_FILE_NAME)))
            .unwrap_or_else(|| fallback.clone());
        Self::load_paths(preferred, fallback)
    }

    /// Shared by development startup and integration checks, independent of cwd.
    pub fn load_development(manifest_dir: &Path, fallback: PathBuf) -> AppResult<Self> {
        let preferred = manifest_dir.join("resources").join(STATE_FILE_NAME);
        let legacy = manifest_dir.parent()
            .map(|root| root.join("resources").join(STATE_FILE_NAME));
        Self::load_candidates(preferred, legacy.into_iter().chain(std::iter::once(fallback)).collect())
    }

    /// Prefer the portable file, migrating the legacy state only on first use.
    pub fn load_paths(preferred: PathBuf, fallback: PathBuf) -> AppResult<Self> {
        Self::load_candidates(preferred, vec![fallback])
    }

    fn load_candidates(preferred: PathBuf, sources: Vec<PathBuf>) -> AppResult<Self> {
        let migration = sources.iter().find(|path| path.is_file()).map(PathBuf::clone);
        match Self::load_at(preferred.clone(), migration.as_deref()) {
            Ok(store) => Ok(store),
            Err(error) => {
                tracing::warn!(?preferred, %error, "portable state unavailable; using fallback state location");
                // Legacy files are migration sources, never active write locations.
                if let Some(fallback) = sources.last().filter(|path| **path != preferred) {
                    let source = if preferred.is_file() { Some(preferred.as_path()) } else { migration.as_deref() };
                    return Self::load_at(fallback.clone(), source);
                }
                Err(error)
            }
        }
    }

    fn load_at(path: PathBuf, migrate_from: Option<&Path>) -> AppResult<Self> {
        let source = if path.exists() { path.as_path() } else {
            migrate_from.filter(|source| source.is_file()).unwrap_or(&path)
        };
        let root = if source.exists() {
            let text = std::fs::read_to_string(source)?;
            // Preserve malformed files so a failed load cannot erase user state.
            toml::from_str::<StateRoot>(&text)?
        } else {
            tracing::info!(?path, "state.toml missing; bootstrapping defaults");
            StateRoot::default()
        };

        let store = Self {
            root:      Arc::new(RwLock::new(root)),
            path,
            debouncer: Arc::new(Mutex::new(None)),
            writer: SyncMutex::new(()),
        };

        // Verify writes now so protected installation directories can fall back.
        store.write_now()?;

        Ok(store)
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
        {
            let mut current = self.root.write();
            let mut json = serde_json::to_value(&*current)?;
            let obj = json.as_object_mut().ok_or_else(|| {
                AppError::Other("StateRoot must serialise as JSON object".into())
            })?;
            obj.insert(section.to_string(), value);
            let next: StateRoot = serde_json::from_value(json)?;
            *current = next;
        }

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
        let _writer = self.writer.lock();
        let snapshot = self.root.read().clone();
        let text = toml::to_string_pretty(&snapshot)?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = self.path.with_extension("toml.tmp");
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        drop(file);
        // rename replaces the destination on Windows too; keep the old file
        // intact until replacement succeeds. The writer lock serializes writes.
        std::fs::rename(&temporary, &self.path)?;
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
