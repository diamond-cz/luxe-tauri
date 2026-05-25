//! Frontend-facing event names. Keep in sync with `src/ipc/client.ts` constants.

pub const POETRY_UPDATED:    &str = "poetry_updated";
pub const TRAY_ACTION:       &str = "tray_action";
pub const SHORTCUT_TRIGGERED:&str = "shortcut_triggered";
pub const LOCALE_CHANGED:    &str = "locale_changed";
pub const THUMBNAIL_READY:   &str = "thumbnail_ready";
