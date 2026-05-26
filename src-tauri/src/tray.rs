//! System tray. Equivalent of hiz's `_setup_tray` / `_build_tray_menu`.
//!
//! - Single icon (`icons/tray-icon.png`, embedded at compile time so the
//!   binary stays self-contained on production builds).
//! - Menu items: show / refresh_poetry / settings / quit
//! - Double-click restores the main window (matches Qt behaviour)
//! - Every menu action — except quit — first restores the main window so
//!   the user actually sees the effect when LUXE is hidden to tray.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::error::AppResult;
use crate::events::TRAY_ACTION;

pub const ID_SHOW:     &str = "show";
pub const ID_POETRY:   &str = "refresh_poetry";
pub const ID_SETTINGS: &str = "settings";
pub const ID_QUIT:     &str = "quit";

/// Embed the tray icon at compile time — same image used in every locale,
/// only one icon file ever shipped (`icons/tray-icon.png`).
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-icon.png");

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
    let tray_icon = tauri::image::Image::from_bytes(TRAY_ICON_BYTES)?;

    TrayIconBuilder::with_id("main")
        .icon(tray_icon)
        .tooltip("LUXE")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            handle_tray_action(app, event.id.as_ref());
        })
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                handle_tray_action(&app_handle, ID_SHOW);
            }
        })
        .build(app)?;
    Ok(())
}

fn restore_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn handle_tray_action(app: &AppHandle, kind: &str) {
    if kind == ID_QUIT {
        // Tell the frontend (best-effort, may not arrive before exit) and quit.
        let _ = app.emit(TRAY_ACTION, serde_json::json!({ "kind": kind }));
        app.exit(0);
        return;
    }
    // For show / settings / refresh_poetry — pop the window first so the
    // user sees what happens. Frontend then handles the routing / refresh.
    restore_main_window(app);
    let _ = app.emit(TRAY_ACTION, serde_json::json!({ "kind": kind }));
}
