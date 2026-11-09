export interface ImageSyncMessage {
  protocolVersion: 1;
  kind: "selection" | "ack";
  sourceInstance: string;
  sequence: number;
  imagePath?: string;
  accepted?: boolean;
  reason?: string;
}

export interface ImageSyncResult {
  accepted: boolean;
  reason?: "image-not-indexed" | "ambiguous-workspace" | "unsupported-version";
}
