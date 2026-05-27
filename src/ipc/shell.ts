import { call } from "@/ipc/client";
import type { Shortcuts, Settings } from "@/types/ipc";

/* ---- locales ---- */
export const getAllLocaleBundles = () =>
  call<Record<string, Record<string, string>>>("get_all_locale_bundles");

export const getLocaleBundle = (locale: string) =>
  call<Record<string, string>>("get_locale_bundle", { locale });

/* ---- poetry ---- */
export const fetchPoetry = () =>
  call<string>("fetch_poetry");

/* ---- shortcuts ---- */
export const updateShortcuts = (map: Shortcuts) =>
  call<void>("update_shortcuts", { map });

export const pauseShortcuts = () =>
  call<void>("pause_shortcuts");

export const resumeShortcuts = () =>
  call<void>("resume_shortcuts");

/* ---- close behaviour ---- */
export type CloseDecision = "ask" | "tray" | "quit";

export const resolveCloseDecision = () =>
  call<CloseDecision>("resolve_close_decision");

export const hideMainWindow = () =>
  call<void>("hide_main_window");

export const showMainWindow = () =>
  call<void>("show_main_window");

export const quitApp = () =>
  call<void>("quit_app");

/* ---- settings convenience ---- */
export const saveSettings = (next: Settings) =>
  call<void>("save_state_section", { section: "settings", value: next });

/* ---- fs helpers ---- */
export const getConfigDir = () =>
  call<string>("get_config_dir");

export const openPath = (path: string) =>
  call<void>("open_path", { path });

export const isDir = (path: string) =>
  call<boolean>("is_dir", { path });

export const ensureDirectory = (path: string) =>
  call<string>("ensure_directory", { path });
