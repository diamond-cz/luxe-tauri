import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { CURRENT_VERSION, GITHUB_RELEASES_URL, type UpdateCheckResult } from "@/services/updateCheck";

export type UpdateStatus = "idle" | "checking" | "ok" | "available" | "manual" | "downloading" | "installing" | "error";
export type UpdateCheckSource = "manual" | "startup";

interface UpdateState {
  status: UpdateStatus;
  message: string;
  currentVersion: string;
  latestVersion: string | null;
  notes: string | null;
  releaseUrl: string;
  checkedAt: number | null;
  source: UpdateCheckSource | null;
  update: Update | null;
  downloadedBytes: number;
  totalBytes: number | null;
  setCurrentVersion: (version: string) => void;
  setChecking: (source: UpdateCheckSource) => void;
  setResult: (result: UpdateCheckResult, source: UpdateCheckSource) => void;
  setDownloadStart: () => void;
  setDownloadProgress: (chunkLength: number, contentLength?: number) => void;
  setInstalling: () => void;
  setError: (err: unknown, source: UpdateCheckSource) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: "idle",
  message: "可检查最新发布版本",
  currentVersion: CURRENT_VERSION,
  latestVersion: null,
  notes: null,
  releaseUrl: GITHUB_RELEASES_URL,
  checkedAt: null,
  source: null,
  update: null,
  downloadedBytes: 0,
  totalBytes: null,
  setCurrentVersion: (currentVersion) => set({ currentVersion }),
  setChecking: (source) => set({
    status: "checking",
    message: source === "startup" ? "正在自动检查更新..." : "正在检查更新...",
    source,
    update: null,
    downloadedBytes: 0,
    totalBytes: null,
  }),
  setResult: (result, source) => set({
    status: result.status,
    message: result.status === "available" || result.status === "manual"
      ? `发现新版本 v${result.latestVersion}，当前版本 v${result.currentVersion}`
      : `当前已是最新版本 v${result.currentVersion}`,
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
    notes: result.notes ?? null,
    releaseUrl: result.releaseUrl,
    checkedAt: result.checkedAt,
    source,
    update: result.update,
  }),
  setDownloadStart: () => set({
    status: "downloading",
    message: "正在下载更新...",
    downloadedBytes: 0,
    totalBytes: null,
  }),
  setDownloadProgress: (chunkLength, contentLength) => set((state) => {
    const downloadedBytes = state.downloadedBytes + chunkLength;
    const totalBytes = contentLength ?? state.totalBytes;
    const progress = totalBytes ? `${Math.min(100, Math.floor(downloadedBytes / totalBytes * 100))}%` : `${(downloadedBytes / 1048576).toFixed(1)} MB`;
    return { downloadedBytes, totalBytes, message: `正在下载更新 ${progress}` };
  }),
  setInstalling: () => set({ status: "installing", message: "正在安装更新，完成后将重新启动..." }),
  setError: (err, source) => set({
    status: "error",
    message: err instanceof Error ? err.message : String(err),
    checkedAt: Date.now(),
    source,
    update: null,
  }),
}));
