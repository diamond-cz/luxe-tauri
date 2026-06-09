import { call } from "./client";

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

export const loadImageThumbnailBatch = (paths: string[], size: number, embeddedOnly = false) =>
  call<Record<string, string>>("load_image_thumbnail_batch", { paths, size, embeddedOnly });
