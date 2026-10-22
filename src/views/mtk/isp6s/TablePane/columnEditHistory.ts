export type ColumnEditField = "label" | "source";
export type ColumnEditHistoryItem = { value: string; favorite: boolean };
export type ColumnEditHistoryKey = { mode: "isp6s" | "tone"; scope: "all" | "face" | "normal"; columnId: string; field: ColumnEditField };
const LIMIT = 50;
const keyFor = ({ mode, scope, columnId, field }: ColumnEditHistoryKey) =>
  `luxe:column-edit-history:${mode}:${scope}:${encodeURIComponent(columnId)}:${field}`;

export function readColumnEditHistory(key: ColumnEditHistoryKey): ColumnEditHistoryItem[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(keyFor(key)) ?? "[]");
    if (!Array.isArray(saved)) return [];
    const seen = new Set<string>();
    return saved.filter((item): item is ColumnEditHistoryItem => item && typeof item.value === "string"
      && item.value.trim().length > 0 && item.value.length <= 500 && typeof item.favorite === "boolean")
      .filter((item) => {
        if (seen.has(item.value)) return false;
        seen.add(item.value);
        return true;
      }).slice(0, LIMIT);
  } catch { return []; }
}

export function favoritesFirst(items: ColumnEditHistoryItem[]) {
  return [...items.filter((item) => item.favorite), ...items.filter((item) => !item.favorite)].slice(0, LIMIT);
}

export function writeColumnEditHistory(key: ColumnEditHistoryKey, items: ColumnEditHistoryItem[]) {
  try { localStorage.setItem(keyFor(key), JSON.stringify(favoritesFirst(items))); }
  catch { /* History remains available in the current view. */ }
}

export function rememberColumnEdit(key: ColumnEditHistoryKey, value: string) {
  const text = value.trim();
  if (!text || text.length > 500) return;
  const items = readColumnEditHistory(key);
  const previous = items.find((item) => item.value === text);
  writeColumnEditHistory(key, [{ value: text, favorite: previous?.favorite ?? false },
    ...items.filter((item) => item.value !== text)]);
}
