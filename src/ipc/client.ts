import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";

/**
 * Thin wrapper over Tauri `invoke` so call sites stay typed and errors are
 * normalised. Errors thrown from Rust are already string-serialised via
 * `AppError`'s `Serialize` impl.
 */
export async function call<T>(cmd: string, args?: InvokeArgs): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    // Tauri rejects with the serialised AppError string.
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/* ---- Event channel names (must match `src-tauri/src/events.rs`) ---- */
export const EVT_POETRY_UPDATED:     "poetry_updated"     = "poetry_updated";
export const EVT_TRAY_ACTION:        "tray_action"        = "tray_action";
export const EVT_SHORTCUT_TRIGGERED: "shortcut_triggered" = "shortcut_triggered";
export const EVT_LOCALE_CHANGED:     "locale_changed"     = "locale_changed";
export const EVT_THUMBNAIL_READY:    "thumbnail_ready"    = "thumbnail_ready";
