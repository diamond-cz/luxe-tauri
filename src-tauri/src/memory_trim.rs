#[cfg(windows)]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
use std::time::Duration;

use tauri::{State, WebviewWindow};

use crate::state::AppState;

#[cfg(windows)]
static WEBVIEW_PULSE_ACTIVE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub async fn trim_memory(
    window: WebviewWindow,
    state: State<'_, AppState>,
    clear_caches: bool,
) -> Result<(), String> {
    let cpp_parser = state.cpp_parser.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if clear_caches {
            crate::image_scan::clear_memory_caches();
            cpp_parser.clear();
        }
        unsafe { libmimalloc_sys::mi_collect(true) };
    })
    .await
    .map_err(|error| error.to_string())?;

    #[cfg(windows)]
    {
        if WEBVIEW_PULSE_ACTIVE.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        set_webview_memory_target(&window, true);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1500));
            set_webview_memory_target(&window, false);
            WEBVIEW_PULSE_ACTIVE.store(false, Ordering::Release);
        });
    }
    #[cfg(not(windows))]
    let _ = window;
    Ok(())
}

#[cfg(windows)]
fn set_webview_memory_target(window: &WebviewWindow, low: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        ICoreWebView2_19,
    };
    use windows_webview::core::Interface;

    let level = if low {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
    } else {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
    };
    if let Err(error) = window.with_webview(move |platform| unsafe {
        if let Ok(core) = platform.controller().CoreWebView2() {
            if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                let _ = core19.SetMemoryUsageTargetLevel(level);
            }
        }
    }) {
        tracing::debug!(%error, "WebView memory target unavailable");
    }
}
