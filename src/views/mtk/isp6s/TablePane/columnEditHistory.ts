export type ColumnEditField = "label" | "source";
export type ColumnEditHistoryItem = { value: string; favorite: boolean };
const LIMIT = 50;
const keyFor = (field: ColumnEditField) => `luxe:isp6s:column-edit-${field}-history`;

export function readColumnEditHistory(field: ColumnEditField): ColumnEditHistoryItem[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(keyFor(field)) ?? "[]");
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

export function writeColumnEditHistory(field: ColumnEditField, items: ColumnEditHistoryItem[]) {
  try { localStorage.setItem(keyFor(field), JSON.stringify(favoritesFirst(items))); }
  catch { /* History remains available in the current view. */ }
}

export function rememberColumnEdit(field: ColumnEditField, value: string) {
  const text = value.trim();
  if (!text || text.length > 500) return;
  const items = readColumnEditHistory(field);
  const previous = items.find((item) => item.value === text);
  writeColumnEditHistory(field, [{ value: text, favorite: previous?.favorite ?? false },
    ...items.filter((item) => item.value !== text)]);
}
