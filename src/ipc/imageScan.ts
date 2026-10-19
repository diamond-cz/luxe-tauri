import { call } from "./client";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";

export interface ImageEntry {
  name:      string;
  jpg_path:  string;
  toml_path: string;
}

export const scanImageDir = (dir: string) =>
  call<ImageEntry[]>("scan_image_dir", { dir });

export interface ExifParseProgress {
  stage: "EXIF" | "TOML";
  completed: number;
  total: number;
}

export interface ExifParseSummary {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
}

export const parseImageExif = (
  parserPath: string,
  imageDir: string,
  onProgress: (progress: ExifParseProgress) => void,
) => {
  const channel = new Channel<ExifParseProgress>();
  channel.onmessage = onProgress;
  return call<ExifParseSummary>("parse_image_exif", { parserPath, imageDir, onProgress: channel });
};

/** Flat key → string value map. Same key resolves the leaf regardless of TOML nesting. */
export const loadImageToml = (path: string) =>
  call<Record<string, string>>("load_image_toml", { path });

export const loadImageTomlBatch = (paths: string[]) =>
  call<Record<string, Record<string, string>>>("load_image_toml_batch", { paths });

export const loadImageTomlFieldsBatch = (paths: string[], keys: string[]) =>
  call<Record<string, Record<string, string>>>("load_image_toml_fields_batch", { paths, keys });

// Several table effects can request the same window while a folder is settling.
// Share the in-flight IPC promise so one path/key set is parsed only once.
const tomlFieldInflight = new Map<string, Promise<Record<string, Record<string, string>>>>();
export const loadImageTomlFieldsBatchShared = (paths: string[], keys: string[]) => {
  const uniquePaths = [...new Set(paths)];
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const key = `${uniqueKeys.join("\u001f")}\u001e${uniquePaths.join("\u001f")}`;
  const existing = tomlFieldInflight.get(key);
  if (existing) return existing;
  const pending = loadImageTomlFieldsBatch(uniquePaths, uniqueKeys);
  tomlFieldInflight.set(key, pending);
  pending.then(() => {
    if (tomlFieldInflight.get(key) === pending) tomlFieldInflight.delete(key);
  }, () => {
    if (tomlFieldInflight.get(key) === pending) tomlFieldInflight.delete(key);
  });
  return pending;
};

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

export const loadImagePreview = async (path: string): Promise<string> =>
  convertFileSrc(await call<string>("load_image_preview", { path }));

/** High resolution preview for the image table hover card. */
export const loadImageHoverPreview = async (path: string): Promise<string> =>
  convertFileSrc(await call<string>("load_image_hover_preview", { path }));
