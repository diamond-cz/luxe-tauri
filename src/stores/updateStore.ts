import { create } from "zustand";
import {
  CURRENT_VERSION,
  GITHUB_RELEASES_URL,
  type UpdateCheckResult,
} from "@/services/updateCheck";

export type UpdateStatus = "idle" | "checking" | "ok" | "available" | "unknown" | "error";
export type UpdateCheckSource = "manual" | "startup";

interface UpdateState {
  status: UpdateStatus;
  message: string;
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string;
  checkedAt: number | null;
  source: UpdateCheckSource | null;
  setChecking: (source: UpdateCheckSource) => void;
  setResult: (result: UpdateCheckResult, source: UpdateCheckSource) => void;
  setError: (err: unknown, source: UpdateCheckSource) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  status: "idle",
  message: "可检查 GitHub 最新发布版本",
  currentVersion: CURRENT_VERSION,
  latestVersion: null,
  releaseUrl: GITHUB_RELEASES_URL,
  checkedAt: null,
  source: null,
  setChecking: (source) => set({
    status: "checking",
    message: source === "startup" ? "正在自动检查更新..." : "正在检查更新...",
    source,
  }),
  setResult: (result, source) => set({
    status: result.status,
    message: result.status === "available"
      ? `发现新版本 v${result.latestVersion}，当前版本 v${result.currentVersion}`
      : result.status === "unknown"
        ? (result.message ?? "无法自动判断最新版本，请打开 Releases 页面查看")
        : `当前已是最新版本 v${result.currentVersion}`,
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
    releaseUrl: result.releaseUrl,
    checkedAt: result.checkedAt,
    source,
  }),
  setError: (err, source) => set({
    status: "error",
    message: err instanceof Error ? err.message : String(err),
    checkedAt: Date.now(),
    source,
  }),
}));
