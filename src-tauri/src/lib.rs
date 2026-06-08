pub mod commands;
pub mod config;
pub mod cpp_parser;
pub mod error;
pub mod events;
pub mod image_scan;
pub mod poetry;
pub mod shortcuts;
pub mod state;
pub mod tray;
pub mod window_geom;

use std::sync::Arc;

use tauri::{Manager, RunEvent};

use crate::config::{LocaleCatalog, StateStore};
use crate::shortcuts::{make_registry, Registry};
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
            let handle = app.handle();

            // Force window icon at runtime so dev builds reliably show the
            // updated logo in the Windows class icon (taskbar / Alt+Tab) —
            // `cargo run --no-default-features` skips the bundle/winres step
            // that normally embeds the Win32 resource icon for release builds.
            if let Some(win) = handle.get_webview_window("main") {
                if let Ok(img) = tauri::image::Image::from_bytes(
                    include_bytes!("../icons/icon.png"),
                ) {
                    let _ = win.set_icon(img);
                }
            }

            // Persistent state.
            let store = StateStore::load(handle).expect("state.toml load failed");
            let initial_shortcuts = store.snapshot().shortcuts.clone();
            app.manage(AppState::new(store));

            // i18n catalog (all 16 locales loaded eagerly — total <200 KB).
            let catalog = LocaleCatalog::load(handle).unwrap_or_default();
            app.manage(catalog);

            // Global shortcut registry. Per-shortcut handlers are attached at
            // registration time (no separate central dispatcher needed).
            let registry: Registry = make_registry();
            app.manage(Arc::clone(&registry));
            let map = crate::shortcuts::ShortcutMap {
                home:     initial_shortcuts.home,
                settings: initial_shortcuts.settings,
                exit:     initial_shortcuts.exit,
                poetry:   initial_shortcuts.poetry,
            };
            if let Err(err) = shortcuts::apply_map(handle, &registry, &map) {
                tracing::warn!(%err, "initial shortcut registration failed");
            }

            // System tray.
            if let Err(err) = tray::install(handle) {
                tracing::warn!(%err, "tray install failed");
            }

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
            commands::i18n_cmds::list_locales,
            commands::i18n_cmds::get_locale_bundle,
            commands::i18n_cmds::get_all_locale_bundles,
            commands::i18n_cmds::announce_locale_changed,
            commands::poetry_cmds::fetch_poetry,
            commands::shortcut_cmds::update_shortcuts,
            commands::shortcut_cmds::pause_shortcuts,
            commands::shortcut_cmds::resume_shortcuts,
            commands::close_cmds::resolve_close_decision,
            commands::close_cmds::hide_main_window,
            commands::close_cmds::show_main_window,
            commands::close_cmds::quit_app,
            commands::fs_cmds::get_config_dir,
            commands::fs_cmds::open_path,
            commands::fs_cmds::open_url,
            commands::fs_cmds::is_dir,
            commands::fs_cmds::ensure_directory,
            commands::cpp_cmds::parse_cpp_file,
            commands::cpp_cmds::cpp_get_fields_at_path,
            commands::cpp_cmds::cpp_get_values_at_path,
            commands::cpp_cmds::cpp_get_node_at_path,
            commands::cpp_cmds::cpp_search_by_comment,
            commands::cpp_cmds::cpp_search_by_value,
            commands::cpp_cmds::cpp_get_fields_by_line,
            commands::cpp_cmds::cpp_get_fields_in_range,
            commands::cpp_cmds::cpp_get_section_names,
            commands::cpp_cmds::cpp_clear_cache,
            commands::cpp_cmds::cpp_resolve_card_source,
            commands::cpp_cmds::get_isp6s_schema,
            commands::cpp_cmds::get_normal_table_schema,
            commands::image_cmds::scan_image_dir,
            commands::image_cmds::load_image_toml,
            commands::text_cmds::read_text_file,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            if let Some(state) = app_handle.try_state::<AppState>() {
                let store: Arc<StateStore> = Arc::clone(&state.state_store);
                let rt = tauri::async_runtime::handle();
                let _ = rt.block_on(async move { store.flush_now().await });
            }
        }
    });
}
