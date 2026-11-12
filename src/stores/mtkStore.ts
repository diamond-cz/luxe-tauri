import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Mtk } from "@/types/ipc";
import type { ParseResult } from "@/types/cpp_parser";
import type { IspId } from "@/views/mtk/ispTabs";
import type { ExifParseProgress, ImageEntry } from "@/ipc/imageScan";
import type { ImageMetadataPreparationSummary } from "@/types/ipc";

type ImportState = {
  filePath: string | null;
  parsed:   ParseResult | null;
  revision: number;
  status:   "idle" | "parsing" | "done" | "error";
  message:  string | null;
};

type ImageDirState = {
  dir:       string | null;
  entries:   ImageEntry[];
  /** Index into `entries` of the currently-selected image. */
  current:   number;
  /** Flat map from the TOML selected by import-time JPEG reconciliation. */
  tomlData:  Record<string, string>;
  /** Dataset content revision; shared by AE/Tone and never persisted. */
  metadataRevision: number;
  /** Import preparation belongs to the shared dataset, not a mounted page. */
  metadataPreparing: boolean;
  preparationProgress: ExifParseProgress | null;
  preparationSummary: ImageMetadataPreparationSummary | null;
  /** Real directory/current-image load generation, not paired selection intent. */
  loadRevision: number;
  status:    "idle" | "scanning" | "loading" | "done" | "error";
  message:   string | null;
};

const DEFAULT_IMPORT: ImportState = {
  filePath: null, parsed: null, revision: 0, status: "idle", message: null,
};
const DEFAULT_IMAGE_DIR: ImageDirState = {
  dir: null, entries: [], current: 0, tomlData: {}, metadataRevision: 0, loadRevision: 0, status: "idle", message: null,
  metadataPreparing: false, preparationProgress: null, preparationSummary: null,
};

interface MtkState {
  mtk: Mtk;
  debugParserPath: string | null;
  /** Per-(ISP × tab) import state, keyed by `"${IspId}|${tabIdx}"`. */
  imports:  Record<string, ImportState>;
  imageDir: Record<string, ImageDirState>;
  /** Per-workspace image selection. AE Basic and ToneMap can opt out of syncing. */
  imageSelection: Record<string, string | null>;
  /** Ephemeral generation; invalidates async TOML results including A -> B -> A. */
  imageRevisions: Record<string, number>;

  hydrate: (value: Mtk) => void;
  setCurrentIsp:  (idx: number) => void;
  setCurrentTab:  (idx: number) => void;
  setOuterSplit:  (sizes: number[]) => void;
  setInnerSplit:  (sizes: number[]) => void;
  setDebugParserPath: (path: string | null) => void;
  setCppPath: (path: string | null, isp: IspId, tabIdx: number | "CA-LTM") => void;

  setImport:   (isp: IspId, tabIdx: number | "CA-LTM", state: Partial<ImportState>) => void;
  setImageDir: (isp: IspId, tabIdx: number, state: Partial<ImageDirState>) => void;
  setImageSelection: (workspaceKey: string, path: string | null) => void;
  setExternalImageSelection: (imageDirKey: string, workspaceKey: string, index: number, path: string) => void;
}

