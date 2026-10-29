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
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use parking_lot::{Mutex as SyncMutex, RwLock};
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;
use tokio::time::sleep;

use super::state_schema::{ImageTableColumns, ImageTableModeColumns, StateRoot};
use crate::error::{AppError, AppResult};

const STATE_FILE_NAME: &str = "state.toml";
const DEBOUNCE_MS:     u64  = 200;
static NEXT_WRITE_ID: AtomicU64 = AtomicU64::new(0);

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

    pub async fn save_image_table_mode(
        self: &Arc<Self>,
        mode: &str,
        value: ImageTableModeColumns,
        legacy_other: ImageTableModeColumns,
    ) -> AppResult<()> {
        if mode != "isp6s" && mode != "tone" {
            return Err(AppError::Other(format!("invalid image table mode: {mode}")));
        }
        {
            let mut root = self.root.write();
            let columns = root.image_table_columns.get_or_insert_with(|| {
                let mut columns = ImageTableColumns::default();
                if mode == "isp6s" { columns.tone = legacy_other; }
                else { columns.isp6s = legacy_other; }
                columns
            });
            match mode {
                "isp6s" => columns.isp6s = value,
                "tone" => columns.tone = value,
                _ => unreachable!(),
            }
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
        // Independent processes (and stores) must never truncate each other's
        // pending writes. create_new also handles stale files after PID reuse.
        let (temporary, mut file) = loop {
            let id = NEXT_WRITE_ID.fetch_add(1, Ordering::Relaxed);
            let path = self.path.with_extension(format!("toml.{}.{id}.tmp", std::process::id()));
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => break (path, file),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.into()),
            }
        };
        let result = (|| -> std::io::Result<()> {
            file.write_all(text.as_bytes())?;
            file.sync_all()?;
            drop(file);
            std::fs::rename(&temporary, &self.path)
        })();
        // rename replaces the destination on Windows too; keep the old file
        // intact until replacement succeeds. The last complete snapshot wins.
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result?;
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

#[cfg(test)]
mod image_table_mode_tests {
    use super::{ImageTableModeColumns, StateStore};
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[tokio::test]
    async fn simultaneous_modes_keep_their_own_settings_after_reload() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("luxe-columns-{}-{nonce}", std::process::id()));
        let preferred = dir.join("resources/state.toml");
        let fallback = dir.join("user/state.toml");
        let store = Arc::new(StateStore::load_paths(preferred.clone(), fallback.clone()).unwrap());
        let mut isp6s = ImageTableModeColumns::default();
        isp6s.face.hidden.push("ev".into());
        isp6s.face.widths.insert("cwr".into(), 184.0);
        let mut tone = ImageTableModeColumns::default();
        tone.all.order.push("extra:SW_LCE_LV".into());
        tone.all.widths.insert("name".into(), 360.0);

        let (first, second) = tokio::join!(
            store.save_image_table_mode("isp6s", isp6s, ImageTableModeColumns::default()),
            store.save_image_table_mode("tone", tone, ImageTableModeColumns::default()),
        );
        first.unwrap();
        second.unwrap();
        store.flush_now().await.unwrap();

        let restored = StateStore::load_paths(preferred, fallback).unwrap().snapshot();
        let columns = restored.image_table_columns.unwrap();
        assert_eq!(columns.isp6s.face.hidden, vec!["ev"]);
        assert_eq!(columns.isp6s.face.widths.get("cwr"), Some(&184.0));
        assert_eq!(columns.tone.all.order, vec!["extra:SW_LCE_LV"]);
        assert_eq!(columns.tone.all.widths.get("name"), Some(&360.0));
        assert!(columns.isp6s.normal.hidden.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn fractional_splitter_does_not_block_dp_path_persistence() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("luxe-dp-path-{}-{nonce}", std::process::id()));
        let preferred = dir.join("resources/state.toml");
        let fallback = dir.join("user/state.toml");
        let store = Arc::new(StateStore::load_paths(preferred.clone(), fallback.clone()).unwrap());
        let mut mtk = serde_json::to_value(store.snapshot().mtk).unwrap();
        mtk["outer_splitter"] = serde_json::json!([40.25, 59.75]);
        mtk["inner_splitter"] = serde_json::json!([32.2005007422, 67.7994992578]);
        mtk["debug_parser_path"] = serde_json::json!(r"D:\tools\DPParser.exe");

        store.patch_section("mtk", mtk).await.unwrap();
        store.flush_now().await.unwrap();
        let restored = StateStore::load_paths(preferred, fallback).unwrap().snapshot();
        assert_eq!(restored.mtk.outer_splitter, vec![40.25, 59.75]);
        assert_eq!(restored.mtk.inner_splitter, vec![32.2005007422, 67.7994992578]);
        assert_eq!(restored.mtk.debug_parser_path.as_deref(), Some(r"D:\tools\DPParser.exe"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
