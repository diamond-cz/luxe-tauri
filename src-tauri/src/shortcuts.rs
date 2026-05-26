//! Global shortcut registration. Mirrors the Python `_register_shortcut` /
//! `_on_shortcut_updated` flow: action_id ∈ {home, settings, exit, poetry}.
//!
//! Each registered accelerator carries a handler closure that emits
//! `shortcut_triggered { action: <id> }`. The front-end handles navigation /
//! poetry refresh / app quit.

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

/// Re-register every action in `map`. Unregister anything that was previously
/// registered but is now empty / changed. Each registration attaches a handler
/// that emits `shortcut_triggered { action }`.
pub fn apply_map(app: &AppHandle, registry: &Registry, map: &ShortcutMap) -> AppResult<()> {
    let gs = app.global_shortcut();

    // First, unregister everything we currently have on file.
    {
        let prev = registry.read().clone();
        for (_id, sc) in prev.iter() {
            let _ = gs.unregister(sc.clone());
        }
        registry.write().clear();
    }

    // Then register the new bindings, one handler per accelerator.
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

        let action_id = id;
        let handler_app = app.clone();
        if let Err(err) = gs.on_shortcut(sc.clone(), move |_app, _sc, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let _ = handler_app.emit(
                SHORTCUT_TRIGGERED,
                serde_json::json!({ "action": action_id }),
            );
        }) {
            tracing::warn!(action = id, accel, %err, "shortcut on_shortcut failed");
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