export const useMtkStore = create<MtkState>()(
  immer((set) => ({
    mtk: { current_isp: 1, current_tab: 0, outer_splitter: [], inner_splitter: [], cpp_path: null, cpp_paths: {}, debug_parser_path: null },
    debugParserPath: null,
    imports:  {},
    imageDir: {},
    imageSelection: {},
    imageRevisions: {},

    hydrate: (value) => set((s) => {
      s.mtk = value;
      s.debugParserPath = value.debug_parser_path ?? null;
      s.imports = Object.fromEntries(Object.entries(value.cpp_paths ?? {}).map(([key, filePath]) => [
        key, { ...DEFAULT_IMPORT, filePath },
      ]));
      s.imageSelection = {};
      for (const key of Object.keys(s.imageRevisions)) s.imageRevisions[key] += 1;
      for (const image of Object.values(s.imageDir)) {
        image.loadRevision = (image.loadRevision ?? 0) + 1;
        image.metadataRevision = (image.metadataRevision ?? 0) + 1;
        image.metadataPreparing = false;
        image.preparationProgress = null;
      }
      if (value.cpp_path && !s.imports["ISP6S|0"]) {
        s.imports["ISP6S|0"] = { ...DEFAULT_IMPORT, filePath: value.cpp_path };
      }
    }),
    setCurrentIsp:  (idx) => set((s) => { s.mtk.current_isp = idx; s.mtk.current_tab = 0; }),
    setCurrentTab:  (idx) => set((s) => { s.mtk.current_tab = idx; }),
    setOuterSplit:  (sizes) => set((s) => { s.mtk.outer_splitter = sizes; }),
    setInnerSplit:  (sizes) => set((s) => { s.mtk.inner_splitter = sizes; }),
    setDebugParserPath: (path) => set((s) => { s.debugParserPath = path; s.mtk.debug_parser_path = path; }),
    setCppPath: (path, isp, tabIdx) => set((s) => {
      const key = `${isp}|${tabIdx}`;
      s.mtk.cpp_paths ??= {};
      if (path) s.mtk.cpp_paths[key] = path;
      else delete s.mtk.cpp_paths[key];
      if (isp === "ISP6S" && tabIdx === 0) s.mtk.cpp_path = path;
    }),

    setImport: (isp, tabIdx, patch) => set((s) => {
      const key = `${isp}|${tabIdx}`;
      s.imports[key] = { ...(s.imports[key] ?? DEFAULT_IMPORT), ...patch };
    }),
    setImageDir: (isp, tabIdx, patch) => set((s) => {
      const key = `${isp}|${tabIdx}`;
      const previous = s.imageDir[key] ?? DEFAULT_IMAGE_DIR;
      const reload = patch.dir !== undefined || patch.entries !== undefined || patch.current !== undefined || patch.status === "scanning";
      if (reload) {
        s.imageRevisions[key] = (s.imageRevisions[key] ?? 0) + 1;
      }
      const metadataRevision = patch.metadataRevision ?? (
        patch.entries !== undefined || (patch.dir !== undefined && patch.dir !== previous.dir)
          ? (previous.metadataRevision ?? 0) + 1
          : (previous.metadataRevision ?? 0)
      );
      s.imageDir[key] = {
        ...previous,
        ...patch,
        metadataRevision,
        loadRevision: (previous.loadRevision ?? 0) + (reload ? 1 : 0),
      };
      const image = s.imageDir[key];
      if (image.dir && image.status === "scanning") {
        s.mtk.image_workspaces ??= {};
        if (s.mtk.image_workspaces[key]?.dir !== image.dir) {
          s.mtk.image_workspaces[key] = { dir: image.dir, selected_image: null };
        }
      }
      if (image.dir && (image.status === "done" || (image.status === "loading" && image.entries[image.current]))) {
        s.mtk.image_workspaces ??= {};
        const selected = image.entries[image.current]?.jpg_path ?? null;
        const saved = s.mtk.image_workspaces[key];
        if (saved?.dir !== image.dir || saved.selected_image !== selected) {
          s.mtk.image_workspaces[key] = { dir: image.dir, selected_image: selected };
        }
      }
    }),
    setImageSelection: (workspaceKey, path) => set((s) => {
      const imageDirKey = workspaceKey === "ISP6S|1" ? "ISP6S|0" : workspaceKey;
      s.imageRevisions[imageDirKey] = (s.imageRevisions[imageDirKey] ?? 0) + 1;
      s.imageSelection[workspaceKey] = path;
    }),
    setExternalImageSelection: (imageDirKey, workspaceKey, index, path) => set((s) => {
      const image = s.imageDir[imageDirKey];
      if (!image || index < 0 || index >= image.entries.length || image.entries[index].jpg_path !== path) return;
      s.imageRevisions[imageDirKey] = (s.imageRevisions[imageDirKey] ?? 0) + 1;
      image.current = index;
      image.loadRevision = (image.loadRevision ?? 0) + 1;
      image.tomlData = {};
      image.status = "loading";
      image.message = null;
      s.imageSelection[workspaceKey] = path;
      if (image.dir) {
        s.mtk.image_workspaces ??= {};
        const saved = s.mtk.image_workspaces[imageDirKey];
        if (saved?.dir === image.dir) saved.selected_image = path;
        else s.mtk.image_workspaces[imageDirKey] = { dir: image.dir, selected_image: path };
      }
    }),
  })),
);

export const importKey = (isp: IspId, tabIdx: number) => `${isp}|${tabIdx}`;

export const DEFAULT_IMAGE_DIR_STATE = DEFAULT_IMAGE_DIR;
