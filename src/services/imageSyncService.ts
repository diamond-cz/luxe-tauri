import { listen } from "@tauri-apps/api/event";
import { call } from "@/ipc/client";
import { loadImageToml } from "@/ipc/imageScan";
import { useMtkStore } from "@/stores/mtkStore";
import { ISP_LIST, type IspId } from "@/views/mtk/ispTabs";
import type { ImageSyncMessage, ImageSyncResult } from "@/types/imageSync";

const EVENT = "image_sync_selection";
const MAX_SYNC_SOURCES = 32;
const normalizePath = (path: string) => path.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
const directoryOf = (path: string) => path.replaceAll("/", "\\").replace(/\\[^\\]*$/, "");

function imageDirectoryKey(workspaceKey: string) {
  const [isp, tab] = workspaceKey.split("|");
  return `${isp}|${isp === "ISP6S" && (tab === "0" || tab === "1") ? 0 : tab}`;
}

function findWorkspaceKey(path: string): string | null {
  const state = useMtkStore.getState();
  const parent = normalizePath(directoryOf(path));
  const candidates = new Set<string>();
  for (const [key, workspace] of Object.entries(state.mtk.image_workspaces ?? {})) {
    if (workspace.dir && normalizePath(workspace.dir) === parent) candidates.add(imageDirectoryKey(key));
  }
  for (const [key, workspace] of Object.entries(state.imageDir)) {
    if (workspace.dir && normalizePath(workspace.dir) === parent) candidates.add(key);
  }
  if (candidates.size !== 1) return null;
  return [...candidates][0];
}

function routeToWorkspace(imageDirKey: string) {
  const [ispText, tabText] = imageDirKey.split("|");
  const isp = ispText as IspId;
  const ispIndex = ISP_LIST.findIndex((item) => item.id === isp);
  if (ispIndex < 0) return null;
  const current = useMtkStore.getState().mtk;
  const tab = isp === "ISP6S" && tabText === "0" && current.current_isp === ispIndex
    && (current.current_tab === 0 || current.current_tab === 1)
    ? current.current_tab : Number(tabText);
  if (!Number.isInteger(tab) || tab < 0) return null;
  useMtkStore.getState().setCurrentIsp(ispIndex);
  useMtkStore.getState().setCurrentTab(tab);
  return `${isp}|${tab}`;
}

function applyRemoteSelection(message: ImageSyncMessage): ImageSyncResult {
  if (message.protocolVersion !== 1) return { accepted: false, reason: "unsupported-version" };
  const path = message.imagePath;
  if (!path || !/^(?:[a-z]:\\|\\\\)/i.test(path)) return { accepted: false, reason: "image-not-indexed" };
  const imageDirKey = findWorkspaceKey(path);
  if (!imageDirKey) return { accepted: false, reason: "ambiguous-workspace" };
  const workspaceKey = routeToWorkspace(imageDirKey);
  if (!workspaceKey) return { accepted: false, reason: "image-not-indexed" };
  const image = useMtkStore.getState().imageDir[imageDirKey];
  if (!image?.entries.length) return { accepted: false, reason: "image-not-indexed" };
  const index = image.entries.findIndex((entry) => normalizePath(entry.jpg_path) === normalizePath(path));
  if (index < 0) return { accepted: false, reason: "image-not-indexed" };
  const entry = image.entries[index];
  useMtkStore.getState().setExternalImageSelection(imageDirKey, workspaceKey, index, entry.jpg_path);
  void loadImageToml(entry.toml_path).then((tomlData) => {
    const latest = useMtkStore.getState().imageDir[imageDirKey];
    if (latest?.entries[latest.current]?.jpg_path !== entry.jpg_path) return;
    useMtkStore.getState().setImageDir(
      imageDirKey.split("|")[0] as IspId,
      Number(imageDirKey.split("|")[1]),
      { tomlData, status: "done", message: `当前 ${entry.name}` },
    );
  }).catch(() => {
    const latest = useMtkStore.getState().imageDir[imageDirKey];
    if (latest?.entries[latest.current]?.jpg_path === entry.jpg_path) {
      useMtkStore.getState().setImageDir(
        imageDirKey.split("|")[0] as IspId,
        Number(imageDirKey.split("|")[1]),
        { tomlData: {}, status: "done", message: `当前 ${entry.name}（未找到同名 TOML，暂显示 -）` },
      );
    }
  });
  return { accepted: true };
}

export async function publishImageSelection(imagePath: string): Promise<void> {
  await call<void>("publish_image_selection", { imagePath });
}

export async function startImageSyncListener(): Promise<() => void> {
  let pending: ImageSyncMessage | null = null;
  let applyingPending = false;
  const lastSequenceBySource = new Map<string, number>();

  const acceptMessage = (message: ImageSyncMessage): boolean => {
    if (message.kind !== "selection" || message.sourceInstance.startsWith("luxe-")) return false;
    const lastSequence = lastSequenceBySource.get(message.sourceInstance) ?? 0;
    if (message.sequence <= lastSequence) return false;
    if (!lastSequenceBySource.has(message.sourceInstance) && lastSequenceBySource.size >= MAX_SYNC_SOURCES) return false;
    lastSequenceBySource.set(message.sourceInstance, message.sequence);
    return true;
  };

  const queueOrApply = (message: ImageSyncMessage) => {
    if (!acceptMessage(message)) return;
    const result = applyRemoteSelection(message);
    pending = null;
    if (!result.accepted && result.reason === "image-not-indexed") {
      const key = message.imagePath ? findWorkspaceKey(message.imagePath) : null;
      const image = key ? useMtkStore.getState().imageDir[key] : null;
      if (!image?.entries.length || image.status === "scanning" || image.status === "loading") {
        pending = message;
      }
    }
    if (!result.accepted) {
      console.info("image sync selection was not applied", result.reason, message.imagePath);
    }
  };

  const tryPending = () => {
    if (!pending || applyingPending) return;
    applyingPending = true;
    const message = pending;
    pending = null;
    try {
      const result = applyRemoteSelection(message);
      if (!result.accepted && result.reason === "image-not-indexed") {
        const key = findWorkspaceKey(message.imagePath ?? "");
        const image = key ? useMtkStore.getState().imageDir[key] : null;
        if (!image?.entries.length || image.status === "scanning" || image.status === "loading") pending = message;
      }
    } finally {
      applyingPending = false;
    }
  };
  const unlistenStore = useMtkStore.subscribe(() => tryPending());
  const unlistenEvent = await listen<ImageSyncMessage>(EVENT, ({ payload }) => queueOrApply(payload));
  return () => {
    unlistenStore();
    unlistenEvent();
  };
}
