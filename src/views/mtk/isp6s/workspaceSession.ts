export interface ScrollPosition {
  top: number;
  left: number;
}

export type DetailsTab = "normal" | "face" | "lce" | "exif" | "bcompare";

export interface WorkspaceSession {
  imageDir: string | null;
  imagePath: string | null;
  selectedToml: { dir: string; path: string; data: Record<string, string> } | null;
  imageScroll: ScrollPosition | null;
  detailsTab: DetailsTab;
  exifShowHeader: boolean;
  detailsScroll: Partial<Record<DetailsTab, ScrollPosition>>;
  sourceScroll: Record<string, ScrollPosition>;
  toneSourceSize: number;
  toneLceSize: number;
}

const sessions = new Map<string, WorkspaceSession>();
const SOURCE_SCROLL_LIMIT = 8;
const WORKSPACE_SESSION_LIMIT = 16;

export function rememberSourceScroll(session: WorkspaceSession, key: string, position: ScrollPosition) {
  delete session.sourceScroll[key];
  session.sourceScroll[key] = position;
  const keys = Object.keys(session.sourceScroll);
  if (keys.length > SOURCE_SCROLL_LIMIT) delete session.sourceScroll[keys[0]];
}

export function workspaceSession(key: string): WorkspaceSession {
  let session = sessions.get(key);
  if (session) {
    // Refresh insertion order so the least recently used workspace is evicted.
    sessions.delete(key);
    sessions.set(key, session);
    return session;
  }
  session = {
    imageDir: null,
    imagePath: null,
    selectedToml: null,
    imageScroll: null,
    detailsTab: "normal",
    exifShowHeader: true,
    detailsScroll: {},
    sourceScroll: {},
    toneSourceSize: 40,
    toneLceSize: 42,
  };
  sessions.set(key, session);
  while (sessions.size > WORKSPACE_SESSION_LIMIT) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
  return session;
}
