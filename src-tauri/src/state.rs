//! Global app state injected via `tauri::State<AppState>`.

use std::sync::Arc;

use crate::config::StateStore;
use crate::cpp_parser::CppParserCache;

pub struct AppState {
    pub state_store:  Arc<StateStore>,
    pub cpp_parser:   Arc<CppParserCache>,
}

impl AppState {
    pub fn new(state_store: StateStore) -> Self {
        Self {
            state_store: Arc::new(state_store),
            cpp_parser:  Arc::new(CppParserCache::new()),
        }
    }
}
