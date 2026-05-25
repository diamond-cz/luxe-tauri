//! Global shortcut registration. Mirrors the Python `_register_shortcut` /
//! `_on_shortcut_updated` flow: action_id ∈ {home, settings, exit, poetry}.
//!
//! On trigger, we emit `shortcut_triggered { action: <id> }` and let the
//! front-end handle navigation / poetry refresh / app quit.

use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::error::{AppError, AppResult};
use crate::events::SHORTCUT_TRIGGERED;

pub const ACTION_IDS: &[&str] = &["home", "settings", "exit", "poetry"];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ShortcutMap {
    #[serde(default)] pub home:     String,
    #[serde(default)] pub settings: String,
    #[serde(default)] pub exit:     String,
    #[serde(default)] pub poetry:   String,
}

impl ShortcutMap {
    pub fn iter(&self) -> impl Iterator<Item = (&'static str, &str)> {
        [
            ("home",     self.home.as_str()),
            ("settings", self.settings.as_str()),
            ("exit",     self.exit.as_str()),
            ("poetry",   self.poetry.as_str()),
        ]
        .into_iter()
    }
}

/// Per-action registry mapping action_id → parsed `Shortcut`.
pub type Registry = Arc<RwLock<HashMap<&'static str, Shortcut>>>;

pub fn make_registry() -> Registry {
    Arc::new(RwLock::new(HashMap::new()))
}

pub fn install_handler(app: &AppHandle, registry: Registry) -> AppResult<()> {
    let app_handle = app.clone();
    let reg = Arc::clone(&registry);

    app.global_shortcut().on_shortcut(
        |_app, shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            // Match against our registry to find which action_id fired.
            let reg = reg.read();
            let hit = reg
                .iter()
                .find(|(_, sc)| **sc == *shortcut)
                .map(|(id, _)| *id);
            if let Some(action) = hit {
                let _ = app_handle.emit(
                    SHORTCUT_TRIGGERED,
                    serde_json::json!({ "action": action }),
                );
            }
        },
    )?;
    Ok(())
}

/// Re-register every action in `map`. Unregister anything that was previously
/// registered but is now empty / changed.
pub fn apply_map(app: &AppHandle, registry: &Registry, map: &ShortcutMap) -> AppResult<()> {
    let gs = app.global_shortcut();

    // First, unregister everything we currently have on file. This avoids
    // dangling registrations for action_ids whose binding was cleared.
    {
        let prev = registry.read().clone();
        for (_id, sc) in prev.iter() {
            let _ = gs.unregister(sc.clone());
        }
        registry.write().clear();
    }

    // Then register the new bindings.
    for (id, accel) in map.iter() {
        if accel.is_empty() {
            continue;
        }
        let sc = match Shortcut::from_str(accel) {
            Ok(sc) => sc,
            Err(err) => {
                tracing::warn!(action = id, accel, %err, "ignoring invalid shortcut");
                continue;
            }
        };
        if let Err(err) = gs.register(sc.clone()) {
            tracing::warn!(action = id, accel, %err, "shortcut register failed");
            continue;
        }
        registry.write().insert(id, sc);
    }
    Ok(())
}

pub fn get_registry(app: &AppHandle) -> AppResult<Registry> {
    app.try_state::<Registry>()
        .map(|s| Arc::clone(&*s))
        .ok_or_else(|| AppError::Other("shortcut registry not initialised".into()))
}
