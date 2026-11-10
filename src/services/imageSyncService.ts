import { listen } from "@tauri-apps/api/event";
import { call } from "@/ipc/client";
import { loadImageToml } from "@/ipc/imageScan";
import { useMtkStore } from "@/stores/mtkStore";
import { ISP_LIST, type IspId } from "@/views/mtk/ispTabs";
import type { ImageSyncMessage, ImageSyncResult } from "@/types/imageSync";

const EVENT = "image_sync_selection";
const MAX_SYNC_SOURCES = 32;
const normalizePath = (path: string) => path.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();

function selectionPaths(message: ImageSyncMessage): string[] {
  return [...new Set([...(message.imagePaths ?? []), ...(message.imagePath ? [message.imagePath] : [])]
    .filter((path) => /^(?:[a-z]:[\\/]|\\\\)/i.test(path)))];
}

type IndexedMatch = { imageDirKey: string; index: number; path: string };

function findIndexedImage(paths: string[]): { match?: IndexedMatch; ambiguous: boolean } {
  const imageDirs = Object.entries(useMtkStore.getState().imageDir);
  for (const path of paths) {
    const normalized = normalizePath(path);
    const exact = imageDirs.flatMap(([imageDirKey, image]) => image.entries.flatMap((entry, index) =>
      normalizePath(entry.jpg_path) === normalized ? [{ imageDirKey, index, path: entry.jpg_path }] : []));
    if (exact.length === 1) return { match: exact[0], ambiguous: false };
    if (exact.length > 1) return { ambiguous: true };
  }

  for (const path of paths) {
    const normalized = normalizePath(path);
    const filename = normalized.split("\\").at(-1);
    if (!filename) continue;
    const byName = imageDirs.flatMap(([imageDirKey, image]) => image.entries.flatMap((entry, index) =>
      normalizePath(entry.jpg_path).split("\\").at(-1) === filename
        ? [{ imageDirKey, index, path: entry.jpg_path }]
        : []));
    if (byName.length === 1) return { match: byName[0], ambiguous: false };
    if (byName.length > 1) return { ambiguous: true };
  }
  return { ambiguous: false };
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
  const paths = selectionPaths(message);
  if (!paths.length) return { accepted: false, reason: "image-not-indexed" };
  const { match, ambiguous } = findIndexedImage(paths);
  if (ambiguous) return { accepted: false, reason: "ambiguous-workspace" };
  if (!match) return { accepted: false, reason: "image-not-indexed" };
  const { imageDirKey, index } = match;
  const workspaceKey = routeToWorkspace(imageDirKey);
  if (!workspaceKey) return { accepted: false, reason: "image-not-indexed" };
  const image = useMtkStore.getState().imageDir[imageDirKey];
  if (!image?.entries.length) return { accepted: false, reason: "image-not-indexed" };
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
      if (Object.values(useMtkStore.getState().imageDir).some((image) => image.status === "scanning" || image.status === "loading")) {
        pending = message;
      }
    }
    if (!result.accepted) {
      console.info("image sync selection was not applied", result.reason, selectionPaths(message));
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
        if (Object.values(useMtkStore.getState().imageDir).some((image) => image.status === "scanning" || image.status === "loading")) pending = message;
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
