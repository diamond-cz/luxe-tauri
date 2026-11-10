import type { ImageSyncDelivery, ImageSyncResult } from "@/types/imageSync";

type Ports = {
  apply: (delivery: ImageSyncDelivery) => ImageSyncResult;
  isLoading: () => boolean;
  complete: (delivery: ImageSyncDelivery, result: ImageSyncResult) => void;
  schedule?: (callback: () => void, delay: number) => () => void;
};

/** One latest pending selection, 32 sources and a two-second scan grace period. */
export function createImageSyncReceiver(ports: Ports) {
  const lastSequences = new Map<string, number>();
  let pending: ImageSyncDelivery | undefined;
  let cancelTimer: (() => void) | undefined;
  let applying = false;
  let disposed = false;
  const schedule = ports.schedule ?? ((callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  });
  const finish = (result: ImageSyncResult) => {
    const delivery = pending;
    pending = undefined;
    cancelTimer?.();
    cancelTimer = undefined;
    if (delivery) ports.complete(delivery, result);
  };
  const retry = () => {
    if (disposed || applying || !pending) return;
    applying = true;
    try {
      const result = ports.apply(pending);
      if (result.accepted || result.reason !== "image-not-indexed" || !ports.isLoading()) finish(result);
    } catch {
      finish({ accepted: false, reason: "invalid-message" });
    } finally { applying = false; }
  };
  return {
    receive(delivery: ImageSyncDelivery) {
      const reject = (reason: ImageSyncResult["reason"]) => ports.complete(delivery, { accepted: false, reason });
      if (disposed) return reject("listener-stopped");
      if (delivery.protocolVersion !== 1) return reject("unsupported-version");
      if (delivery.kind !== "selection" || !delivery.sourceInstance || delivery.sourceInstance.startsWith("luxe-")
        || !Number.isSafeInteger(delivery.sequence) || delivery.sequence <= 0) return reject("invalid-message");
      if (delivery.sequence <= (lastSequences.get(delivery.sourceInstance) ?? 0)) return reject("stale-sequence");
      if (!lastSequences.has(delivery.sourceInstance) && lastSequences.size >= 32) return reject("too-many-sources");
      lastSequences.set(delivery.sourceInstance, delivery.sequence);
      finish({ accepted: false, reason: "superseded" });
      pending = delivery;
      cancelTimer = schedule(() => finish({ accepted: false, reason: "image-not-indexed" }), 2000);
      retry();
    },
    retry,
    localSelection() { if (!applying) finish({ accepted: false, reason: "local-selection" }); },
    isApplying: () => applying,
    dispose() {
      disposed = true;
      finish({ accepted: false, reason: "listener-stopped" });
      lastSequences.clear();
    },
  };
}
