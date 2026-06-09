import { call } from "./client";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface ImageEntry {
  name:      string;
  jpg_path:  string;
  toml_path: string;
}

export const scanImageDir = (dir: string) =>
  call<ImageEntry[]>("scan_image_dir", { dir });

/** Flat key → string value map. Same key resolves the leaf regardless of TOML nesting. */
export const loadImageToml = (path: string) =>
  call<Record<string, string>>("load_image_toml", { path });

export const loadImageTomlBatch = (paths: string[]) =>
  call<Record<string, Record<string, string>>>("load_image_toml_batch", { paths });

export const loadImageTomlFieldsBatch = (paths: string[], keys: string[]) =>
  call<Record<string, Record<string, string>>>("load_image_toml_fields_batch", { paths, keys });

export const loadImageThumbnailBatch = async (paths: string[], size: number, embeddedOnly = false) => {
  const batch = await call<Record<string, string>>("load_image_thumbnail_batch", { paths, size, embeddedOnly });
  const out: Record<string, string> = {};
  for (const [path, thumbPath] of Object.entries(batch)) {
    if (!thumbPath) {
      out[path] = "";
    } else if (thumbPath.startsWith("data:")) {
      out[path] = thumbPath;
    } else {
      out[path] = convertFileSrc(thumbPath);
    }
  }
  return out;
};
