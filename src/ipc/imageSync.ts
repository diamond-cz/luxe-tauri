import { listen } from "@tauri-apps/api/event";
import { call, EVT_IMAGE_SYNC_SELECTION } from "./client";
import type { ImageSyncDelivery, ImageSyncResult } from "@/types/imageSync";

export const publishSelection = (imagePath: string) =>
  call<void>("publish_image_selection", { imagePath });

export const completeSelection = (deliveryId: string, result: ImageSyncResult) =>
  call<void>("complete_image_sync_selection", { deliveryId, result });

export const listenForSelection = (receive: (delivery: ImageSyncDelivery) => void) =>
  listen<ImageSyncDelivery>(EVT_IMAGE_SYNC_SELECTION, ({ payload }) => receive(payload));
