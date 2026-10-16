import { useUpdateStore } from "@/stores/updateStore";

export async function installAvailableUpdate(): Promise<void> {
  const state = useUpdateStore.getState();
  if (state.status !== "available" || !state.update) return;
  const update = state.update;
  state.setDownloadStart();
  try {
    await update.download((event) => {
      if (event.event === "Started") useUpdateStore.getState().setDownloadProgress(0, event.data.contentLength);
      if (event.event === "Progress") useUpdateStore.getState().setDownloadProgress(event.data.chunkLength);
    });
    useUpdateStore.getState().setInstalling();
    await update.install();
  } catch (error) {
    await update.close().catch(() => {});
    useUpdateStore.getState().setError(error, "manual");
  }
}
