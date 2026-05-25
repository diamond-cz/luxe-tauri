//! System tray. Equivalent of hiz's `_setup_tray` / `_build_tray_menu`.
//!
//! - Single icon, click events emitted as `tray_action { kind: <id> }`
//! - Menu items: show / refresh_poetry / settings / quit
//! - Double-click restores the main window (matches Qt behaviour)

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::AppResult;
use crate::events::TRAY_ACTION;

pub const ID_SHOW:     &str = "show";
pub const ID_POETRY:   &str = "refresh_poetry";
pub const ID_SETTINGS: &str = "settings";
pub const ID_QUIT:     &str = "quit";

pub fn install(app: &AppHandle) -> AppResult<()> {
    let item_show     = MenuItem::with_id(app, ID_SHOW,     "显示主窗口", true, None::<&str>)?;
    let item_poetry   = MenuItem::with_id(app, ID_POETRY,   "刷新诗词",   true, None::<&str>)?;
    let item_settings = MenuItem::with_id(app, ID_SETTINGS, "设置",       true, None::<&str>)?;
    let item_quit     = MenuItem::with_id(app, ID_QUIT,     "退出 LUXE",  true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&item_show, &item_poetry, &item_settings, &item_quit],
    )?;

    let app_handle = app.clone();

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().unwrap_or_else(|| {
            // Fallback if no app icon was set (should never hit in practice).
            tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")).unwrap()
        }))
        .tooltip("LUXE")
        .menu(&menu)
        .menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let id = event.id.as_ref();
            handle_tray_action(app, id);
        })
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                handle_tray_action(&app_handle, ID_SHOW);
            }
        })
        .build(app)?;
    Ok(())
}

fn handle_tray_action(app: &AppHandle, kind: &str) {
    match kind {
        ID_SHOW => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }
        ID_QUIT => {
            // Let frontend run its persist hooks first; if it can't, fall back.
            let _ = app.emit(TRAY_ACTION, serde_json::json!({ "kind": kind }));
            app.exit(0);
            return;
        }
        _ => {}
    }
    let _ = app.emit(TRAY_ACTION, serde_json::json!({ "kind": kind }));
}
