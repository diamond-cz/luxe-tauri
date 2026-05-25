//! Global app state injected via `tauri::State<AppState>`.

use std::sync::Arc;

use crate::config::StateStore;

pub struct AppState {
    pub state_store: Arc<StateStore>,
}

impl AppState {
    pub fn new(state_store: StateStore) -> Self {
        Self { state_store: Arc::new(state_store) }
    }
}
