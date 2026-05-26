import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Mtk } from "@/types/ipc";
import type { ParseResult } from "@/types/cpp_parser";
import type { IspId } from "@/views/mtk/ispTabs";
import type { ImageEntry } from "@/ipc/imageScan";

type ImportState = {
  filePath: string | null;
  parsed:   ParseResult | null;
  status:   "idle" | "parsing" | "done" | "error";
  message:  string | null;
};

type ImageDirState = {
  dir:       string | null;
  entries:   ImageEntry[];
  /** Index into `entries` of the currently-selected image. */
  current:   number;
  /** Flat AE_TAG_* → string value map of the current image's TOML. */
  tomlData:  Record<string, string>;
  status:    "idle" | "scanning" | "loading" | "done" | "error";
  message:   string | null;
};

const DEFAULT_IMPORT: ImportState = {
  filePath: null, parsed: null, status: "idle", message: null,
};
const DEFAULT_IMAGE_DIR: ImageDirState = {
  dir: null, entries: [], current: 0, tomlData: {}, status: "idle", message: null,
};

interface MtkState {
  mtk: Mtk;
  /** Per-(ISP × tab) import state, keyed by `"${IspId}|${tabIdx}"`. */
  imports:  Record<string, ImportState>;
  imageDir: Record<string, ImageDirState>;

  setCurrentIsp:  (idx: number) => void;
  setCurrentTab:  (idx: number) => void;
  setOuterSplit:  (sizes: number[]) => void;
  setInnerSplit:  (sizes: number[]) => void;

  setImport:   (isp: IspId, tabIdx: number, state: Partial<ImportState>) => void;
  setImageDir: (isp: IspId, tabIdx: number, state: Partial<ImageDirState>) => void;
}

export const useMtkStore = create<MtkState>()(
  immer((set) => ({
    mtk: { current_isp: 1, current_tab: 0, outer_splitter: [], inner_splitter: [] },
    imports:  {},
    imageDir: {},

    setCurrentIsp:  (idx) => set((s) => { s.mtk.current_isp = idx; s.mtk.current_tab = 0; }),
    setCurrentTab:  (idx) => set((s) => { s.mtk.current_tab = idx; }),
    setOuterSplit:  (sizes) => set((s) => { s.mtk.outer_splitter = sizes; }),
    setInnerSplit:  (sizes) => set((s) => { s.mtk.inner_splitter = sizes; }),

    setImport: (isp, tabIdx, patch) => set((s) => {
      const key = `${isp}|${tabIdx}`;
      s.imports[key] = { ...(s.imports[key] ?? DEFAULT_IMPORT), ...patch };
    }),
    setImageDir: (isp, tabIdx, patch) => set((s) => {
      const key = `${isp}|${tabIdx}`;
      s.imageDir[key] = { ...(s.imageDir[key] ?? DEFAULT_IMAGE_DIR), ...patch };
    }),
  })),
);

export const importKey = (isp: IspId, tabIdx: number) => `${isp}|${tabIdx}`;

export const DEFAULT_IMAGE_DIR_STATE = DEFAULT_IMAGE_DIR;
