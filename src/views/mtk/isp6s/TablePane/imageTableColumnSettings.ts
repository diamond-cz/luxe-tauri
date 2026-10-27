import type { ImageTableColorThresholds, ImageTableModeColumns, ImageTableScopeColumns } from "@/types/ipc";

export type ColumnScope = "all" | "face" | "normal";
export type ColumnMode = "isp6s" | "tone";
export const COLUMN_SETTINGS_SAVED_EVENT = "luxe:image-table-columns-saved";
export const COLUMN_SETTINGS_PREVIEW_EVENT = "luxe:image-table-columns-preview";
export const COLUMN_SETTINGS_CANCEL_EVENT = "luxe:image-table-columns-cancel";
export const COLUMN_SETTINGS_SCOPE_EVENT = "luxe:image-table-columns-scope";

export type ColumnSettingsSaved = { mode: ColumnMode; settings: ImageTableModeColumns };
export const DEFAULT_COLOR_THRESHOLDS: ImageTableColorThresholds = { ae_gain: 0.05, ev: 0.005, delta: 5 };

export function stepThresholdDraft(value: string, direction: -1 | 1): string {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed) || !Number.isFinite(Number(trimmed))) return value;
  const [whole, fraction = ""] = trimmed.split(".");
  const next = BigInt(whole + fraction) + BigInt(direction);
  if (next < 0n) return value;
  if (!fraction) return next.toString();
  const digits = next.toString().padStart(fraction.length + 1, "0");
  return `${digits.slice(0, -fraction.length)}.${digits.slice(-fraction.length)}`;
}

export function normalizeColorThresholds(value: Partial<ImageTableColorThresholds> | undefined): ImageTableColorThresholds {
  const valid = (candidate: number | undefined, fallback: number) =>
    typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : fallback;
  return {
    ae_gain: valid(value?.ae_gain, DEFAULT_COLOR_THRESHOLDS.ae_gain),
    ev: valid(value?.ev, DEFAULT_COLOR_THRESHOLDS.ev),
    delta: valid(value?.delta, DEFAULT_COLOR_THRESHOLDS.delta),
  };
}

export function columnScopeForThumbnail(kind: "mixed" | "portrait" | "scene"): ColumnScope {
  return kind === "scene" ? "normal" : kind === "portrait" ? "face" : "all";
}

export function collectImageTableCustomColumns(settings: ImageTableModeColumns): ImageTableScopeColumns["custom"] {
  return [settings.all, settings.face, settings.normal].flatMap((scope) => scope.custom);
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
      widths: saved?.widths && typeof saved.widths === "object"
        ? Object.fromEntries(Object.entries(saved.widths).filter(([, width]) =>
          typeof width === "number" && Number.isFinite(width) && width > 0))
        : {},
      edits: saved?.edits && typeof saved.edits === "object" ? saved.edits : {},
      custom: Array.isArray(saved?.custom) ? saved.custom.filter((column) => column.scope === scope) : [],
    };
  };
  const legacyThresholds = (value as (ImageTableModeColumns & {
    all?: ImageTableScopeColumns & { color_thresholds?: Partial<ImageTableColorThresholds> };
  }) | undefined)?.all?.color_thresholds;
  return {
    all: normalizeScope("all"),
    face: normalizeScope("face"),
    normal: normalizeScope("normal"),
    color_thresholds: normalizeColorThresholds(value?.color_thresholds ?? legacyThresholds),
  };
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
    widths: {},
    edits: Object.fromEntries(Object.entries(shared.edits).map(([id, edit]) => [id, { ...edit }])),
    custom: custom.filter((column) => column.scope === scope).map((column) => ({ ...column })),
  });
  return { all: scopeSettings("all"), face: scopeSettings("face"), normal: scopeSettings("normal"),
    color_thresholds: { ...DEFAULT_COLOR_THRESHOLDS } };
}
