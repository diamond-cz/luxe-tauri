import { call } from "./client";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Channel } from "@tauri-apps/api/core";
import type { ImageExifDocument, ImageMetadataPreparationSummary, ImageSidecarCleanupSummary, ImageTomlSection } from "@/types/ipc";
export type { ImageExifDocument, ImageExifModule, ImageExifTable, ImageTomlSection } from "@/types/ipc";

export interface ImageEntry {
  name:      string;
  jpg_path:  string;
  toml_path: string;
}

export const scanImageDir = (dir: string) =>
  call<ImageEntry[]>("scan_image_dir", { dir });

export interface ExifParseProgress {
  stage: "EXIF" | "DP" | "TOML" | "JPEG";
  completed: number;
  total: number;
}

export interface ImageMetadataPreparationResult {
  entries: ImageEntry[];
  summary: ImageMetadataPreparationSummary;
}

/** Import-time reconciliation only. Normal image clicks read the prepared TOML. */
export const prepareImageMetadata = (imageDir: string, onProgress: (progress: ExifParseProgress) => void) =>
  call<ImageMetadataPreparationResult>("prepare_image_metadata", { imageDir, onProgress: metadataProgressChannel(onProgress) });

export interface ExifParseSummary {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
  direct: number;
  fallback: number;
  partial: number;
}

export const parseImageExif = (
  parserPath: string | null,
  imageDir: string,
  onProgress: (progress: ExifParseProgress) => void,
) => {
  const channel = new Channel<ExifParseProgress>();
  channel.onmessage = onProgress;
  return call<ExifParseSummary>("parse_image_exif", { parserPath, imageDir, onProgress: channel });
};

function metadataProgressChannel(onProgress?: (progress: ExifParseProgress) => void) {
  const channel = new Channel<ExifParseProgress>();
  channel.onmessage = onProgress ?? (() => {});
  return channel;
}

/** Flat key → string value map. Same key resolves the leaf regardless of TOML nesting. */
export const loadImageToml = (path: string) =>
  call<Record<string, string>>("load_image_toml", { path });

/** Includes statistics and provenance without changing the legacy flat/section APIs. */
export const loadImageExif = (path: string) =>
  call<ImageExifDocument>("load_image_exif", { path });

export const listImageSidecars = (imageDir: string, imagePaths: string[]) =>
  call<string[]>("list_image_sidecars", { imageDir, imagePaths });

export const clearImageSidecars = (imageDir: string, imagePaths: string[], confirmedFiles: string[]) =>
  call<ImageSidecarCleanupSummary>("clear_image_sidecars", { imageDir, imagePaths, confirmedFiles });

export const loadImageTomlSections = (path: string) =>
  call<ImageTomlSection[]>("load_image_toml_sections", { path });

export const loadImageTomlBatch = (paths: string[]) =>
  call<Record<string, Record<string, string>>>("load_image_toml_batch", { paths });

export const loadImageTomlFieldsBatch = (paths: string[], keys: string[]) =>
  call<Record<string, Record<string, string>>>("load_image_toml_fields_batch", { paths, keys });

export interface ImageMetadataContext {
  entries: readonly ImageEntry[];
  revision: number;
}

// Share only live requests for the same dataset and content revision. A new
// TOML sidecar must not reuse an in-flight read of the previous JPEG source.
// Weak dataset keys and settlement cleanup retain no completed results.
type TomlFieldRequests = Map<string, Promise<Record<string, Record<string, string>>>>;
const tomlFieldInflight = new WeakMap<ImageMetadataContext["entries"], TomlFieldRequests>();
export const loadImageTomlFieldsBatchShared = (
  paths: string[],
  keys: string[],
  context: ImageMetadataContext,
) => {
  const uniquePaths = [...new Set(paths)];
  const uniqueKeys = [...new Set(keys.filter(Boolean))];
  const requests = tomlFieldInflight.get(context.entries) ?? new Map<string, Promise<Record<string, Record<string, string>>>>();
  tomlFieldInflight.set(context.entries, requests);
  const key = JSON.stringify([context.revision, uniqueKeys, uniquePaths]);
  const existing = requests.get(key);
  if (existing) return existing;
  const pending = loadImageTomlFieldsBatch(uniquePaths, uniqueKeys);
  requests.set(key, pending);
  const release = () => {
    if (requests.get(key) === pending) requests.delete(key);
    if (requests.size === 0 && tomlFieldInflight.get(context.entries) === requests) {
      tomlFieldInflight.delete(context.entries);
    }
  };
  pending.then(release, release);
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
