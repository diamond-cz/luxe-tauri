export const normalizeSyncPath = (path: string) =>
  path.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();

type IndexedImage = { jpg_path: string };
type ImageDirectories = Record<string, { entries: readonly IndexedImage[] }>;
export type IndexedMatch = { imageDirKey: string; index: number; path: string };

/** Complete the exact-path pass before considering any filename fallback. */
export function findIndexedImage(imageDirs: ImageDirectories, paths: readonly string[]): {
  match?: IndexedMatch; ambiguous: boolean;
} {
  const exact = new Map<string, IndexedMatch[]>();
  const names = new Map<string, IndexedMatch[]>();
  for (const [imageDirKey, image] of Object.entries(imageDirs)) {
    image.entries.forEach((entry, index) => {
      const path = normalizeSyncPath(entry.jpg_path);
      const match = { imageDirKey, index, path: entry.jpg_path };
      const name = path.split("\\").at(-1)!;
      for (const [map, key] of [[exact, path], [names, name]] as const) {
        const matches = map.get(key);
        if (matches) matches.push(match);
        else map.set(key, [match]);
      }
    });
  }
  for (const map of [exact, names]) {
    for (const path of paths) {
      const normalized = normalizeSyncPath(path);
      const key = map === exact ? normalized : normalized.split("\\").at(-1)!;
      const matches = map.get(key);
      if (matches?.length === 1) return { match: matches[0], ambiguous: false };
      if (matches && matches.length > 1) return { ambiguous: true };
    }
  }
  return { ambiguous: false };
}
