import type { ImageTableModeColumns, ImageTableScopeColumns } from "@/types/ipc";

export type ColumnScope = "all" | "face" | "normal";
export type ColumnMode = "isp6s" | "tone";
export const COLUMN_SETTINGS_SAVED_EVENT = "luxe:image-table-columns-saved";
export const COLUMN_SETTINGS_PREVIEW_EVENT = "luxe:image-table-columns-preview";
export const COLUMN_SETTINGS_CANCEL_EVENT = "luxe:image-table-columns-cancel";
export const COLUMN_SETTINGS_SCOPE_EVENT = "luxe:image-table-columns-scope";

export type ColumnSettingsSaved = { mode: ColumnMode; settings: ImageTableModeColumns };

export function columnScopeForThumbnail(kind: "mixed" | "portrait" | "scene"): ColumnScope {
  return kind === "scene" ? "normal" : kind === "portrait" ? "face" : "all";
}

export function orderedSettingsRows<T extends { id: string }>(rows: T[], settings: ImageTableScopeColumns): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pinned = settings.pinned.filter((id, index) => byId.has(id) && settings.pinned.indexOf(id) === index);
  const pinnedSet = new Set(pinned);
  const positions = new Map(settings.order.map((id, index) => [id, index]));
  return [
    ...pinned.map((id) => byId.get(id)!),
    ...rows.filter((row) => !pinnedSet.has(row.id))
      .sort((a, b) => (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER)),
  ];
}

export function normalizeColumnMode(value: ImageTableModeColumns | undefined | null): ImageTableModeColumns {
  const normalizeScope = (scope: ColumnScope): ImageTableScopeColumns => {
    const saved = value?.[scope];
    return {
      order: Array.isArray(saved?.order) ? saved.order : [],
      pinned: Array.isArray(saved?.pinned) ? saved.pinned : [],
      hidden: Array.isArray(saved?.hidden) ? saved.hidden : [],
      deleted: Array.isArray(saved?.deleted) ? saved.deleted : [],
      edits: saved?.edits && typeof saved.edits === "object" ? saved.edits : {},
      custom: Array.isArray(saved?.custom) ? saved.custom.filter((column) => column.scope === scope) : [],
    };
  };
  return { all: normalizeScope("all"), face: normalizeScope("face"), normal: normalizeScope("normal") };
}

export function readLegacyColumnMode(mode: ColumnMode): ImageTableModeColumns {
  const base = mode === "tone" ? "luxe:isp6s:tone-image-table-" : "luxe:isp6s:image-table-";
  const read = (suffix: string): unknown => {
    try { return JSON.parse(localStorage.getItem(base + suffix) ?? "null"); } catch { return null; }
  };
  const strings = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string") : [];
  const editsValue = read("column-edits");
  const edits = editsValue && typeof editsValue === "object" && !Array.isArray(editsValue)
    ? Object.fromEntries(Object.entries(editsValue).filter(([, value]) => value && typeof value === "object"
      && !Array.isArray(value) && Object.values(value).every((part) => typeof part === "string"))) : {};
  const customValue = read("custom-columns");
  const custom = Array.isArray(customValue) ? customValue.filter((column) => column
    && typeof column.id === "string" && typeof column.label === "string"
    && typeof column.source === "string" && ["all", "face", "normal"].includes(column.scope)) : [];
  const shared = {
    order: strings(read("column-order")),
    pinned: strings(read("pinned-columns")),
    hidden: strings(read("column-visibility")),
    deleted: strings(read("deleted-columns")),
    edits,
  };
  const scopeSettings = (scope: ColumnScope): ImageTableScopeColumns => ({
    ...shared, order: [...shared.order], pinned: [...shared.pinned], hidden: [...shared.hidden], deleted: [...shared.deleted],
    edits: Object.fromEntries(Object.entries(shared.edits).map(([id, edit]) => [id, { ...edit }])),
    custom: custom.filter((column) => column.scope === scope).map((column) => ({ ...column })),
  });
  return { all: scopeSettings("all"), face: scopeSettings("face"), normal: scopeSettings("normal") };
}
