export interface ImageSyncMessage {
  protocolVersion: 1;
  kind: "selection" | "ack";
  sourceInstance: string;
  sequence: number;
  imagePath?: string;
  /** Ordered candidates; imagePath remains for protocol v1 senders. */
  imagePaths?: string[];
  accepted?: boolean;
  reason?: string;
}

export interface ImageSyncResult {
  accepted: boolean;
  reason?: "image-not-indexed" | "ambiguous-workspace" | "unsupported-version"
    | "stale-sequence" | "too-many-sources" | "superseded" | "local-selection"
    | "listener-stopped" | "invalid-message";
}

/** Private WebView delivery identity; never sent over the pipe. */
export interface ImageSyncDelivery extends ImageSyncMessage {
  deliveryId: string;
}
