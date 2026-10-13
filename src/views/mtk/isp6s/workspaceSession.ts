import type { PreviewMode } from "./ImagePane/ImagePane";
import type { ImageEntry } from "@/ipc/imageScan";

export interface ScrollPosition {
  top: number;
  left: number;
}

export type DetailsTab = "normal" | "face" | "lce" | "bcompare";

export interface WorkspaceSession {
  imageDir: string | null;
  imagePath: string | null;
  selectedToml: { entries: ImageEntry[]; path: string; data: Record<string, string> } | null;
  imageScroll: ScrollPosition | null;
  infoScroll: ScrollPosition | null;
  detailsTab: DetailsTab;
  detailsScroll: Partial<Record<DetailsTab, ScrollPosition>>;
  sourceMode: PreviewMode;
  sourceScroll: Record<string, ScrollPosition>;
  toneSourceSize: number;
  toneLceSize: number;
}

const sessions = new Map<string, WorkspaceSession>();
const SOURCE_SCROLL_LIMIT = 8;

export function rememberSourceScroll(session: WorkspaceSession, key: string, position: ScrollPosition) {
  delete session.sourceScroll[key];
  session.sourceScroll[key] = position;
  const keys = Object.keys(session.sourceScroll);
  if (keys.length > SOURCE_SCROLL_LIMIT) delete session.sourceScroll[keys[0]];
}

export function workspaceSession(key: string): WorkspaceSession {
  let session = sessions.get(key);
  if (!session) {
    session = {
      imageDir: null,
      imagePath: null,
      selectedToml: null,
      imageScroll: null,
      infoScroll: null,
      detailsTab: "normal",
      detailsScroll: {},
      sourceMode: "param_map",
      sourceScroll: {},
      toneSourceSize: 40,
      toneLceSize: 42,
    };
    sessions.set(key, session);
  }
  return session;
}
