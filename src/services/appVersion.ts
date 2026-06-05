import tauriConfig from "../../src-tauri/tauri.conf.json";

export const APP_VERSION = tauriConfig.version;
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
export const APP_VERSION_SOURCE = "src-tauri/tauri.conf.json";
