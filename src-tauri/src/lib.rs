pub mod commands;
pub mod config;
pub mod error;
pub mod events;
pub mod state;
pub mod window_geom;

use std::sync::Arc;

use tauri::{Manager, RunEvent};

use crate::config::StateStore;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,luxe_tauri_lib=debug".into()),
        )
        .with_target(false)
        .init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
                let _ = win.unminimize();
            }
        }))
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let store = StateStore::load(&app.handle())
                .expect("state.toml load failed");
            app.manage(AppState::new(store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::state_cmds::load_state,
            commands::state_cmds::save_state_section,
            commands::state_cmds::flush_state_now,
            commands::window_cmds::compute_adaptive_geometry,
            commands::window_cmds::current_avail_rect,
            commands::window_cmds::apply_window_geometry,
            commands::window_cmds::save_window_geometry,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            // Flush state synchronously before the process exits.
            if let Some(state) = app_handle.try_state::<AppState>() {
                let store: Arc<StateStore> = Arc::clone(&state.state_store);
                let rt = tauri::async_runtime::handle();
                let _ = rt.block_on(async move { store.flush_now().await });
            }
        }
    });
}
