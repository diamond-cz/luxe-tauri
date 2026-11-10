import { completeSelection, listenForSelection, publishSelection } from "@/ipc/imageSync";
import { loadImageToml } from "@/ipc/imageScan";
import { i18n } from "@/locales/i18n";
import { useMtkStore } from "@/stores/mtkStore";
import { ISP_LIST, ISP_TABS, type IspId } from "@/views/mtk/ispTabs";
import type { ImageSyncMessage, ImageSyncResult } from "@/types/imageSync";
import { findIndexedImage } from "./imageSyncMatching";
import { createImageSyncReceiver } from "./imageSyncReceiver";

const localSelectionObservers = new Set<() => void>();

function routeToWorkspace(imageDirKey: string) {
  const [ispText, tabText] = imageDirKey.split("|");
  const isp = ispText as IspId;
  const ispIndex = ISP_LIST.findIndex((item) => item.id === isp);
  if (ispIndex < 0) return null;
  const current = useMtkStore.getState().mtk;
  const tab = isp === "ISP6S" && tabText === "0" && current.current_isp === ispIndex
    && (current.current_tab === 0 || current.current_tab === 1)
    ? current.current_tab : Number(tabText);
  if (!Number.isInteger(tab) || tab < 0 || tab >= ISP_TABS[isp].length) return null;
  if (current.current_isp !== ispIndex) useMtkStore.getState().setCurrentIsp(ispIndex);
  if (useMtkStore.getState().mtk.current_tab !== tab) useMtkStore.getState().setCurrentTab(tab);
  return `${isp}|${tab}`;
}

function applyRemoteSelection(message: ImageSyncMessage): ImageSyncResult {
  const paths = [...new Set([...(message.imagePaths ?? []), ...(message.imagePath ? [message.imagePath] : [])]
    .filter((path) => /^(?:[a-z]:[\\/]|\\\\)/i.test(path)))];
  if (!paths.length) return { accepted: false, reason: "image-not-indexed" };
  const { match, ambiguous } = findIndexedImage(useMtkStore.getState().imageDir, paths);
  if (ambiguous) return { accepted: false, reason: "ambiguous-workspace" };
  if (!match) return { accepted: false, reason: "image-not-indexed" };
  const { imageDirKey, index } = match;
  const workspaceKey = routeToWorkspace(imageDirKey);
  if (!workspaceKey) return { accepted: false, reason: "image-not-indexed" };
  const image = useMtkStore.getState().imageDir[imageDirKey];
  const entry = image?.entries[index];
  if (!entry || entry.jpg_path !== match.path) return { accepted: false, reason: "image-not-indexed" };
  useMtkStore.getState().setExternalImageSelection(imageDirKey, workspaceKey, index, entry.jpg_path);
  const revision = useMtkStore.getState().imageRevisions[imageDirKey];
  const isCurrent = () => {
    const latest = useMtkStore.getState();
    return latest.imageRevisions[imageDirKey] === revision && latest.imageDir[imageDirKey]?.entries === image.entries
      && latest.imageSelection[workspaceKey] === entry.jpg_path;
  };
  const [isp, tab] = imageDirKey.split("|");
  void loadImageToml(entry.toml_path).then((tomlData) => {
    if (!isCurrent()) return;
    useMtkStore.getState().setImageDir(isp as IspId, Number(tab), {
      tomlData, status: "done", message: i18n.t("image_sync.current", { name: entry.name }),
    });
  }).catch(() => {
    if (!isCurrent()) return;
    useMtkStore.getState().setImageDir(isp as IspId, Number(tab), {
      tomlData: {}, status: "done", message: i18n.t("image_sync.current_without_toml", { name: entry.name }),
    });
  });
  // ACK confirms index/selection mutation; sidecar TOML loading is independent.
  return { accepted: true };
}

export async function publishImageSelection(imagePath: string): Promise<void> {
  for (const cancel of localSelectionObservers) cancel();
  await publishSelection(imagePath);
}

export async function startImageSyncListener(onApplied?: () => void): Promise<() => void> {
  const receiver = createImageSyncReceiver({
    apply: (message) => {
      const result = applyRemoteSelection(message);
      if (result.accepted) onApplied?.();
      return result;
    },
    isLoading: () => Object.values(useMtkStore.getState().imageDir)
      .some((image) => image.status === "scanning" || image.status === "loading"),
    complete: (delivery, result) => {
      void completeSelection(delivery.deliveryId, result).catch((error) =>
        console.warn("image sync completion failed", error));
    },
  });
  // A failed event registration leaves no synchronous store subscription behind.
  let unlistenEvent: () => void;
  try { unlistenEvent = await listenForSelection(receiver.receive); }
  catch (error) { receiver.dispose(); throw error; }
  const unlistenStore = useMtkStore.subscribe((next, previous) => {
    if (receiver.isApplying()) return;
    if (next.imageSelection !== previous.imageSelection) receiver.localSelection();
    else if (next.imageDir !== previous.imageDir) receiver.retry();
  });
  localSelectionObservers.add(receiver.localSelection);
  return () => {
    unlistenStore();
    unlistenEvent();
    localSelectionObservers.delete(receiver.localSelection);
    receiver.dispose();
  };
}
