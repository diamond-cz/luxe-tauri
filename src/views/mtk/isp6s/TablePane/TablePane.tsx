import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "@fluentui/react-components";
import {
  ChevronDown24Regular,
  ChevronUp24Regular,
  ArrowLeft24Regular,
  ArrowRight24Regular,
  TableCellCenterSearch24Regular,
  Image24Regular,
  ImageMultiple24Regular,
  Person24Regular,
  TableSimple24Regular,
  ChartMultiple24Regular,
  FolderAdd24Regular,
  DocumentData24Regular,
  CalculatorArrowClockwise24Regular,
  Search24Regular,
  Settings24Regular,
  LinkMultiple24Regular,
  LinkDismiss24Regular,
} from "@fluentui/react-icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit, listen } from "@tauri-apps/api/event";
import { Panel, PanelGroup } from "react-resizable-panels";

import { loadImageHoverPreview, loadImageThumbnailBatch, loadImageTomlFieldsBatchShared, type ImageEntry } from "@/ipc/imageScan";
import { useImagePreview, useImagePreviewUrl } from "@/hooks/useImagePreviewUrl";
import { ensureDirectory } from "@/ipc/shell";
import { flushStateNow, loadState, saveImageTableMode, saveStateSection } from "@/ipc/stateIo";
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";
import type { ImageTableModeColumns } from "@/types/ipc";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { LceChart } from "./LceChart";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import { ImageSplitMode } from "../ImagePane/ImageSplitMode";
import { classifyImageTableRow, shouldShowImageTableRow, type ImageTableKind } from "./imageTableClassification";
import { imageTableExtraColumns, imageTableMapping, isImageTableColumnMapped } from "./imageTableMapping";
import { customImageColumnText, imageColumnSourceKeys, isAeGainPairSource } from "./imageTableCustomColumns";
import { deltaEv, formatCwrEvTriplet, formatDeltaEv, isCwrDeltaFormula, isCwrEvFormula, metricDirection, parseMetricPair, parseMetricResult, selectImageTableEv } from "./imageTableMetrics";
import { COLUMN_SETTINGS_CANCEL_EVENT, COLUMN_SETTINGS_PREVIEW_EVENT, COLUMN_SETTINGS_SAVED_EVENT, COLUMN_SETTINGS_SCOPE_EVENT, collectImageTableCustomColumns, columnScopeForThumbnail, normalizeColumnMode, readLegacyColumnMode, type ColumnMode, type ColumnScope, type ColumnSettingsSaved } from "./imageTableColumnSettings";
import { prepareColumnSettingsBootstrap } from "./columnSettingsBootstrap";
import { columnSettingsPlacement } from "./columnSettingsPlacement";
import { useSettingsStore } from "@/stores/settingsStore";
import { useIsp6sVisualStore } from "@/stores/isp6sVisualStore";
import type { ScrollPosition } from "../workspaceSession";

/** 空景筛选图标：线条树叶和右下角保护标记。 */
function SceneLeafProtectIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 15.5C3.5 9 8.3 4.4 19.5 3.5c0 8.9-3.7 14-10.2 14C7 17.5 5.2 16.9 4 15.5Z" />
      <path d="M3.5 20.5c2.8-5.3 6.7-9.2 12.2-12.7M8 14.6l-.7-4.1m3.5 1.5 4.1.1" />
      <circle cx="18" cy="18" r="4" fill="var(--colorNeutralBackground1)" />
      <path d="m16.3 18 1.2 1.2 2.3-2.4" />
    </svg>
  );
}

type ImageSortDirection = "asc" | "desc";
type ImageSortState = {
  column: string;
  key: string;
  direction: ImageSortDirection;
};
type ImageTableColumnKind = "idx" | "thumbnail" | "name" | "aeGain" | "normalCwr" | "backCwr" | "cwr" | "delta" | "ev" | "extra";
type ImageTableColumn = {
  id: string;
  kind: ImageTableColumnKind;
  label: string;
  originalLabel?: string;
  key?: string;
  originalKey?: string;
  sourceOverride?: boolean;
  scope?: "all" | "face" | "normal";
  align: "left" | "center";
};
type ImageTableColumnDragState = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  timer: number | null;
  active: boolean;
  previousUserSelect: string;
  cleanup?: () => void;
};
interface Props {
  schema:    Isp6sSchemaRoot;
  toneMode?: boolean;
  filePath:  string | null;
  cppImportRevision: number;
  calculatorSourcePath: string | null;
  entries:   ImageEntry[];
  current:   number;
  selectedHeatmapPaths: string[];
  onVisibleHeatmapPathsChange?: (entries: ImageEntry[], paths: string[] | null) => void;
  imageDir:  string | null;
  onPickImage: (idx: number, options?: { preserveHeatmapSelection?: boolean }) => void;
  onImageDirChange: (dir: string) => void;
  selectionSyncEnabled: boolean;
  onSelectionSyncChange: (enabled: boolean) => void;
  imageSearchQuery: string;
  imageSearchError: string | null;
  onImageSearchQueryChange: (value: string) => void;
  onImageSearch: () => void;
  onParseExif: () => void;
  onNotice: (toast: { kind: "success" | "error"; title: string; detail?: string }) => void;
  exifParsing: boolean;
  imageDataRevision: number;
  scrollPosition?: ScrollPosition | null;
  onScrollPositionChange?: (position: ScrollPosition) => void;
}

const IMG_EXTS = ["jpg", "jpeg", "png"];
const IMAGE_OPTION_HEIGHT = 44;
const IMAGE_OPTION_LIST_HEIGHT = 320;
const IMAGE_OPTION_OVERSCAN = 6;
const IMAGE_DROPDOWN_THUMBNAIL_SIZE = 48;
const IMAGE_DROPDOWN_THUMBNAIL_BATCH = 3;
const IMAGE_DROPDOWN_THUMBNAIL_FALLBACK_CONCURRENCY = 2;
const IMAGE_DROPDOWN_THUMBNAIL_CACHE_LIMIT = 160;
const IMAGE_THUMBNAIL_IDLE_DELAY = 0;
const IMAGE_TABLE_HEADER_HEIGHT = 36;
// Keep the corner cell in sync with faceBvDrCornerCellStyle in ChartMapMode.
const IMAGE_TABLE_CORNER_BACKGROUND = "color-mix(in srgb, var(--colorBrandBackground2) 35%, var(--colorNeutralBackground2))";
const IMAGE_TABLE_SELECTED_BACKGROUND = "color-mix(in srgb, var(--colorBrandBackground2) 55%, var(--colorNeutralBackground1))";
const IMAGE_TABLE_SELECTED_COLUMN_STROKE = "color-mix(in srgb, var(--colorBrandStroke1) 60%, var(--colorNeutralStroke1))";
const IMAGE_TABLE_ROW_HEIGHT = 54;
const IMAGE_TABLE_THUMBNAIL_SIZE = 48;
const IMAGE_TABLE_THUMBNAIL_COLUMN_WIDTH = IMAGE_TABLE_THUMBNAIL_SIZE + 6;
const IMAGE_TABLE_HOVER_PREVIEW_DELAY_MS = 220;
const IMAGE_TABLE_OVERSCAN = 12;
const IMAGE_TABLE_LOAD_DEBOUNCE_MS = 8;
const IMAGE_TABLE_FIELD_CACHE_LIMIT = 768;
const IMAGE_TABLE_PREFETCH_DELAY_MS = 90;
const IMAGE_TABLE_PREFETCH_MIN_ROWS = 96;
const IMAGE_TABLE_PREFETCH_PAGES = 3;
const IMAGE_TABLE_SORT_CONTROLS_STORAGE_KEY = "luxe:isp6s:image-table-sort-controls";
const IMAGE_TABLE_COLUMN_DRAG_DELAY_MS = 280;
const IMAGE_TABLE_COLUMN_DRAG_DISTANCE = 6;
const IMAGE_TABLE_GLOBAL_CACHE_LIMIT = 4096;

// TablePane is remounted when switching AE Basic/ToneMap. Keep parsed fields
// outside the component so switching tabs can reuse the data immediately.
const globalImageTableFieldCache = new WeakMap<ImageEntry[], {
  revision: number;
  rows: Map<string, Record<string, string>>;
}>();
const faceCalculatorCache = new Map<string, Promise<FaceLinkTargetCalculator>>();
const globalImageKinds = new WeakMap<ImageEntry[], {
  keySignature: string;
  revision: number;
  calculator: FaceLinkTargetCalculator;
  byPath: Record<string, ImageTableKind>;
  widths: Record<string, number>;
}>();
const globalToneImageWidths = new WeakMap<ImageEntry[], {
  keySignature: string;
  revision: number;
  widths: Record<string, number>;
}>();
const imageTableThumbnailCache = new WeakMap<ImageEntry, string>();

function getFaceCalculator(filePath: string | null, revision: string): Promise<FaceLinkTargetCalculator> {
  const key = `${revision}\u0000${filePath ?? ""}`;
  const cached = faceCalculatorCache.get(key);
  if (cached) return cached;
  const pending = import("../ImagePane/ChartMapMode")
    .then(({ loadFaceLinkTargetCalculator }) => loadFaceLinkTargetCalculator(filePath));
  faceCalculatorCache.set(key, pending);
  pending.catch(() => { if (faceCalculatorCache.get(key) === pending) faceCalculatorCache.delete(key); });
  while (faceCalculatorCache.size > 4) {
    const oldest = faceCalculatorCache.keys().next().value;
    if (oldest) faceCalculatorCache.delete(oldest);
  }
  return pending;
}

function globalImageTableCacheKey(path: string, keySignature: string): string {
  return `${keySignature}\u0000${path}`;
}

function readGlobalImageTableFields(entries: ImageEntry[], revision: number, path: string, keySignature: string): Record<string, string> | undefined {
  const key = globalImageTableCacheKey(path, keySignature);
  const saved = globalImageTableFieldCache.get(entries);
  if (saved?.revision !== revision) return undefined;
  const cache = saved.rows;
  const value = cache?.get(key);
  if (!value) return undefined;
  cache?.delete(key);
  cache?.set(key, value);
  return value;
}

function rememberGlobalImageTableFields(
  entries: ImageEntry[],
  revision: number,
  rows: Record<string, Record<string, string>>,
  keySignature: string,
) {
  let saved = globalImageTableFieldCache.get(entries);
  if (saved?.revision !== revision) {
    saved = { revision, rows: new Map() };
    globalImageTableFieldCache.set(entries, saved);
  }
  const cache = saved.rows;
  for (const [path, data] of Object.entries(rows)) {
    const key = globalImageTableCacheKey(path, keySignature);
    cache.delete(key);
    cache.set(key, data);
  }
  while (cache.size > IMAGE_TABLE_GLOBAL_CACHE_LIMIT) {
    const stale = cache.keys().next().value;
    if (stale) cache.delete(stale);
  }
}
const FACE_LINK_TARGET_IMAGE_KEYS = [
  "AE_TAG_FACE_20_CWV", "AE_TAG_CWV", "AE_TAG_FLT_FDY", "AE_TAG_FLT_DR",
  "AE_TAG_NS_PROB", "AE_TAG_FACE_20_NORMAL_TARGET", "AE_TAG_FLT_OE_SYS",
  "AE_TAG_FLT_FDDR", "AE_TAG_FLT_FDSZ", "AE_TAG_FLT_TARGET",
  "AE_TAG_FLT_FDSZ_RA", "AE_TAG_FBT_FDY", "AE_TAG_FBT_DR",
  "AE_TAG_FACE_PROB", "AE_TAG_PROB_FACE", "AE_TAG_FBT_OE_SYS",
  "AE_TAG_FBT_FDDR", "AE_TAG_FBT_TARGET",
  "AE_TAG_MTV6_MAINT_TARGET", "AE_TAG_HSV6_MAINT_WET",
  "AE_TAG_HSV6_BT_TARGET", "AE_TAG_HSV6_MT_TARGET", "AE_TAG_HSV6_DT_TARGET",
  "AE_TAG_HSV6_BT_WET", "AE_TAG_HSV6_MT_WET", "AE_TAG_HSV6_DT_WET",
  "AE_TAG_NS_FINAL_TARGET", "AE_TAG_MTV6_MAINT_Y",
  "AE_TAG_MTV6_MAINT_MID_INTRATIO", "AE_TAG_DRV6_CORR_MIDRATIO",
  "AE_TAG_HSV6_BT_Final_Y", "AE_TAG_HSV6_MT_Final_Y", "AE_TAG_HSV6_DT_Final_Y",
  "AE_TAG_DRV6_B2D", "AE_TAG_DRV6_B2M", "AE_TAG_DRV6_CORR_B2M", "AE_TAG_DRV6_MIDRATIO", "AE_TAG_HS_EVD",
  "AE_TAG_NS_STS_CDF", "AE_TAG_NS_EVD",
  "NS_OE_THD", "AE_TAG_NS_NORMAL_FINAL_THD", "NS_Y", "AE_TAG_NS_NORMAL_Y",
  "NS_BrightTone_THD", "AE_TAG_NS_BT_FINAL_THD", "NS_BrightTone_Y", "AE_TAG_NS_BT_Y",
  "NS_LOWBND_THD", "AE_TAG_NS_DT_THD", "NS_LOWBND_Y", "AE_TAG_NS_DT_Y",
] as const;
type FaceTargetPair = { exif: number; calculated: number };
type FaceLinkTargetCalculator = (
  tomlData: Record<string, string>, bvKey: string, useParameterFdszRaForExif?: boolean,
) => { normal: FaceTargetPair; backScene: FaceTargetPair; faceLink: FaceTargetPair };

function roundedFaceTarget(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? Math.round(value) : null;
}

function formatFaceTargetPair(first: number | string | null, second: number | string | null): string {
  return first === null && second === null ? "-" : `${first ?? "-"}(${second ?? "-"})`;
}

function faceTargetRatio(numerator: number | null, denominator: number | null): string | null {
  return numerator !== null && denominator !== null && denominator !== 0
    ? (numerator / denominator).toFixed(2) : null;
}

function formatFaceTargetDelta(value: number | null): string {
  return value === null ? "-" : `${value >= 0 ? "+" : ""}${value}`;
}

function faceTargetDeltaStyle(value: number | null, threshold: number): React.CSSProperties | undefined {
  return metricDirectionStyle(value, threshold);
}

function metricDirectionStyle(value: number | null, threshold: number): React.CSSProperties | undefined {
  const direction = metricDirection(value, threshold);
  return direction === "positive" ? { color: "var(--colorPaletteRedForeground1)" }
    : direction === "negative" ? { color: "var(--colorPaletteBlueForeground2)" } : undefined;
}

function imageFaceTargetValues(target: ReturnType<FaceLinkTargetCalculator> | null) {
  const normalExif = roundedFaceTarget(target?.normal.exif);
  const normalCalculated = roundedFaceTarget(target?.normal.calculated);
  const backExif = roundedFaceTarget(target?.backScene.exif);
  const backCalculated = roundedFaceTarget(target?.backScene.calculated);
  const linkExif = roundedFaceTarget(target?.faceLink.exif);
  const linkCalculated = roundedFaceTarget(target?.faceLink.calculated);
  const backDelta = backExif !== null && backCalculated !== null ? backCalculated - backExif : null;
  const linkDelta = linkExif !== null && linkCalculated !== null ? linkCalculated - linkExif : null;
  const normalDelta = normalExif !== null && normalCalculated !== null ? normalCalculated - normalExif : null;
  const evPair = deltaEv(linkExif, linkCalculated);
  const normalEv = deltaEv(normalExif, normalCalculated);
  const backEv = deltaEv(backExif, backCalculated);
  return {
    aeGain: formatFaceTargetPair(faceTargetRatio(linkExif, backExif), faceTargetRatio(linkCalculated, backCalculated)),
    normalCwr: formatFaceTargetPair(normalExif, normalCalculated),
    backCwr: formatFaceTargetPair(backExif, backCalculated),
    cwr: formatFaceTargetPair(linkExif, linkCalculated),
    delta: `${formatFaceTargetDelta(normalDelta)}|${formatFaceTargetDelta(backDelta)}|${formatFaceTargetDelta(linkDelta)}`,
    normalDelta,
    backDelta,
    linkDelta,
    ev: formatDeltaEv(evPair),
    evPair,
    normalEv,
    backEv,
  };
}

export function TablePane({
  schema,
  toneMode = false,
  filePath,
  cppImportRevision,
  calculatorSourcePath,
  entries,
  current,
  selectedHeatmapPaths,
  onVisibleHeatmapPathsChange,
  imageDir,
  onPickImage,
  onImageDirChange,
  selectionSyncEnabled,
  onSelectionSyncChange,
  imageSearchQuery,
  imageSearchError,
  onImageSearchQueryChange,
  onImageSearch,
  onParseExif,
  onNotice,
  exifParsing,
  imageDataRevision,
  scrollPosition,
  onScrollPositionChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastDropStateRef = useRef<"ok" | "bad" | null>(null);
  const [dropState, setDropState] = useState<"ok" | "bad" | null>(null);
  const [parseAllVersion, setParseAllVersion] = useState(0);
  const [applyAllVersion, setApplyAllVersion] = useState(0);
  const nextApplyVersionRef = useRef(0);
  const [appliedCalculatorSourcePath, setAppliedCalculatorSourcePath] = useState<string | null>(null);
  const [parseProgress, setParseProgress] = useState<{ done: number; total: number; error?: string } | null>(null);
  const [applyPending, setApplyPending] = useState(false);

  // 热力图命中选择只记录 TOML 路径。标题栏按钮通过同一顺序切换当前图片，
  // 不会改变热力图的多选集合。
  const selectedImageIndexes = useMemo(
    () => selectedHeatmapPaths
      .map((path) => entries.findIndex((entry) => entry.toml_path === path))
      .filter((index): index is number => index >= 0),
    [entries, selectedHeatmapPaths],
  );
  const selectedCurrentPosition = selectedImageIndexes.indexOf(current);
  const canNavigateSelectedImages = selectedImageIndexes.length > 1;
  const pickRelativeSelectedImage = (delta: -1 | 1) => {
    if (!canNavigateSelectedImages) return;
    const position = selectedCurrentPosition >= 0
      ? selectedCurrentPosition
      : delta > 0 ? -1 : 0;
    const nextPosition = (position + delta + selectedImageIndexes.length) % selectedImageIndexes.length;
    const nextIndex = selectedImageIndexes[nextPosition];
    if (nextIndex !== undefined) {
      onPickImage(nextIndex, { preserveHeatmapSelection: true });
    }
  };

  useEffect(() => {
    setAppliedCalculatorSourcePath(null);
    setApplyAllVersion(0);
    setParseAllVersion(0);
    setParseProgress(null);
    setApplyPending(false);
  }, [filePath, entries]);

  const pickImageDir = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") onImageDirChange(picked);
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          const nextState = classifyImageDrop(payload.paths);
          lastDropStateRef.current = nextState;
          setDropState(hitTest(payload.position) ? nextState : null);
          return;
        }
        if (payload.type === "over") {
          setDropState(hitTest(payload.position) ? lastDropStateRef.current : null);
          return;
        }
        if (payload.type === "leave") {
          setDropState(null);
          return;
        }
        if (payload.type === "drop") {
          const inside = hitTest(payload.position);
          setDropState(null);
          lastDropStateRef.current = null;
          if (!inside || payload.paths.length === 0) return;
          if (classifyImageDrop(payload.paths) !== "ok") return;
          const first = payload.paths[0];
          ensureDirectory(first)
            .then(onImageDirChange)
            .catch((err) => console.warn("ensureDirectory failed", err));
        }
      });
    })();
    return () => {
      lastDropStateRef.current = null;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onImageDirChange]);

  function hitTest(p: { x: number; y: number }): boolean {
    const el = rootRef.current;
    if (!el) return false;
    const dpr = window.devicePixelRatio || 1;
    const x = p.x / dpr;
    const y = p.y / dpr;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  const borderColor =
    dropState === "ok" ? "var(--colorPaletteGreenBorder2)" :
    dropState === "bad" ? "var(--colorPaletteRedBorder2)" :
                          "var(--colorNeutralStroke2)";
  const background =
    dropState === "ok" ? "var(--colorPaletteGreenBackground1)" :
    dropState === "bad" ? "var(--colorPaletteRedBackground1)" :
                          "var(--colorNeutralBackground2)";

  return (
    <div ref={rootRef}
         className="relative flex h-full w-full min-w-0 flex-col transition-colors"
         style={{
           background,
           border: `1px solid ${borderColor}`,
           borderRadius: "12px 12px 0 0",
           overflow: "hidden",
         }}>
      <div className="flex h-8 shrink-0 items-center justify-between gap-3 px-4"
           style={{
             background: "var(--colorNeutralBackground2)",
             borderBottom: "1px solid var(--colorNeutralStroke2)",
           }}>
        <div className="flex min-w-0 items-center gap-2 text-xs" style={{ color: "var(--colorNeutralForeground2)" }}>
          <ImageMultiple24Regular className="h-4 w-4 shrink-0" aria-hidden="true" style={{ color: "var(--colorBrandForeground1)" }} />
          <span className="truncate">图片列表卡片</span>
          {selectedHeatmapPaths.length > 0 && (
            <div className="flex items-center gap-1" style={{ color: "var(--colorPaletteGreenForeground1)" }}>
              <span style={{ whiteSpace: "nowrap" }}>
                已选中 {selectedHeatmapPaths.length}
                {selectedCurrentPosition >= 0 ? `(:${selectedCurrentPosition + 1})` : ""} 张
              </span>
              <Button
                size="small"
                appearance="subtle"
                icon={<ArrowLeft24Regular className="h-3.5 w-3.5" />}
                disabled={!canNavigateSelectedImages}
                onClick={() => pickRelativeSelectedImage(-1)}
                aria-label="上一个已选图片"
                title="上一个已选图片"
                style={{ width: 22, minWidth: 22, height: 22, padding: 0 }}
              />
              <Button
                size="small"
                appearance="subtle"
                icon={<ArrowRight24Regular className="h-3.5 w-3.5" />}
                disabled={!canNavigateSelectedImages}
                onClick={() => pickRelativeSelectedImage(1)}
                aria-label="下一个已选图片"
                title="下一个已选图片"
                style={{ width: 22, minWidth: 22, height: 22, padding: 0 }}
              />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="small" appearance="subtle"
            style={{ width: 28, minWidth: 28, height: 28, padding: 0, color: selectionSyncEnabled ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground3)" }}
            icon={selectionSyncEnabled ? <LinkMultiple24Regular className="h-4 w-4" /> : <LinkDismiss24Regular className="h-4 w-4" />}
            title={selectionSyncEnabled ? "已开启 AE Basic / ToneMap 图片选择同步" : "已关闭图片选择同步"}
            aria-label={selectionSyncEnabled ? "关闭 AE Basic 与 ToneMap 图片选择同步" : "开启 AE Basic 与 ToneMap 图片选择同步"}
            aria-pressed={selectionSyncEnabled}
            onClick={() => onSelectionSyncChange(!selectionSyncEnabled)} />
          <Button size="small" appearance="subtle" style={{ width: 28, minWidth: 28, height: 28, padding: 0 }} icon={<DocumentData24Regular className="h-4 w-4" />}
            title={exifParsing ? "正在解析图片 EXIF" : "解析图片 EXIF"}
            disabled={entries.length === 0 || exifParsing}
            onClick={onParseExif} aria-label="解析图片 EXIF" />
          {!toneMode && <Button size="small" appearance="subtle" style={{ width: 28, minWidth: 28, height: 28, padding: 0 }} icon={<CalculatorArrowClockwise24Regular className="h-4 w-4" />}
            title="Apply all image: 使用当前参数重新计算 CWR 和 ∆CWR"
            disabled={entries.length === 0 || !calculatorSourcePath || applyPending || Boolean(parseProgress && parseProgress.done < parseProgress.total)}
            onClick={() => {
              setApplyPending(true);
              setAppliedCalculatorSourcePath(calculatorSourcePath);
              const nextVersion = ++nextApplyVersionRef.current;
              setApplyAllVersion(nextVersion);
              setParseAllVersion(nextVersion);
            }} aria-label="Apply all image" />}
          <Button size="small" appearance="subtle" style={{ width: 28, minWidth: 28, height: 28, padding: 0 }} icon={<FolderAdd24Regular className="h-4 w-4" />}
            title="Add image folder" onClick={pickImageDir} aria-label="Add image folder" />
        </div>
      </div>
      <div className="hidden"
           style={{
             background: "var(--colorNeutralBackground1)",
             borderBottom: "1px solid var(--colorNeutralStroke2)",
           }}>
        <HoverTooltip content="添加图片文件夹" positioning="below-center" inline>
          <Button
            size="small"
            appearance="subtle"
            icon={<FolderAdd24Regular />}
            onClick={pickImageDir}
            aria-label="添加图片文件夹"
          />
        </HoverTooltip>
        <span className="min-w-0 flex-1 truncate text-[11px]"
              style={{ color: "var(--colorNeutralForeground3)" }}>
          {imageDir ?? "点击文件夹图标添加图片文件夹"}
        </span>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-2 px-4"
           style={{
             background: "var(--colorNeutralBackground1)",
             borderBottom: "1px solid var(--colorNeutralStroke2)",
           }}>
        <Search24Regular className="h-4 w-4 shrink-0"
                         style={{ color: "var(--colorNeutralForeground3)" }} />
        <input
          type="search"
          value={imageSearchQuery}
          onChange={(event) => onImageSearchQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onImageSearch();
          }}
          placeholder="搜索图片名称"
          aria-label="搜索图片名称"
          maxLength={200}
          aria-invalid={Boolean(imageSearchError)}
          className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
          style={{
            color: "var(--colorNeutralForeground2)",
            caretColor: "var(--colorBrandForeground1)",
          }}
        />
        {imageSearchError && (
          <span className="shrink-0 text-[10px]" style={{ color: "var(--colorPaletteRedForeground1)" }}>
            {imageSearchError}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <ImageTab key={imageDir ?? ""} schema={schema} toneMode={toneMode} filePath={toneMode ? null : filePath} directoryName={getPathBaseName(imageDir ?? "")} calculatorSourcePath={appliedCalculatorSourcePath}
          parseAllVersion={parseAllVersion} applyAllVersion={applyAllVersion} onParseProgress={setParseProgress}
          onApplyResult={(result) => {
            setApplyPending(false);
            onNotice(result);
          }}
          imageDataRevision={imageDataRevision}
          cppImportRevision={cppImportRevision}
          scrollPosition={scrollPosition}
          onScrollPositionChange={onScrollPositionChange}
          entries={entries} current={current} selectedHeatmapPaths={selectedHeatmapPaths} onPick={onPickImage}
          onVisibleHeatmapPathsChange={onVisibleHeatmapPathsChange} />
      </div>
    </div>
  );
}

export function ImagePickerDropdown({
  entries, current, onPick,
}: {
  entries: ImageEntry[];
  current: number;
  onPick: (idx: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const loadingThumbPathsRef = useRef<Set<string>>(new Set());
  const loadingFullThumbPathsRef = useRef<Set<string>>(new Set());
  const failedFullThumbPathsRef = useRef<Set<string>>(new Set());
  const entryPathSetRef = useRef<Set<string>>(new Set());
  const thumbUrlsRef = useRef<Record<string, string>>({});
  const thumbAccessOrderRef = useRef<string[]>([]);
  const [open, setOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const disabled = entries.length === 0;
  const selectedIndex = current >= 0 && current < entries.length ? current : 0;
  const currentEntry = entries[selectedIndex];
  const menuColors = useMemo(() => getPortalMenuColors(), [open]);
  const pickerButtonChrome = useMemo(() => getCurrentImagePickerButtonChrome(open), [open]);
  const selectedLabel = currentEntry ? `${selectedIndex + 1} | ${currentEntry.name}` : "未选择图片";
  const indexColumnWidth = Math.max(24, String(entries.length).length * 8 + 10);

  useEffect(() => {
    const nextPaths = new Set(entries.map((entry) => entry.jpg_path));
    entryPathSetRef.current = nextPaths;
    loadingThumbPathsRef.current.clear();
    loadingFullThumbPathsRef.current.clear();
    failedFullThumbPathsRef.current.clear();
    thumbAccessOrderRef.current = thumbAccessOrderRef.current.filter((path) => nextPaths.has(path));
    setThumbUrls((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [path, url] of Object.entries(prev)) {
        if (nextPaths.has(path)) {
          next[path] = url;
        } else {
          changed = true;
        }
      }
      const result = changed ? next : prev;
      thumbUrlsRef.current = result;
      return result;
    });
  }, [entries]);

  const updateThumbUrls = (updates: Record<string, string>) => {
    setThumbUrls((prev) => {
      let changed = false;
      const next = { ...prev };
      const order = thumbAccessOrderRef.current;
      for (const [path, url] of Object.entries(updates)) {
        if (!entryPathSetRef.current.has(path)) continue;
        const existingOrderIndex = order.indexOf(path);
        if (existingOrderIndex >= 0) {
          order.splice(existingOrderIndex, 1);
        }
        order.push(path);
        if (next[path] === url) continue;
        next[path] = url;
        changed = true;
      }
      while (order.length > IMAGE_DROPDOWN_THUMBNAIL_CACHE_LIMIT) {
        const stalePath = order.shift();
        if (!stalePath || !(stalePath in next)) continue;
        delete next[stalePath];
        changed = true;
      }
      const result = changed ? next : prev;
      thumbUrlsRef.current = result;
      return result;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const root = rootRef.current;
      const list = listRef.current;
      if (root?.contains(target) || list?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const updateMenuRect = () => {
      const button = buttonRef.current;
      if (!button) return;
      const r = button.getBoundingClientRect();
      const width = Math.min(420, Math.max(280, window.innerWidth * 0.34));
      const left = Math.min(
        Math.max(8, r.right - width),
        Math.max(8, window.innerWidth - width - 8),
      );
      setMenuRect({ left, top: r.bottom + 4, width });
    };

    updateMenuRect();
    window.addEventListener("resize", updateMenuRect);
    window.addEventListener("scroll", updateMenuRect, true);
    return () => {
      window.removeEventListener("resize", updateMenuRect);
      window.removeEventListener("scroll", updateMenuRect, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const nextScrollTop = Math.max(0, selectedIndex * IMAGE_OPTION_HEIGHT - IMAGE_OPTION_HEIGHT * 2);
    listRef.current.scrollTop = nextScrollTop;
    setScrollTop(nextScrollTop);
  }, [selectedIndex, open]);

  const visible = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / IMAGE_OPTION_HEIGHT) - IMAGE_OPTION_OVERSCAN);
    const count = Math.ceil(IMAGE_OPTION_LIST_HEIGHT / IMAGE_OPTION_HEIGHT) + IMAGE_OPTION_OVERSCAN * 2;
    const end = Math.min(entries.length, start + count);
    return { start, end, rows: entries.slice(start, end) };
  }, [entries, scrollTop]);

  const thumbnailRows = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / IMAGE_OPTION_HEIGHT));
    const count = Math.ceil(IMAGE_OPTION_LIST_HEIGHT / IMAGE_OPTION_HEIGHT) + 1;
    const end = Math.min(entries.length, start + count);
    return entries.slice(start, end);
  }, [entries, scrollTop]);

  useEffect(() => {
    if (!open || thumbnailRows.length === 0) return;

    const cachedThumbUrls = thumbUrlsRef.current;
    const missing = thumbnailRows
      .map((entry) => entry.jpg_path)
      .filter((path) => !(path in cachedThumbUrls) && !loadingThumbPathsRef.current.has(path));
    if (missing.length === 0) return;

    const timer = window.setTimeout(() => {
      for (let start = 0; start < missing.length; start += IMAGE_DROPDOWN_THUMBNAIL_BATCH) {
        const chunk = missing.slice(start, start + IMAGE_DROPDOWN_THUMBNAIL_BATCH);
        chunk.forEach((path) => loadingThumbPathsRef.current.add(path));
        loadImageThumbnailBatch(chunk, IMAGE_DROPDOWN_THUMBNAIL_SIZE, true)
          .then((batch) => {
            const updates: Record<string, string> = {};
            for (const path of chunk) {
              updates[path] = batch[path] || "";
            }
            updateThumbUrls(updates);
          })
          .catch(() => {
            const updates: Record<string, string> = {};
            for (const path of chunk) {
              updates[path] = "";
            }
            updateThumbUrls(updates);
          })
          .finally(() => {
            chunk.forEach((path) => loadingThumbPathsRef.current.delete(path));
          });
      }
    }, IMAGE_THUMBNAIL_IDLE_DELAY);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open, thumbnailRows]);

  useEffect(() => {
    if (!open || thumbnailRows.length === 0) return;

    const cachedThumbUrls = thumbUrlsRef.current;
    const fallbackPaths = thumbnailRows
      .map((entry) => entry.jpg_path)
      .filter((path) =>
        cachedThumbUrls[path] === "" &&
        !loadingFullThumbPathsRef.current.has(path) &&
        !failedFullThumbPathsRef.current.has(path),
      );
    if (fallbackPaths.length === 0) return;

    const timer = window.setTimeout(() => {
      fallbackPaths.forEach((path) => loadingFullThumbPathsRef.current.add(path));

      const workers = Array.from({
        length: Math.min(IMAGE_DROPDOWN_THUMBNAIL_FALLBACK_CONCURRENCY, fallbackPaths.length),
      }, async (_, workerIndex) => {
        for (let index = workerIndex; index < fallbackPaths.length; index += IMAGE_DROPDOWN_THUMBNAIL_FALLBACK_CONCURRENCY) {
          const path = fallbackPaths[index];
          try {
            const batch = await loadImageThumbnailBatch([path], IMAGE_DROPDOWN_THUMBNAIL_SIZE, false);
            const url = batch[path];
            updateThumbUrls({ [path]: url || "" });
            if (!url) failedFullThumbPathsRef.current.add(path);
          } catch {
            failedFullThumbPathsRef.current.add(path);
          } finally {
            loadingFullThumbPathsRef.current.delete(path);
          }
        }
      });

      void Promise.all(workers);
    }, IMAGE_THUMBNAIL_IDLE_DELAY);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open, thumbUrls, thumbnailRows]);

  return (
    <div ref={rootRef} className="relative h-full min-w-0 flex-1">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        className="flex h-full w-full items-center gap-2 rounded-[inherit] border px-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background: pickerButtonChrome.background,
          borderColor: pickerButtonChrome.borderColor,
          color: "var(--colorNeutralForeground1)",
        }}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        onMouseEnter={(event) => {
          if (!open) {
            event.currentTarget.style.background = pickerButtonChrome.hoverBackground;
            event.currentTarget.style.borderColor = pickerButtonChrome.hoverBorderColor;
          }
        }}
        onMouseLeave={(event) => {
          if (!open) {
            event.currentTarget.style.background = pickerButtonChrome.background;
            event.currentTarget.style.borderColor = pickerButtonChrome.borderColor;
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <ChevronDown24Regular
          className="h-4 w-4 shrink-0 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && menuRect && createPortal(
        <div
          className="overflow-hidden rounded-md border shadow-lg"
          style={{
            position: "fixed",
            zIndex: 1000,
            left: menuRect.left,
            top: menuRect.top,
            width: menuRect.width,
            maxHeight: Math.max(120, window.innerHeight - menuRect.top - 8),
            background: menuColors.surface,
            borderColor: menuColors.border,
            boxShadow: menuColors.shadow,
          }}
        >
          <div
            ref={listRef}
            role="listbox"
            className="overflow-auto"
            style={{ height: Math.min(IMAGE_OPTION_LIST_HEIGHT, entries.length * IMAGE_OPTION_HEIGHT) }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            <div style={{ height: entries.length * IMAGE_OPTION_HEIGHT, position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: visible.start * IMAGE_OPTION_HEIGHT,
                }}
              >
                {visible.rows.map((entry, offset) => {
                  const idx = visible.start + offset;
                  const active = idx === selectedIndex;
                  const hovered = idx === hoveredIndex;
                  return (
                    <button
                      key={entry.jpg_path}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className="grid w-full items-center gap-2 py-0 pl-1 pr-2 text-left text-xs"
                      title={`${idx + 1} | ${entry.name}`}
                      style={{
                        gridTemplateColumns: `${indexColumnWidth}px 24px minmax(0, 1fr)`,
                        height: IMAGE_OPTION_HEIGHT,
                        background: active
                          ? menuColors.selected
                          : hovered
                            ? menuColors.hover
                            : menuColors.surface,
                        color: menuColors.text,
                        transition: "background 120ms ease",
                      }}
                      onMouseEnter={() => setHoveredIndex(idx)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      onClick={() => {
                        onPick(idx);
                        setOpen(false);
                      }}
                    >
                      <span
                        className="text-right font-medium tabular-nums"
                        style={{ color: menuColors.subtleText }}
                      >
                        {idx + 1}
                      </span>
                      <Thumb url={thumbUrls[entry.jpg_path] ?? null} alt={entry.name} />
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function getPortalMenuColors() {
  const isLight = document.documentElement.classList.contains("light");
  return isLight
    ? {
        surface: "#FFFFFF",
        border: "#D1D1D1",
        text: "#242424",
        hover: "#F3F0FA",
        selected: "#E7E3F2",
        thumb: "#F0EEF8",
        subtleText: "#616161",
        shadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
      }
    : {
        surface: "#292929",
        border: "#525252",
        text: "#F5F5F5",
        hover: "#3A3446",
        selected: "#3B1A55",
        thumb: "#3A3A3A",
        subtleText: "#D6D6D6",
        shadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
      };
}

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded"
      style={{
        background: "var(--colorNeutralBackground3, var(--luxe-bg, #F0EEF8))",
        color: "var(--colorNeutralForeground3, var(--luxe-fg, #616161))",
      }}
    >
      {url ? (
        <img src={url} alt={alt} className="h-full w-full object-cover" draggable={false} loading="lazy" />
      ) : (
        <Image24Regular className="h-4 w-4" />
      )}
    </span>
  );
}

function ImageTableThumbnail({ entry, columnWidth }: { entry: ImageEntry; columnWidth: number }) {
  const [url, setUrl] = useState<string | null>(() => imageTableThumbnailCache.get(entry) ?? null);
  const thumbnailSize = Math.max(1, Math.min(IMAGE_TABLE_THUMBNAIL_SIZE, columnWidth - 6));

  useEffect(() => {
    const cached = imageTableThumbnailCache.get(entry);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    loadImageThumbnailBatch([entry.jpg_path], 52)
      .then((batch) => {
        if (!cancelled) {
          const next = batch[entry.jpg_path] || null;
          if (next) imageTableThumbnailCache.set(entry, next);
          setUrl(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUrl(null);
        }
      });
    return () => { cancelled = true; };
  }, [entry]);

  return (
    <span data-image-thumbnail-path={entry.jpg_path} data-image-thumbnail-name={entry.name} style={{
      display: "inline-flex",
      width: thumbnailSize,
      height: thumbnailSize,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      background: "var(--colorNeutralBackground3)",
      border: "1px solid var(--colorNeutralStroke2)",
    }}>
      {url ? <img src={url} alt={entry.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} draggable={false} /> : <Image24Regular />}
    </span>
  );
}

function ImageTableHoverPreview({ scrollRef }: { scrollRef: RefObject<HTMLDivElement> }) {
  const [hovered, setHovered] = useState<{ path: string; name: string; rect: DOMRect } | null>(null);
  const [preview, setPreview] = useState<{ path: string; url: string | null } | null>(null);
  const activeAnchorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const close = () => {
      activeAnchorRef.current = null;
      setHovered(null);
      setPreview(null);
    };
    const onPointerOver = (event: PointerEvent) => {
      const anchor = event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-image-thumbnail-path]") : null;
      if (!anchor || anchor === activeAnchorRef.current) return;
      activeAnchorRef.current = anchor;
      setPreview(null);
      setHovered({
        path: anchor.dataset.imageThumbnailPath ?? "",
        name: anchor.dataset.imageThumbnailName ?? "",
        rect: anchor.getBoundingClientRect(),
      });
    };
    const onPointerOut = (event: PointerEvent) => {
      const anchor = activeAnchorRef.current;
      if (!anchor) return;
      if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return;
      close();
    };
    viewport.addEventListener("pointerover", onPointerOver);
    viewport.addEventListener("pointerout", onPointerOut);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      viewport.removeEventListener("pointerover", onPointerOver);
      viewport.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [scrollRef]);

  useEffect(() => {
    if (!hovered?.path) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadImageHoverPreview(hovered.path)
        .then((url) => {
          if (!cancelled && url) setPreview({ path: hovered.path, url });
        })
        .catch(() => {});
    }, IMAGE_TABLE_HOVER_PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hovered]);

  if (!hovered || !preview?.url || preview.path !== hovered.path) return null;
  const size = Math.max(20, Math.min(208, window.innerWidth - 16, window.innerHeight - 16));
  const showOnRight = hovered.rect.right + size + 8 <= window.innerWidth;
  const showOnLeft = !showOnRight && hovered.rect.left - size - 8 >= 8;
  const left = showOnRight ? hovered.rect.right + 8 : showOnLeft ? undefined : 8;
  const right = showOnLeft ? window.innerWidth - hovered.rect.left + 8 : undefined;
  const centerY = hovered.rect.top + hovered.rect.height / 2;
  const top = Math.max(8 + size / 2, Math.min(centerY, window.innerHeight - 8 - size / 2));
  return createPortal(
    <div className="fixed z-[9999] rounded-md border p-2 shadow-lg"
      role="img" aria-label={`放大预览：${hovered.name}`}
      style={{ left, right, top, transform: "translateY(-50%)", width: "max-content", height: "max-content",
        maxWidth: size, maxHeight: size, boxSizing: "border-box", pointerEvents: "none",
        background: "var(--normal-sheet-bg)", borderColor: "var(--normal-sheet-grid)" }}>
      <img src={preview.url} alt="" className="block object-contain"
        style={{ width: "auto", height: "auto", maxWidth: size - 18, maxHeight: size - 18 }} draggable={false} />
    </div>,
    document.body,
  );
}

export function ImageTab({
  schema, toneMode = false, filePath, directoryName, cppImportRevision, calculatorSourcePath, parseAllVersion = 0, applyAllVersion = 0, onParseProgress, onApplyResult,
  entries, current, selectedHeatmapPaths, onPick, onVisibleHeatmapPathsChange,
  imageDataRevision = 0,
  scrollPosition,
  onScrollPositionChange,
}: {
  schema:   Isp6sSchemaRoot;
  toneMode?: boolean;
  filePath: string | null;
  directoryName: string;
  cppImportRevision: number;
  calculatorSourcePath?: string | null;
  parseAllVersion?: number;
  applyAllVersion?: number;
  onParseProgress?: (progress: { done: number; total: number; error?: string } | null) => void;
  onApplyResult?: (result: { kind: "success" | "error"; title: string; detail?: string }) => void;
  imageDataRevision?: number;
  scrollPosition?: ScrollPosition | null;
  onScrollPositionChange?: (position: ScrollPosition) => void;
  entries:  ImageEntry[];
  current:  number;
  selectedHeatmapPaths: string[];
  onVisibleHeatmapPathsChange?: (entries: ImageEntry[], paths: string[] | null) => void;
  onPick:   (idx: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const restoreScrollRef = useRef(scrollPosition);
  const preserveRestoredScrollRef = useRef(Boolean(scrollPosition));
  const previousCurrentRef = useRef(current);
  const previousKindFilterRef = useRef<string | null>(null);
  const scrollPositionChangeRef = useRef(onScrollPositionChange);
  const tableWindowPathsRef = useRef<string[]>([]);
  const tableFieldCacheRef = useRef<Record<string, Record<string, string>>>({});
  const tableFieldAccessOrderRef = useRef<string[]>([]);
  const tableTomlPathSetRef = useRef<Set<string>>(new Set());
  const loadingTableFieldPathsRef = useRef<Set<string>>(new Set());
  const tableFieldKeySignatureRef = useRef("");
  const scrollTopRef = useRef(scrollPosition?.top ?? 0);
  const scrollDirectionRef = useRef<1 | -1>(1);
  const lastViewportHeightRef = useRef(0);
  const tableViewportFrameRef = useRef<number | null>(null);
  const pendingViewportReloadRef = useRef(false);
  const sortRequestRef = useRef(0);
  const extraCols = useMemo(
    () => {
      if (!toneMode) return imageTableExtraColumns(schema);
      const items = schema.preview_info?.items ?? [];
      const key = (label: string, index: number, fallback: string) => {
        const item = items.find((candidate) => candidate.label === label);
        const directKey = item?.toml_key?.trim();
        return directKey || item?.toml_keys?.[index]?.trim() || fallback;
      };
      const keys = (label: string, fallback: string[]) => {
        const item = items.find((candidate) => candidate.label === label);
        return item?.toml_keys?.filter(Boolean) ?? fallback;
      };
      return [
        ["AEGain", key("AEGain", 0, "SW_LCE_AEGain")],
        ["LV", keys("LV", ["SW_LCE_LV", "SW_LCE_LVIdx_L", "SW_LCE_LVIdx_H"]).join("")],
        ["DR", keys("DR", ["SW_LCE_CurrDR", "SW_LCE_DRIdx_L", "SW_LCE_DRIdx_H"]).join("")],
        ["Target", key("Target", 0, "SW_LCE_FinalTarget")],
        ["D_S_Level", key("Level_D,B_Strenth", 0, "SW_LCE_DStrengthLevel")],
        ["B_S_Level", key("Level_D,B_Strenth", 1, "SW_LCE_BStrengthLevel")],
      ];
    },
    [schema, toneMode],
  );
  const faceBvKey = schema.Image?.BV ?? "AE_TAG_REALBVX1000";
  const faceFdyKey = schema.Image?.FDY ?? "AE_TAG_FLT_FDY";
  const columnMode: ColumnMode = toneMode ? "tone" : "isp6s";
  const selectedKindFilter = useIsp6sVisualStore((state) => toneMode
    ? state.visual.tone_image_table_kind_filter : state.visual.image_table_kind_filter);
  const useParameterFdszRaForExif = useIsp6sVisualStore((state) => state.visual.chart_face_flt_exif_use_parameter_fdsz_ra);
  const setKindFilter = (kind: "all" | "scene" | "portrait") => {
    const store = useIsp6sVisualStore.getState();
    store.patch(toneMode ? { tone_image_table_kind_filter: kind } : { image_table_kind_filter: kind });
    void saveStateSection("isp6s_ae_visual", useIsp6sVisualStore.getState().visual)
      .catch((error) => console.warn("save image table filter", error));
  };
  useEffect(() => () => {
    void saveStateSection("isp6s_ae_visual", useIsp6sVisualStore.getState().visual)
      .catch((error) => console.warn("save image table state on leave", error));
  }, []);
  const [modeSettings, setModeSettings] = useState<ImageTableModeColumns>(() => readLegacyColumnMode(columnMode));
  useEffect(() => {
    let active = true;
    let updates = 0;
    const unlisten: Array<() => void> = [];
    void listen<ColumnSettingsSaved>(COLUMN_SETTINGS_SAVED_EVENT, ({ payload }) => {
      if (active && payload.mode === columnMode) {
        updates += 1;
        setModeSettings(normalizeColumnMode(payload.settings));
      }
    }).then((stop) => { if (active) unlisten.push(stop); else stop(); })
      .catch((error) => console.warn("listen image table columns", error));
    void listen<ColumnSettingsSaved>(COLUMN_SETTINGS_PREVIEW_EVENT, ({ payload }) => {
      if (active && payload.mode === columnMode) {
        updates += 1;
        setModeSettings(normalizeColumnMode(payload.settings));
      }
    }).then((stop) => { if (active) unlisten.push(stop); else stop(); })
      .catch((error) => console.warn("listen image table columns preview", error));
    void listen<{ mode: ColumnMode }>(COLUMN_SETTINGS_CANCEL_EVENT, ({ payload }) => {
      if (!active || payload.mode !== columnMode) return;
      updates += 1;
      void loadState().then((state) => {
        if (active) setModeSettings(state.image_table_columns
          ? normalizeColumnMode(state.image_table_columns[columnMode]) : readLegacyColumnMode(columnMode));
      }).catch((error) => console.warn("restore image table columns", error));
    }).then((stop) => { if (active) unlisten.push(stop); else stop(); })
      .catch((error) => console.warn("listen image table columns cancel", error));
    void loadState().then((state) => {
      if (active && updates === 0) setModeSettings(state.image_table_columns
        ? normalizeColumnMode(state.image_table_columns[columnMode]) : readLegacyColumnMode(columnMode));
    }).catch((error) => console.warn("load image table columns", error));
    return () => { active = false; unlisten.forEach((stop) => stop()); };
  }, [columnMode]);
  const allCustomColumns = useMemo(() => collectImageTableCustomColumns(modeSettings), [modeSettings]);
  const tableColumns = useMemo<ImageTableColumn[]>(
    () => {
      return [
      { id: "idx", kind: "idx", label: "idx", align: "center" },
      { id: "thumbnail", kind: "thumbnail", label: "Thumbnail", align: "center" },
      { id: "name", kind: "name", label: "FileName", align: "left" },
      ...(!toneMode ? [
        { id: "aeGain", kind: "aeGain" as const, label: "AEGain(new)", align: "center" as const },
        { id: "normalCwr", kind: "normalCwr" as const, label: "CWR(Normal)", align: "center" as const },
        { id: "backCwr", kind: "backCwr" as const, label: "CWR(BackTar)", align: "center" as const },
        { id: "cwr", kind: "cwr" as const, label: "CWR(FLinkTar)", align: "center" as const },
        { id: "ev", kind: "ev" as const, label: "ΔEV", align: "center" as const },
        { id: "delta", kind: "delta" as const, label: "∆CWR", align: "center" as const },
      ] : []),
      ...extraCols.map(([label, key], index) => ({
        id: `extra:${key}`,
        kind: "extra" as const,
        label,
        key,
        align: toneMode || index < 2 ? "center" as const : "left" as const,
      })),
      ...allCustomColumns.filter((column) => column.source.trim()).map((column) => ({
        id: `custom:${column.id}`, kind: "extra" as const, label: column.label || "新列",
        key: column.source.trim(), scope: column.scope, align: "center" as const,
      })),
      ];
    },
    [allCustomColumns, extraCols, toneMode],
  );
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const columnDragRef = useRef<ImageTableColumnDragState | null>(null);
  const suppressColumnClickRef = useRef(false);
  const columnEditSourceKeys = (["all", "face", "normal"] as const).flatMap((scope) =>
    Object.values(modeSettings[scope].edits).flatMap((edit) => edit.source ? imageColumnSourceKeys(edit.source) : []));
  const columnEditSourceSignature = columnEditSourceKeys.join("\u001f");
  const imageTomlKeys = useMemo(
    () => toneMode ? [...new Set([...expandImageColumnKeys(extraCols), ...allCustomColumns.flatMap((column) => imageColumnSourceKeys(column.source)),
      ...columnEditSourceKeys])]
      : [...new Set([...expandImageColumnKeys(extraCols), ...allCustomColumns.flatMap((column) => imageColumnSourceKeys(column.source)),
        ...columnEditSourceKeys, faceBvKey, ...FACE_LINK_TARGET_IMAGE_KEYS])]
      .filter((key) => key.length > 0),
    [allCustomColumns, columnEditSourceSignature, extraCols, faceBvKey, toneMode],
  );
  const imageTomlKeySignature = useMemo(
    () => imageTomlKeys.join("\u001f"),
    [imageTomlKeys],
  );
  const [tomls, setTomls] = useState<Record<string, Record<string, string>>>({});
  const [parsedTomls, setParsedTomls] = useState<{
    entries: ImageEntry[];
    keySignature: string;
    version: number;
    rows: Record<string, Record<string, string>>;
  } | null>(null);
  const [faceLinkTargetState, setFaceLinkTargetState] = useState<{
    filePath: string | null;
    version: number;
    calculate: FaceLinkTargetCalculator;
  } | null>(null);
  const [calculatorError, setCalculatorError] = useState<{ version: number; message: string } | null>(null);
  const [parseAllError, setParseAllError] = useState<{ version: number; message: string } | null>(null);
  const requestedCalculatorPath = applyAllVersion > 0 ? calculatorSourcePath ?? null : filePath;
  const baseFaceLinkTargetCalculator = faceLinkTargetState && faceLinkTargetState.filePath === requestedCalculatorPath
    && faceLinkTargetState.version === applyAllVersion
    ? faceLinkTargetState.calculate
    : null;
  const faceLinkTargetCalculator = useMemo(() => baseFaceLinkTargetCalculator
    ? (data: Record<string, string>, bvKey: string) => baseFaceLinkTargetCalculator(data, bvKey, useParameterFdszRaForExif)
    : null, [baseFaceLinkTargetCalculator, useParameterFdszRaForExif]);
  const allParsedRows = parsedTomls?.entries === entries && parsedTomls.keySignature === imageTomlKeySignature
    && parsedTomls.version === parseAllVersion
    ? parsedTomls.rows : null;
  const allTargets = useMemo(() => {
    if (!allParsedRows || !faceLinkTargetCalculator) return null;
    return Object.fromEntries(entries.map((entry) => [
      entry.toml_path,
      faceLinkTargetCalculator(allParsedRows[entry.toml_path] ?? {}, faceBvKey),
    ]));
  }, [allParsedRows, entries, faceBvKey, faceLinkTargetCalculator]);
  const applyResultRef = useRef(onApplyResult);
  applyResultRef.current = onApplyResult;
  const reportedApplyVersionRef = useRef(0);
  useEffect(() => {
    if (applyAllVersion === 0) {
      reportedApplyVersionRef.current = 0;
      return;
    }
    if (reportedApplyVersionRef.current === applyAllVersion) return;
    const failure = calculatorError?.version === applyAllVersion ? calculatorError.message :
      parseAllError?.version === parseAllVersion ? parseAllError.message : null;
    if (failure) {
      reportedApplyVersionRef.current = applyAllVersion;
      applyResultRef.current?.({ kind: "error", title: "批量图片计算失败", detail: failure });
    } else if (allTargets && parsedTomls?.version === parseAllVersion && parseAllVersion > 0) {
      reportedApplyVersionRef.current = applyAllVersion;
      applyResultRef.current?.({ kind: "success", title: "批量图片计算完成", detail: "已计算并刷新 " + entries.length + " 张图片" });
    }
  }, [allTargets, applyAllVersion, calculatorError, entries.length, parseAllError, parseAllVersion, parsedTomls?.version]);
  const [scrollTop, setScrollTop] = useState(() => scrollPosition?.top ?? 0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [tableReloadVersion, setTableReloadVersion] = useState(0);
  const [sortState, setSortState] = useState<ImageSortState | null>(null);
  const [sortValues, setSortValues] = useState<Record<string, string>>({});
  const [sortLoading, setSortLoading] = useState(false);
  const [sortControlsEnabled, setSortControlsEnabled] = useState(readImageTableSortControlsEnabled);
  const openColumnSettingsWindow = async () => {
    const selectedScope = columnScopeForThumbnail(thumbnailHeaderKind);
    const label = toneMode ? "column-settings-tone" : "column-settings-isp6s";
    const [existing, monitor] = await Promise.all([
      WebviewWindow.getByLabel(label),
      currentMonitor().catch(() => null),
    ]);
    const placement = monitor ? columnSettingsPlacement(monitor) : null;
    if (existing) {
      if (!toneMode) await emit(COLUMN_SETTINGS_SCOPE_EVENT, { scope: selectedScope });
      if (placement && monitor) {
        await existing.setPosition(new PhysicalPosition(
          Math.round(placement.x * monitor.scaleFactor),
          Math.round(placement.y * monitor.scaleFactor),
        ));
      }
      await existing.show();
      await existing.setFocus();
      return;
    }
    prepareColumnSettingsBootstrap(toneMode ? "tone" : "isp6s", schema, useSettingsStore.getState().settings.theme);
    const url = new URL("/column-settings.html", window.location.href);
    url.searchParams.set("mode", toneMode ? "tone" : "isp6s");
    if (!toneMode) url.searchParams.set("scope", selectedScope);
    const child = new WebviewWindow(label, {
      url: url.toString(), title: "LUXE Column Settings", resizable: true,
      ...(placement ?? { width: 920, height: 720, minWidth: 680, minHeight: 500, center: true }),
    });
    void child.once("tauri://error", (event) => console.error("open column settings", event.payload));
  };
  const [imageKinds, setImageKinds] = useState<{
    entries: ImageEntry[];
    keySignature: string;
    revision: number;
    calculator: FaceLinkTargetCalculator;
    byPath: Record<string, ImageTableKind>;
  } | null>(null);
  const [measuredColumnWidths, setMeasuredColumnWidths] = useState<{
    entries: ImageEntry[];
    keySignature: string;
    revision: number;
    calculator: FaceLinkTargetCalculator | null;
    widths: Record<string, number>;
  } | null>(null);
  const [columnWidthOverrides, setColumnWidthOverrides] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!faceLinkTargetCalculator || toneMode || entries.length === 0) return;
    const savedKinds = globalImageKinds.get(entries);
    if (savedKinds?.revision === imageDataRevision
      && savedKinds.keySignature === imageTomlKeySignature
      && savedKinds.calculator === faceLinkTargetCalculator
      && !allParsedRows) {
      setImageKinds({ entries, ...savedKinds });
      setMeasuredColumnWidths({ entries, keySignature: imageTomlKeySignature,
        revision: imageDataRevision, calculator: faceLinkTargetCalculator, widths: savedKinds.widths });
      return;
    }
    let cancelled = false;
    const widths: Record<string, number> = {};
    const publishKinds = (byPath: Record<string, ImageTableKind>) => {
      const result = { keySignature: imageTomlKeySignature, revision: imageDataRevision, calculator: faceLinkTargetCalculator, byPath, widths };
      globalImageKinds.set(entries, result);
      setImageKinds({ entries, ...result });
      setMeasuredColumnWidths({ entries, keySignature: imageTomlKeySignature,
        revision: imageDataRevision, calculator: faceLinkTargetCalculator, widths });
    };
    const extraKeys = expandImageColumnKeys(extraCols);
    const classifyBatch = (rows: Record<string, Record<string, string>>, byPath: Record<string, ImageTableKind>) => {
      for (const [path, data] of Object.entries(rows)) {
        if (path in byPath) continue;
        const face = imageFaceTargetValues(faceLinkTargetCalculator(data, faceBvKey));
        byPath[path] = classifyImageTableRow(data, face, faceFdyKey, extraKeys);
        for (const column of tableColumns) {
          if (column.kind === "idx" || column.kind === "thumbnail" || column.kind === "name") continue;
          widths[column.id] = Math.max(widths[column.id] ?? 0,
            estimateImageColumnTextWidth(imageTableColumnText(column, data, face, false)));
        }
      }
    };
    void (async () => {
      const byPath: Record<string, ImageTableKind> = {};
      const cachedRows: Record<string, Record<string, string>> = {};
      for (const entry of entries) {
        const cached = readGlobalImageTableFields(entries, imageDataRevision, entry.toml_path, imageTomlKeySignature);
        if (cached) cachedRows[entry.toml_path] = cached;
      }
      classifyBatch(cachedRows, byPath);
      if (allParsedRows) {
        rememberGlobalImageTableFields(entries, imageDataRevision, allParsedRows, imageTomlKeySignature);
        classifyBatch(allParsedRows, byPath);
      }
      try {
        const paths = entries.map((entry) => entry.toml_path).filter((path) => !(path in byPath));
        if (paths.length === 0) {
          if (!cancelled) publishKinds(byPath);
          return;
        }
        for (let start = 0; start < paths.length; start += 128) {
          const batch = await loadImageTomlFieldsBatchShared(paths.slice(start, start + 128), imageTomlKeys);
          if (cancelled) return;
          rememberGlobalImageTableFields(entries, imageDataRevision, batch, imageTomlKeySignature);
          classifyBatch(batch, byPath);
        }
        if (!cancelled) publishKinds(byPath);
      } catch (error) {
        if (!cancelled) console.warn("Image table classification failed", error);
      }
    })();
    return () => { cancelled = true; };
  }, [allParsedRows, entries, extraCols, faceBvKey, faceFdyKey, faceLinkTargetCalculator, imageDataRevision, imageTomlKeySignature, imageTomlKeys, tableColumns, toneMode]);

  useEffect(() => {
    if (!toneMode || entries.length === 0) return;
    const saved = globalToneImageWidths.get(entries);
    if (saved?.revision === imageDataRevision && saved.keySignature === imageTomlKeySignature) {
      setMeasuredColumnWidths({ entries, keySignature: imageTomlKeySignature,
        revision: imageDataRevision, calculator: null, widths: saved.widths });
      return;
    }
    let cancelled = false;
    void (async () => {
      const widths: Record<string, number> = {};
      try {
        const paths = entries.map((entry) => entry.toml_path);
        for (let start = 0; start < paths.length; start += 128) {
          const batch = await loadImageTomlFieldsBatchShared(paths.slice(start, start + 128), imageTomlKeys);
          if (cancelled) return;
          rememberGlobalImageTableFields(entries, imageDataRevision, batch, imageTomlKeySignature);
          for (const data of Object.values(batch)) {
            for (const column of tableColumns) {
              if (column.kind !== "extra") continue;
              widths[column.id] = Math.max(widths[column.id] ?? 0,
                estimateImageColumnTextWidth(imageTableColumnText(column, data, null, false)));
            }
          }
        }
        if (!cancelled) {
          globalToneImageWidths.set(entries, { keySignature: imageTomlKeySignature,
            revision: imageDataRevision, widths });
          setMeasuredColumnWidths({ entries, keySignature: imageTomlKeySignature,
            revision: imageDataRevision, calculator: null, widths });
        }
      } catch (error) {
        if (!cancelled) console.warn("Tone image table width measurement failed", error);
      }
    })();
    return () => { cancelled = true; };
  }, [entries, imageDataRevision, imageTomlKeySignature, imageTomlKeys, tableColumns, toneMode]);

  const classifiedKinds = imageKinds?.entries === entries
    && imageKinds.keySignature === imageTomlKeySignature
    && imageKinds.revision === imageDataRevision
    && imageKinds.calculator === faceLinkTargetCalculator
    ? imageKinds.byPath : null;
  const { hasScene, hasPortrait, hasNa } = useMemo(() => {
    let hasScene = false;
    let hasPortrait = false;
    let hasNa = false;
    if (classifiedKinds) {
      for (const entry of entries) {
        const kind = classifiedKinds[entry.toml_path] ?? "na";
        if (kind === "scene") hasScene = true;
        else if (kind === "portrait") hasPortrait = true;
        else if (kind === "na") hasNa = true;
        if (hasScene && hasPortrait && hasNa) break;
      }
    }
    return { hasScene, hasPortrait, hasNa };
  }, [classifiedKinds, entries]);
  const bothKinds = hasScene && hasPortrait;
  const classificationReady = Boolean(classifiedKinds);
  const canFilterKinds = classificationReady && (bothKinds || (hasNa && (hasScene || hasPortrait)));
  const requestedKindFilter = selectedKindFilter;
  const activeKindFilter = (requestedKindFilter === "scene" && hasScene)
    || (requestedKindFilter === "portrait" && hasPortrait) ? requestedKindFilter : "all";
  const thumbnailHeaderKind = canFilterKinds && activeKindFilter !== "all"
    ? activeKindFilter : !classificationReady || hasNa || bothKinds ? "mixed"
      : hasPortrait ? "portrait" : hasScene ? "scene" : "mixed";
  useEffect(() => {
    if (!onVisibleHeatmapPathsChange) return;
    const paths = canFilterKinds && activeKindFilter !== "all" && classifiedKinds
      ? entries.filter((entry) => classifiedKinds[entry.toml_path] === activeKindFilter).map((entry) => entry.toml_path)
      : null;
    onVisibleHeatmapPathsChange(entries, paths);
  }, [activeKindFilter, canFilterKinds, classifiedKinds, entries, onVisibleHeatmapPathsChange]);
  const sceneOnly = (Boolean(classifiedKinds) && hasScene && !hasPortrait)
    || (canFilterKinds && activeKindFilter === "scene");
  const portraitOnly = (Boolean(classifiedKinds) && hasPortrait && !hasScene && !hasNa)
    || (canFilterKinds && activeKindFilter === "portrait");
  const columnScope: ColumnScope = toneMode ? "all" : sceneOnly ? "normal" : portraitOnly ? "face" : "all";
  const activeColumnSettings = modeSettings[columnScope];
  const colorThresholds = modeSettings.color_thresholds;
  const orderedColumns = useMemo(() => {
    const scoped = tableColumns.filter((column) => !column.scope || column.scope === columnScope).map((column) => {
      const edit = activeColumnSettings.edits[column.id];
      if (!edit) return column;
      return { ...column, label: edit.label ?? column.label, originalLabel: column.label,
        key: edit.source ?? column.key, originalKey: column.key,
        sourceOverride: edit.source !== undefined };
    });
    const merged = mergeImageTableColumnOrder(activeColumnSettings.order, scoped.map((column) => column.id));
    const fixed = merged.filter((id) => id === "idx" || id === "thumbnail" || id === "name");
    const fixedSet = new Set<string>(fixed);
    const pinned = activeColumnSettings.pinned
      .filter((id, index) => merged.includes(id) && !fixedSet.has(id) && activeColumnSettings.pinned.indexOf(id) === index);
    const pinnedSet = new Set(pinned);
    return [...fixed, ...pinned, ...merged.filter((id) => !fixedSet.has(id) && !pinnedSet.has(id))]
      .map((id) => scoped.find((column) => column.id === id))
      .filter((column): column is ImageTableColumn => Boolean(column));
  }, [activeColumnSettings.edits, activeColumnSettings.order, activeColumnSettings.pinned, columnScope, tableColumns]);
  const displayedColumns = useMemo(() => {
    const kind = sceneOnly ? "scene" : portraitOnly ? "portrait" : undefined;
    const mapping = kind && !toneMode ? imageTableMapping(schema, kind) : null;
    return orderedColumns.filter((column) => {
      if (activeColumnSettings.hidden.includes(column.id) || activeColumnSettings.deleted.includes(column.id)) return false;
      if (column.kind === "extra") {
        if (column.id.startsWith("custom:")) return true;
        if (mapping) return Object.values(mapping).includes(column.originalKey ?? column.key ?? "");
        return !sceneOnly || ((column.originalLabel ?? column.label) !== "FaceSt"
          && (column.originalLabel ?? column.label) !== "1sSt");
      }
      return !sceneOnly || (column.kind !== "aeGain" && column.kind !== "backCwr" && column.kind !== "cwr");
    }).map((column) => {
      if (!mapping || column.kind !== "extra" || column.id.startsWith("custom:")) return column;
      const label = Object.entries(mapping).find(([, key]) => key === (column.originalKey ?? column.key))?.[0];
      if (activeColumnSettings.edits[column.id]?.label) return column;
      return label === undefined || label === column.label ? column : { ...column, label };
    });
  }, [activeColumnSettings.deleted, activeColumnSettings.edits, activeColumnSettings.hidden, orderedColumns, portraitOnly, sceneOnly, schema, toneMode]);

  useEffect(() => {
    if (toneMode) return;
    let cancelled = false;
    const calculatorRevision = `${cppImportRevision}:${applyAllVersion}`;
    getFaceCalculator(requestedCalculatorPath, calculatorRevision)
      .then((calculate) => {
        if (!cancelled) setFaceLinkTargetState({ filePath: requestedCalculatorPath, version: applyAllVersion, calculate });
      })
      .catch((error) => {
        if (!cancelled) {
          setFaceLinkTargetState(null);
          setCalculatorError({ version: applyAllVersion, message: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => { cancelled = true; };
  }, [filePath, requestedCalculatorPath, applyAllVersion, cppImportRevision, toneMode]);

  useEffect(() => {
    if (parseAllVersion === 0) return;
    let cancelled = false;
    const paths = entries.map((entry) => entry.toml_path);
    const keySignature = imageTomlKeySignature;
    setParsedTomls(null);
    onParseProgress?.({ done: 0, total: paths.length });
    void (async () => {
      const rows: Record<string, Record<string, string>> = {};
      try {
        for (let start = 0; start < paths.length; start += 128) {
          const batch = await loadImageTomlFieldsBatchShared(paths.slice(start, start + 128), imageTomlKeys);
          if (cancelled) return;
          Object.assign(rows, batch);
          onParseProgress?.({ done: Math.min(start + 128, paths.length), total: paths.length });
        }
        if (!cancelled) setParsedTomls({ entries, keySignature, version: parseAllVersion, rows });
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setParseAllError({ version: parseAllVersion, message });
          onParseProgress?.({ done: paths.length, total: paths.length, error: message });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [entries, imageTomlKeySignature, imageTomlKeys, onParseProgress, parseAllVersion]);

  const sortedRows = useMemo(() => {
    const rows = entries.map((entry, index) => ({ e: entry, i: index }))
      .filter(({ e }) => !canFilterKinds || !classifiedKinds || activeKindFilter === "all"
        || shouldShowImageTableRow(classifiedKinds[e.toml_path] ?? "na", activeKindFilter === "scene", activeKindFilter === "portrait"));
    if (!sortControlsEnabled || !sortState) return rows;

    return rows.slice().sort((a, b) => {
      const av = parseImageSortNumber(sortValues[a.e.toml_path]);
      const bv = parseImageSortNumber(sortValues[b.e.toml_path]);
      const direction = sortState.direction === "asc" ? 1 : -1;
      if (av === null && bv === null) return a.i - b.i;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av === bv) return a.i - b.i;
      return av < bv ? -direction : direction;
    });
  }, [activeKindFilter, canFilterKinds, classifiedKinds, entries, sortControlsEnabled, sortState, sortValues]);

  useLayoutEffect(() => {
    scrollPositionChangeRef.current = onScrollPositionChange;
  }, [onScrollPositionChange]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    return () => {
      // Layout cleanup runs before the viewport is detached. A pending restore
      // must keep the saved position rather than replace it with an empty view.
      if (el && !restoreScrollRef.current) {
        scrollPositionChangeRef.current?.({ top: el.scrollTop, left: el.scrollLeft });
      }
    };
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const saved = restoreScrollRef.current;
    if (!el || !saved || entries.length === 0 || el.clientHeight === 0) return;
    const expectedHeight = IMAGE_TABLE_HEADER_HEIGHT + sortedRows.length * IMAGE_TABLE_ROW_HEIGHT;
    if (el.scrollHeight + 1 < expectedHeight) return;

    el.scrollTop = Math.min(saved.top, Math.max(0, el.scrollHeight - el.clientHeight));
    el.scrollLeft = saved.left;
    const restoredPosition = { top: el.scrollTop, left: el.scrollLeft };
    scrollTopRef.current = restoredPosition.top;
    setScrollTop((top) => top === restoredPosition.top ? top : restoredPosition.top);
    restoreScrollRef.current = null;
    scrollPositionChangeRef.current?.(restoredPosition);
  }, [entries, sortedRows.length, viewportHeight]);

  const currentDisplayIndex = useMemo(
    () => sortedRows.findIndex((row) => row.i === current),
    [current, sortedRows],
  );
  const selectedRowVisible = currentDisplayIndex >= 0 && viewportHeight > IMAGE_TABLE_HEADER_HEIGHT
    && IMAGE_TABLE_HEADER_HEIGHT + (currentDisplayIndex + 1) * IMAGE_TABLE_ROW_HEIGHT > scrollTop + IMAGE_TABLE_HEADER_HEIGHT
    && IMAGE_TABLE_HEADER_HEIGHT + currentDisplayIndex * IMAGE_TABLE_ROW_HEIGHT < scrollTop + viewportHeight;
  const firstRowVisible = sortedRows.length > 0 && viewportHeight > IMAGE_TABLE_HEADER_HEIGHT
    && scrollTop < IMAGE_TABLE_ROW_HEIGHT;
  const selectedHeatmapPathSet = useMemo(() => new Set(selectedHeatmapPaths), [selectedHeatmapPaths]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const shouldReload = lastViewportHeightRef.current <= 0 && el.clientHeight > 0;
      refreshImageTableViewport(shouldReload);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    scheduleImageTableViewportRefresh(true);
  }, [current, entries, imageTomlKeySignature]);

  useEffect(() => {
    const refreshVisibleTable = () => scheduleImageTableViewportRefresh(true);
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        refreshVisibleTable();
      }
    };

    window.addEventListener("focus", refreshVisibleTable);
    window.addEventListener("pageshow", refreshVisibleTable);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshVisibleTable);
      window.removeEventListener("pageshow", refreshVisibleTable);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (tableViewportFrameRef.current !== null) {
        window.cancelAnimationFrame(tableViewportFrameRef.current);
        tableViewportFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    writeImageTableSortControlsEnabled(sortControlsEnabled);
  }, [sortControlsEnabled]);

  useEffect(() => () => {
    cancelImageTableColumnDrag();
  }, []);

  const visible = useMemo(() => {
    const bodyScrollTop = Math.max(0, scrollTop - IMAGE_TABLE_HEADER_HEIGHT);
    const effectiveHeight = Math.max(viewportHeight, IMAGE_TABLE_ROW_HEIGHT * 8);
    const start = Math.max(0, Math.floor(bodyScrollTop / IMAGE_TABLE_ROW_HEIGHT) - IMAGE_TABLE_OVERSCAN);
    const count = Math.ceil(effectiveHeight / IMAGE_TABLE_ROW_HEIGHT) + IMAGE_TABLE_OVERSCAN * 2;
    const end = Math.min(sortedRows.length, start + count);
    const rows = sortedRows.slice(start, end);
    return { start, end, rows };
  }, [scrollTop, sortedRows, viewportHeight]);

  const visibleFaceValues = useMemo(() => Object.fromEntries(visible.rows.map(({ e }) => {
    const data = allParsedRows?.[e.toml_path] ?? tomls[e.toml_path] ?? {};
    const target = allTargets?.[e.toml_path] ?? (faceLinkTargetCalculator && e.toml_path in tomls
      ? faceLinkTargetCalculator(data, faceBvKey) : null);
    return [e.toml_path, imageFaceTargetValues(target)];
  })), [allParsedRows, allTargets, faceBvKey, faceLinkTargetCalculator, tomls, visible.rows]);

  const tableWindowPaths = useMemo(() => {
    const paths: string[] = [];
    const seen = new Set<string>();
    const add = (path: string | undefined) => {
      if (!path || seen.has(path)) return;
      seen.add(path);
      paths.push(path);
    };

    for (const { e } of visible.rows) {
      add(e.toml_path);
    }
    const currentEntry = current >= 0 && current < entries.length ? entries[current] : undefined;
    add(currentEntry?.toml_path);
    return paths;
  }, [current, entries, visible.rows]);

  const tableWindowSignature = useMemo(
    () => `${imageTomlKeySignature}\u001e${tableWindowPaths.join("\u001f")}`,
    [imageTomlKeySignature, tableWindowPaths],
  );

  const tablePrefetchPaths = useMemo(() => {
    if (sortedRows.length === 0 || visible.rows.length === 0) return [];
    const rowBudget = Math.max(
      IMAGE_TABLE_PREFETCH_MIN_ROWS,
      visible.rows.length * IMAGE_TABLE_PREFETCH_PAGES,
    );
    const direction = scrollDirectionRef.current;
    const start = direction >= 0
      ? visible.end
      : Math.max(0, visible.start - rowBudget);
    const end = direction >= 0
      ? Math.min(sortedRows.length, visible.end + rowBudget)
      : visible.start;
    if (end <= start) return [];
    return sortedRows.slice(start, end).map((row) => row.e.toml_path);
  }, [sortedRows, visible.end, visible.rows.length, visible.start]);

  const tablePrefetchSignature = useMemo(
    () => `${imageTomlKeySignature}\u001e${tablePrefetchPaths.join("\u001f")}`,
    [imageTomlKeySignature, tablePrefetchPaths],
  );

  useEffect(() => {
    tableWindowPathsRef.current = tableWindowPaths;
  }, [tableWindowPaths, tableWindowSignature]);

  useEffect(() => {
    tableFieldKeySignatureRef.current = imageTomlKeySignature;
    tableTomlPathSetRef.current = new Set(entries.map((entry) => entry.toml_path));
    tableFieldCacheRef.current = {};
    tableFieldAccessOrderRef.current = [];
    loadingTableFieldPathsRef.current.clear();
    const cachedRows: Record<string, Record<string, string>> = {};
    for (const entry of entries) {
      const cached = readGlobalImageTableFields(entries, imageDataRevision, entry.toml_path, imageTomlKeySignature);
      if (cached) {
        cachedRows[entry.toml_path] = cached;
        tableFieldCacheRef.current[entry.toml_path] = cached;
        tableFieldAccessOrderRef.current.push(entry.toml_path);
      }
    }
    setTomls(cachedRows);
  }, [entries, imageTomlKeySignature, imageDataRevision]);

  useEffect(() => {
    if (!sortControlsEnabled || !sortState) return;
    const stillSortable = displayedColumns.some((column) => column.kind === "extra"
      && column.key === sortState.key);
    if (!stillSortable) {
      setSortState(null);
    }
  }, [displayedColumns, sortControlsEnabled, sortState]);

  useEffect(() => {
    const requestId = sortRequestRef.current + 1;
    sortRequestRef.current = requestId;

    if (!sortControlsEnabled || !sortState || entries.length === 0) {
      setSortValues({});
      setSortLoading(false);
      return;
    }

    setSortLoading(true);
    const paths = entries.map((entry) => entry.toml_path);
    const sortKey = sortState.key;
    const sortKeys = sortKey.startsWith("=") ? imageColumnSourceKeys(sortKey) : [sortKey];
    if (sortKeys.length === 0) {
      setSortValues({});
      setSortLoading(false);
      return;
    }
    loadImageTomlFieldsBatchShared(paths, sortKeys)
      .then((batch) => {
        if (sortRequestRef.current !== requestId) return;
        const nextValues: Record<string, string> = {};
        for (const entry of entries) {
          const data = batch[entry.toml_path] ?? {};
          nextValues[entry.toml_path] = sortKey.startsWith("=")
            ? customImageColumnText(sortKey, (key) => tomlLookup(data, key))
            : tomlLookup(data, sortKey);
        }
        setSortValues(nextValues);
      })
      .catch(() => {
        if (sortRequestRef.current !== requestId) return;
        setSortValues({});
      })
      .finally(() => {
        if (sortRequestRef.current === requestId) {
          setSortLoading(false);
        }
      });
  }, [entries, sortControlsEnabled, sortState]);

  function rememberTableFieldRows(batch: Record<string, Record<string, string>>) {
    const cache = tableFieldCacheRef.current;
    const order = tableFieldAccessOrderRef.current;
    const allowedPaths = tableTomlPathSetRef.current;
    for (const [path, data] of Object.entries(batch)) {
      if (!allowedPaths.has(path)) continue;
      const existingOrderIndex = order.indexOf(path);
      if (existingOrderIndex >= 0) {
        order.splice(existingOrderIndex, 1);
      }
      order.push(path);
      cache[path] = data;
    }
    rememberGlobalImageTableFields(entries, imageDataRevision, batch, tableFieldKeySignatureRef.current);

    while (order.length > IMAGE_TABLE_FIELD_CACHE_LIMIT) {
      const stalePath = order.shift();
      if (stalePath) delete cache[stalePath];
    }
  }

  function readCachedTableRows(paths: string[]) {
    const cache = tableFieldCacheRef.current;
    const rows: Record<string, Record<string, string>> = {};
    for (const path of paths) {
      rows[path] = cache[path] ?? {};
    }
    return rows;
  }

  function pendingTableFieldPaths(paths: string[]) {
    const cache = tableFieldCacheRef.current;
    const loading = loadingTableFieldPathsRef.current;
    return paths.filter((path) => !(path in cache) && !loading.has(path));
  }

  function refreshImageTableViewport(forceReload = false) {
    const el = scrollRef.current;
    if (!el) return;

    const nextViewportHeight = el.clientHeight;
    if (restoreScrollRef.current) {
      lastViewportHeightRef.current = nextViewportHeight;
      setViewportHeight((prev) => prev === nextViewportHeight ? prev : nextViewportHeight);
      return;
    }
    const maxScrollTop = Math.max(0, el.scrollHeight - nextViewportHeight);
    const nextScrollTop = Math.max(0, Math.min(el.scrollTop, maxScrollTop));
    lastViewportHeightRef.current = nextViewportHeight;

    if (el.scrollTop !== nextScrollTop) {
      el.scrollTop = nextScrollTop;
    }
    scrollDirectionRef.current = nextScrollTop >= scrollTopRef.current ? 1 : -1;
    scrollTopRef.current = nextScrollTop;

    setViewportHeight((prev) => (prev === nextViewportHeight ? prev : nextViewportHeight));
    setScrollTop((prev) => (prev === nextScrollTop ? prev : nextScrollTop));
    if (forceReload && nextViewportHeight > 0) {
      setTableReloadVersion((version) => version + 1);
    }
  }

  function scheduleImageTableViewportRefresh(forceReload = false) {
    pendingViewportReloadRef.current = pendingViewportReloadRef.current || forceReload;
    if (tableViewportFrameRef.current !== null) return;

    tableViewportFrameRef.current = window.requestAnimationFrame(() => {
      tableViewportFrameRef.current = null;
      const shouldReload = pendingViewportReloadRef.current;
      pendingViewportReloadRef.current = false;
      refreshImageTableViewport(shouldReload);
    });
  }

  function setImageTableScrollTop(nextScrollTop: number) {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(nextScrollTop, el.scrollHeight - el.clientHeight));
    scrollDirectionRef.current = clamped >= scrollTopRef.current ? 1 : -1;
    scrollTopRef.current = clamped;
    el.scrollTop = clamped;
    scrollPositionChangeRef.current?.({ top: el.scrollTop, left: el.scrollLeft });
    setScrollTop(clamped);
  }

  function ensureImageTableRowVisible(displayIndex: number) {
    const el = scrollRef.current;
    if (!el || displayIndex < 0) return;
    const rowTop = IMAGE_TABLE_HEADER_HEIGHT + displayIndex * IMAGE_TABLE_ROW_HEIGHT;
    const rowBottom = rowTop + IMAGE_TABLE_ROW_HEIGHT;
    const viewTop = el.scrollTop;
    const viewBottom = viewTop + el.clientHeight;
    if (rowTop < viewTop + IMAGE_TABLE_HEADER_HEIGHT) {
      setImageTableScrollTop(Math.max(0, rowTop - IMAGE_TABLE_HEADER_HEIGHT - IMAGE_TABLE_ROW_HEIGHT));
    } else if (rowBottom > viewBottom) {
      setImageTableScrollTop(rowBottom - el.clientHeight + IMAGE_TABLE_ROW_HEIGHT);
    }
  }

  function pickDisplayRow(displayIndex: number) {
    const nextRow = sortedRows[displayIndex];
    if (!nextRow) return;
    preserveRestoredScrollRef.current = false;
    ensureImageTableRowVisible(displayIndex);
    onPick(nextRow.i);
  }

  function handleImageTableKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (sortedRows.length === 0) return;
    event.preventDefault();

    const nextSourceIndex = sortedRows.findIndex(({ i }) => i > current);
    const fallbackIndex = nextSourceIndex < 0 ? sortedRows.length - 1 : nextSourceIndex;
    const activeIndex = currentDisplayIndex >= 0 ? currentDisplayIndex : fallbackIndex;
    const nextIndex = event.key === "ArrowUp"
      ? Math.max(0, activeIndex - 1)
      : Math.min(sortedRows.length - 1, activeIndex + 1);
    if (nextIndex !== activeIndex) {
      pickDisplayRow(nextIndex);
    }
  }

  function toggleImageSort(column: string, key: string) {
    if (!sortControlsEnabled) return;
    setSortState((prev) => {
      if (prev?.key === key) {
        return {
          column,
          key,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { column, key, direction: "asc" };
    });
  }

  function toggleImageSortControls() {
    setSortControlsEnabled((prev) => {
      const next = !prev;
      if (!next) {
        setSortState(null);
        setSortValues({});
        setSortLoading(false);
      }
      return next;
    });
  }

  function cancelImageTableColumnDrag() {
    const drag = columnDragRef.current;
    if (!drag) return;
    if (drag.timer !== null) {
      window.clearTimeout(drag.timer);
    }
    drag.cleanup?.();
    if (drag.active) {
      document.body.style.userSelect = drag.previousUserSelect;
    }
    columnDragRef.current = null;
    setDragOverColumnId(null);
  }

  function getImageTableColumnIdAtPoint(x: number, y: number): string | null {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-image-table-column-id]");
    const id = target?.dataset.imageTableColumnId;
    return id && tableColumns.some((column) => column.id === id) ? id : null;
  }

  function swapImageTableColumns(firstId: string, secondId: string) {
    if (firstId === secondId || firstId === "idx" || secondId === "idx"
      || firstId === "thumbnail" || secondId === "thumbnail") return;
    const nextOrder = orderedColumns.map((column) => column.id);
    const firstIndex = nextOrder.indexOf(firstId);
    const secondIndex = nextOrder.indexOf(secondId);
    if (firstIndex < 0 || secondIndex < 0) return;
    [nextOrder[firstIndex], nextOrder[secondIndex]] = [nextOrder[secondIndex], nextOrder[firstIndex]];
    const nextModeSettings = { ...modeSettings,
      [columnScope]: { ...activeColumnSettings, order: nextOrder },
    };
    setModeSettings(nextModeSettings);
    void (async () => {
      await saveImageTableMode(columnMode, nextModeSettings,
        readLegacyColumnMode(columnMode === "isp6s" ? "tone" : "isp6s"));
      await flushStateNow();
      await emit(COLUMN_SETTINGS_SAVED_EVENT, { mode: columnMode, settings: nextModeSettings });
    })().catch((error) => console.warn("save image table column order", error));
  }

  function startImageTableColumnDrag(columnId: string) {
    return (event: ReactPointerEvent<HTMLTableCellElement>) => {
      if (event.button !== 0 || !tableColumns.some((column) => column.id === columnId)) return;
      cancelImageTableColumnDrag();

      const drag: ImageTableColumnDragState = {
        id: columnId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        timer: null,
        active: false,
        previousUserSelect: document.body.style.userSelect,
      };
      columnDragRef.current = drag;

      const onMove = (moveEvent: PointerEvent) => {
        if (columnDragRef.current !== drag || moveEvent.pointerId !== drag.pointerId) return;
        const movedX = moveEvent.clientX - drag.startX;
        const movedY = moveEvent.clientY - drag.startY;
        if (!drag.active) {
          if (Math.hypot(movedX, movedY) > IMAGE_TABLE_COLUMN_DRAG_DISTANCE) {
            cancelImageTableColumnDrag();
          }
          return;
        }

        moveEvent.preventDefault();
        setDragOverColumnId(getImageTableColumnIdAtPoint(moveEvent.clientX, moveEvent.clientY));
      };
      const onUp = (upEvent: PointerEvent) => {
        if (columnDragRef.current !== drag || upEvent.pointerId !== drag.pointerId) return;
        if (drag.active) {
          const targetId = getImageTableColumnIdAtPoint(upEvent.clientX, upEvent.clientY);
          if (targetId) {
            swapImageTableColumns(drag.id, targetId);
          }
          suppressColumnClickRef.current = true;
          window.setTimeout(() => {
            suppressColumnClickRef.current = false;
          }, 0);
        }
        cancelImageTableColumnDrag();
      };
      const onCancel = () => {
        if (columnDragRef.current === drag) {
          cancelImageTableColumnDrag();
        }
      };

      drag.cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("blur", onCancel);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("blur", onCancel);
      drag.timer = window.setTimeout(() => {
        if (columnDragRef.current !== drag) return;
        drag.active = true;
        document.body.style.userSelect = "none";
        setDragOverColumnId(drag.id);
      }, IMAGE_TABLE_COLUMN_DRAG_DELAY_MS);
    };
  }

  useEffect(() => {
    if (previousCurrentRef.current !== current) {
      previousCurrentRef.current = current;
      preserveRestoredScrollRef.current = false;
    }
    if (!preserveRestoredScrollRef.current && !restoreScrollRef.current
      && viewportHeight > IMAGE_TABLE_HEADER_HEIGHT && currentDisplayIndex >= 0) {
      ensureImageTableRowVisible(currentDisplayIndex);
    }
  }, [current, currentDisplayIndex, viewportHeight]);

  useEffect(() => {
    const previous = previousKindFilterRef.current;
    previousKindFilterRef.current = selectedKindFilter;
    if (previous === null || previous === selectedKindFilter) return;
    restoreScrollRef.current = null;
    preserveRestoredScrollRef.current = false;
    const el = scrollRef.current;
    if (!el) return;
    setImageTableScrollTop(0);
  }, [selectedKindFilter]);

  useEffect(() => {
    const firstPath = selectedHeatmapPaths[0];
    if (!firstPath) return;
    ensureImageTableRowVisible(sortedRows.findIndex(({ e }) => e.toml_path === firstPath));
  }, [selectedHeatmapPaths, sortedRows]);

  useEffect(() => {
    if (imageTomlKeys.length === 0 || tableWindowPaths.length === 0) {
      setTomls({});
      return;
    }

    setTomls(readCachedTableRows(tableWindowPaths));
    const missing = pendingTableFieldPaths(tableWindowPaths);
    if (missing.length === 0) return;

    const requestKeySignature = imageTomlKeySignature;
    const timer = window.setTimeout(() => {
      missing.forEach((path) => loadingTableFieldPathsRef.current.add(path));
      loadImageTomlFieldsBatchShared(missing, imageTomlKeys)
        .then((batch) => {
          if (tableFieldKeySignatureRef.current !== requestKeySignature) return;
          rememberTableFieldRows(batch);
          const currentPaths = tableWindowPathsRef.current;
          if (currentPaths.some((path) => path in batch)) {
            setTomls(readCachedTableRows(currentPaths));
          }
        })
        .catch(() => {
          if (tableFieldKeySignatureRef.current !== requestKeySignature) return;
          const emptyRows: Record<string, Record<string, string>> = {};
          for (const path of missing) {
            emptyRows[path] = {};
          }
          rememberTableFieldRows(emptyRows);
          const currentPaths = tableWindowPathsRef.current;
          if (currentPaths.some((path) => path in emptyRows)) {
            setTomls(readCachedTableRows(currentPaths));
          }
        })
        .finally(() => {
          missing.forEach((path) => loadingTableFieldPathsRef.current.delete(path));
        });
    }, IMAGE_TABLE_LOAD_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [imageTomlKeySignature, imageTomlKeys, tableReloadVersion, tableWindowPaths, tableWindowSignature]);

  useEffect(() => {
    if (imageTomlKeys.length === 0 || tablePrefetchPaths.length === 0) return;

    const missing = pendingTableFieldPaths(tablePrefetchPaths);
    if (missing.length === 0) return;

    const requestKeySignature = imageTomlKeySignature;
    const timer = window.setTimeout(() => {
      missing.forEach((path) => loadingTableFieldPathsRef.current.add(path));
      loadImageTomlFieldsBatchShared(missing, imageTomlKeys)
        .then((batch) => {
          if (tableFieldKeySignatureRef.current !== requestKeySignature) return;
          rememberTableFieldRows(batch);
          const currentPaths = tableWindowPathsRef.current;
          if (currentPaths.some((path) => path in batch)) {
            setTomls(readCachedTableRows(currentPaths));
          }
        })
        .catch(() => {
          if (tableFieldKeySignatureRef.current !== requestKeySignature) return;
          const emptyRows: Record<string, Record<string, string>> = {};
          for (const path of missing) {
            emptyRows[path] = {};
          }
          rememberTableFieldRows(emptyRows);
        })
        .finally(() => {
          missing.forEach((path) => loadingTableFieldPathsRef.current.delete(path));
        });
    }, IMAGE_TABLE_PREFETCH_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [imageTomlKeySignature, imageTomlKeys, tablePrefetchPaths, tablePrefetchSignature]);


  const colSpan = displayedColumns.length;
  const evOverrideColumn = displayedColumns.find((column) => column.kind === "ev"
    && column.sourceOverride && !isCwrEvFormula(column.key ?? ""));
  const deltaOverrideColumn = displayedColumns.find((column) => column.kind === "delta"
    && column.sourceOverride && !isCwrDeltaFormula(column.key ?? ""));
  const aeGainColumn = displayedColumns.find((column) => column.kind === "aeGain");
  const topPadding = visible.start * IMAGE_TABLE_ROW_HEIGHT;
  const bottomPadding = Math.max(0, (sortedRows.length - visible.end) * IMAGE_TABLE_ROW_HEIGHT);
  const nameColumnWidth = useMemo(() => entries.reduce(
    (width, entry) => Math.max(width, Math.min(2000, estimateImageColumnTextWidth(entry.name))),
    Math.max(estimateImageColumnTextWidth(directoryName) + 32, 160),
  ), [directoryName, entries]);
  const fullColumnWidths = measuredColumnWidths?.entries === entries
    && measuredColumnWidths.keySignature === imageTomlKeySignature
    && measuredColumnWidths.revision === imageDataRevision
    && measuredColumnWidths.calculator === (toneMode ? null : faceLinkTargetCalculator)
    ? measuredColumnWidths.widths : null;
  const baseColumnWidths = useMemo(() => {
    const byId: Record<string, number> = {};
    for (const column of tableColumns) {
      if (column.kind === "thumbnail") {
        byId[column.id] = IMAGE_TABLE_THUMBNAIL_COLUMN_WIDTH;
        continue;
      }
      if (column.kind === "name") {
        byId[column.id] = nameColumnWidth;
        continue;
      }
      const minWidth = column.kind === "idx" ? 34 : 52;
      const headerWidth = estimateImageColumnTextWidth(column.label)
        + (column.kind === "extra" && sortControlsEnabled ? 16 : 0);
      let width = Math.max(minWidth, headerWidth, fullColumnWidths?.[column.id] ?? 0);
      if (column.kind === "idx") {
        byId[column.id] = Math.max(width, estimateImageColumnTextWidth(String(entries.length)));
        continue;
      }
      for (const { e: entry } of visible.rows) {
        const target = visibleFaceValues[entry.toml_path];
        const data = allParsedRows?.[entry.toml_path] ?? tomls[entry.toml_path] ?? {};
        const text = imageTableColumnText(column, data, target, sceneOnly || classifiedKinds?.[entry.toml_path] === "scene");
        width = Math.max(width, estimateImageColumnTextWidth(text));
      }
      byId[column.id] = width;
    }
    return { byId };
  }, [allParsedRows, classifiedKinds, entries.length, fullColumnWidths, nameColumnWidth, sceneOnly, sortControlsEnabled, tableColumns, tomls, visible.rows, visibleFaceValues]);

  const columnWidths = useMemo(() => {
    const byId: Record<string, number> = {};
    for (const column of tableColumns) {
      const fallback = baseColumnWidths.byId[column.id] ?? 72;
      const width = columnWidthOverrides[column.id] ?? fallback;
      byId[column.id] = width;
    }
    return {
      byId,
      table: displayedColumns.reduce((sum, column) => sum + (byId[column.id] ?? 72), 0),
    };
  }, [baseColumnWidths, columnWidthOverrides, displayedColumns, tableColumns]);

  const startColumnResize = (column: string, initialWidth: number, minWidth: number) =>
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const onMove = (moveEvent: PointerEvent) => {
        const maxWidth = column === "name" ? 2000 : 640;
        const nextWidth = Math.max(minWidth, Math.min(maxWidth, initialWidth + moveEvent.clientX - startX));
        setColumnWidthOverrides((current) => ({ ...current, [column]: nextWidth }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    };

  return (
    <div className="relative h-full w-full min-h-0">
    <div
      ref={scrollRef}
      className="image-table-viewport h-full w-full overflow-auto outline-none"
      tabIndex={0}
      aria-label="Image table"
      onKeyDown={handleImageTableKeyDown}
      onClickCapture={(event) => {
        if (suppressColumnClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressColumnClickRef.current = false;
        }
      }}
      onScroll={(event) => {
        if (restoreScrollRef.current) return;
        const nextScrollTop = event.currentTarget.scrollTop;
        scrollPositionChangeRef.current?.({ top: nextScrollTop, left: event.currentTarget.scrollLeft });
        scrollDirectionRef.current = nextScrollTop >= scrollTopRef.current ? 1 : -1;
        scrollTopRef.current = nextScrollTop;
        setScrollTop(nextScrollTop);
      }}
    >
      <table className="w-full text-xs"
           style={{
                fontFamily: '"Segoe UI", Arial, sans-serif',
                fontSize: 13,
                color: "var(--colorNeutralForeground1)",
                background: entries.length === 0 ? "transparent" : "var(--colorNeutralBackground1)",
                borderCollapse: "separate",
                borderSpacing: 0,
                borderLeft: "1px solid var(--colorNeutralStroke2)",
                minWidth: "100%",
               tableLayout: "fixed",
               width: columnWidths.table,
             }}>
        <colgroup>
          {displayedColumns.map((column) => (
            <col key={column.id} style={{ width: columnWidths.byId[column.id] }} />
          ))}
        </colgroup>
        <thead style={{
           background: "var(--colorNeutralBackground2)",
          color: "var(--colorNeutralForeground2)",
          }}>
          <tr>
            {displayedColumns.map((column) => {
              const active = column.kind === "extra" && sortState?.key === column.key;
              const minWidth = column.kind === "idx"
                ? 34
                : column.kind === "thumbnail"
                  ? IMAGE_TABLE_THUMBNAIL_COLUMN_WIDTH
                  : column.kind === "name"
                    ? 80
                    : 52;
              return (
                <Th
                  key={column.id}
                  columnId={column.id}
                  align={column.align}
                  dragOver={dragOverColumnId === column.id}
                  stickyLeft={column.kind === "idx" ? 0 : column.kind === "thumbnail" ? columnWidths.byId.idx ?? 34 : column.kind === "name" ? (columnWidths.byId.idx ?? 34) + (columnWidths.byId.thumbnail ?? IMAGE_TABLE_THUMBNAIL_COLUMN_WIDTH) : undefined}
                  onPointerDown={column.kind === "idx" || column.kind === "thumbnail" || column.kind === "name" ? undefined : startImageTableColumnDrag(column.id)}
                  onResizeStart={startColumnResize(column.id, columnWidths.byId[column.id], minWidth)}
                >
                  {column.kind === "idx" ? (
                    <span>idx</span>
                  ) : column.kind === "thumbnail" ? (
                    <span className="inline-flex items-center justify-center gap-1">
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center border-0 bg-transparent p-0 text-inherit"
                        style={{ cursor: canFilterKinds ? "pointer" : "default" }}
                        title={thumbnailHeaderKind === "mixed"
                          ? `图片类型：${classificationReady && !hasScene && !hasPortrait ? "无法解析" : "全部"}${canFilterKinds ? "；右键筛选类型，左键显示全部" : ""}`
                          : `${activeKindFilter !== "all" ? "仅显示" : "只有"}${thumbnailHeaderKind === "scene" ? "空景" : "人像"}图片${canFilterKinds ? "；右键切换类型，左键显示全部" : ""}`}
                        aria-label={thumbnailHeaderKind === "mixed"
                          ? `图片类型：${classificationReady && !hasScene && !hasPortrait ? "无法解析" : "全部"}`
                          : `${activeKindFilter !== "all" ? "仅显示" : "只有"}${thumbnailHeaderKind === "scene" ? "空景" : "人像"}图片`}
                        aria-pressed={canFilterKinds ? activeKindFilter !== "all" : undefined}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => { if (canFilterKinds) setKindFilter("all"); }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          if (!canFilterKinds) return;
                          const next = bothKinds ? (activeKindFilter === "scene" ? "portrait" : "scene")
                            : activeKindFilter === "all" ? (hasScene ? "scene" : "portrait") : "all";
                          setKindFilter(next);
                        }}
                      >
                        {thumbnailHeaderKind === "scene" ? <SceneLeafProtectIcon />
                          : thumbnailHeaderKind === "portrait" ? <Person24Regular className="h-4 w-4" aria-hidden="true" />
                            : <Image24Regular className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    </span>
                  ) : column.kind === "name" ? (
                    <div className="flex w-full min-w-0 items-center justify-between gap-1">
                      <span className="min-w-0 truncate text-left font-semibold normal-case" title={directoryName}>{directoryName || column.label}</span>
                      <button type="button" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-black/10 active:scale-90" title="表格列设置" aria-label="表格列设置" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void openColumnSettingsWindow(); }}>
                        <Settings24Regular className="h-4 w-4" />
                      </button>
                    </div>
                  ) : column.kind !== "extra" ? (
                    column.label
                  ) : sortControlsEnabled ? (
                    <ImageSortHeader
                      label={column.label}
                      align={column.align}
                      active={active}
                      direction={active && sortState ? sortState.direction : "asc"}
                      loading={active && sortLoading}
                      onClick={() => toggleImageSort(column.label, column.key ?? "")}
                      onReset={() => setSortState(null)}
                    />
                  ) : column.label}
                </Th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length > 0 && topPadding > 0 && (
            <tr aria-hidden="true" style={{ height: topPadding }}>
              <td colSpan={colSpan} style={{ height: topPadding, padding: 0, border: 0 }} />
            </tr>
          )}
          {visible.rows.map(({ e, i }) => {
            const heatmapSelected = selectedHeatmapPathSet.has(e.toml_path);
            const data = allParsedRows?.[e.toml_path] ?? tomls[e.toml_path] ?? {};
            const target = visibleFaceValues[e.toml_path];
            const rowIsScene = sceneOnly || classifiedKinds?.[e.toml_path] === "scene";
            const evOverrideValue = evOverrideColumn
              ? parseMetricResult(imageTableColumnText(evOverrideColumn, data, target, rowIsScene)) : null;
            const deltaOverrideText = deltaOverrideColumn
              ? imageTableColumnText(deltaOverrideColumn, data, target, rowIsScene) : null;
            const aeGainText = aeGainColumn
              ? imageTableColumnText(aeGainColumn, data, target, rowIsScene) : null;
            const aeGainPair = parseMetricPair(aeGainText ?? "");
            const baseBackground = i % 2 === 0 ? "var(--colorNeutralBackground1)"
              : "color-mix(in srgb, var(--colorNeutralForeground1) 2%, var(--colorNeutralBackground1))";
            const rowBackground = heatmapSelected ? "var(--colorPaletteGreenBackground1)" : baseBackground;
            return (
              <tr key={e.jpg_path}
                  aria-selected={heatmapSelected || i === current}
                  onClick={() => {
                    preserveRestoredScrollRef.current = false;
                    scrollRef.current?.focus({ preventScroll: true });
                    onPick(i);
                  }}
                   style={{
                     cursor: "pointer",
                     height: IMAGE_TABLE_ROW_HEIGHT,
                     background: rowBackground,
                     color: i === current ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground1)",
                   }}>
                 {displayedColumns.map((column, columnIndex) => (
                   <Td
                     key={column.id}
                     align={column.align}
                     compact={column.kind === "thumbnail"}
                     stickyLeft={column.kind === "idx" ? 0 : column.kind === "thumbnail" ? columnWidths.byId.idx ?? 34 : column.kind === "name" ? (columnWidths.byId.idx ?? 34) + (columnWidths.byId.thumbnail ?? IMAGE_TABLE_THUMBNAIL_COLUMN_WIDTH) : undefined}
                     stickyBackground={column.kind === "idx" && i === current ? baseBackground
                     : i === current ? IMAGE_TABLE_SELECTED_BACKGROUND : rowBackground}
                     selected={column.kind === "idx" && i === current}
                     selectedBody={column.kind !== "idx" && i === current}
                     selectedOutlineStart={column.kind === "thumbnail"}
                     selectedOutlineEnd={columnIndex === displayedColumns.length - 1}
                     title={column.kind === "name" ? e.name : undefined}
                   >
                     {column.kind === "idx"
                       ? <button
                           type="button"
                           className="inline-flex min-w-6 items-center justify-center rounded px-1 py-0.5 transition-[background-color,transform] duration-100 hover:bg-black/10 active:scale-90"
                           style={{ color: sortControlsEnabled ? "var(--colorBrandForeground1)" : "inherit" }}
                           title={sortControlsEnabled ? "关闭其他列排序" : "开启其他列排序"}
                           aria-label={sortControlsEnabled ? "关闭其他列排序" : "开启其他列排序"}
                           aria-pressed={sortControlsEnabled}
                           onPointerDown={(event) => event.stopPropagation()}
                           onClick={toggleImageSortControls}
                         >{i + 1}</button>
                       : column.kind === "thumbnail"
                         ? <ImageTableThumbnail entry={e} columnWidth={columnWidths.byId[column.id] ?? 72} />
                         : column.kind === "name"
                           ? e.name
                           : column.kind === "ev" && (!column.sourceOverride || isCwrEvFormula(column.key ?? ""))
                             ? <>{([target?.normalEv ?? null, target?.backEv ?? null, target?.evPair ?? null] as const)
                               .map((value, index) => <span key={index}>
                                 {index > 0 && <span>|</span>}
                                 <span style={metricDirectionStyle(value, colorThresholds.ev)}>{formatDeltaEv(value)}</span>
                               </span>)}</>
                           : column.kind === "ev"
                             ? <span style={metricDirectionStyle(evOverrideValue, colorThresholds.ev)}>
                                 {formatDeltaEv(evOverrideValue)}
                               </span>
                           : column.kind === "delta" && column.sourceOverride && !isCwrDeltaFormula(column.key ?? "")
                             ? <span style={faceTargetDeltaStyle(parseMetricResult(deltaOverrideText ?? "-"), colorThresholds.delta)}>
                                 {deltaOverrideText}
                               </span>
                           : column.kind === "aeGain"
                             ? aeGainPair
                               ? <>{aeGainPair.first}(<span style={metricDirectionStyle(aeGainPair.difference, colorThresholds.ae_gain)}>{aeGainPair.second}</span>)</>
                               : aeGainText ?? "-"
                           : column.sourceOverride && !(column.kind === "delta" && isCwrDeltaFormula(column.key ?? ""))
                             ? !toneMode && column.kind === "extra"
                               && !isImageTableColumnMapped(schema, column.originalKey ?? column.key ?? "", classifiedKinds?.[e.toml_path])
                               ? "-" : imageTableColumnText(column, data, target, rowIsScene)
                           : column.kind === "normalCwr"
                             ? target?.normalCwr ?? "-"
                           : column.kind === "backCwr"
                             ? target?.backCwr ?? "-"
                           : column.kind === "cwr"
                             ? target?.cwr ?? "-"
                             : column.kind === "delta" && sceneOnly
                               ? <span style={faceTargetDeltaStyle(target?.normalDelta ?? null, colorThresholds.delta)}>{formatFaceTargetDelta(target?.normalDelta ?? null)}</span>
                             : column.kind === "delta"
                               ? <><span style={faceTargetDeltaStyle(target?.normalDelta ?? null, colorThresholds.delta)}>{formatFaceTargetDelta(target?.normalDelta ?? null)}</span>
                                   <span>|</span>
                                   <span style={faceTargetDeltaStyle(target?.backDelta ?? null, colorThresholds.delta)}>{formatFaceTargetDelta(target?.backDelta ?? null)}</span>
                                   <span>|</span>
                                   <span style={faceTargetDeltaStyle(target?.linkDelta ?? null, colorThresholds.delta)}>{formatFaceTargetDelta(target?.linkDelta ?? null)}</span></>
                                 : !toneMode && column.kind === "extra"
                                 && !column.id.startsWith("custom:")
                                 && !isImageTableColumnMapped(schema, column.originalKey ?? column.key ?? "", classifiedKinds?.[e.toml_path])
                                 ? "-" : imageTableColumnText(column, data, target, rowIsScene)}
                   </Td>
                 ))}
              </tr>
            );
          })}
          {sortedRows.length > 0 && bottomPadding > 0 && (
            <tr aria-hidden="true" style={{ height: bottomPadding }}>
              <td colSpan={colSpan} style={{ height: bottomPadding, padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
    {entries.length === 0 && (
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-xs"
        style={{ top: IMAGE_TABLE_HEADER_HEIGHT, color: "var(--colorNeutralForeground3)" }}
      >
        <ImageMultiple24Regular className="h-7 w-7" aria-hidden="true" />
        <span>尚未导入图片</span>
        <span className="text-[11px]">拖入图片文件夹，或点击标题栏的文件夹按钮添加</span>
      </div>
    )}
    <ImageTableHoverPreview scrollRef={scrollRef} />
    {currentDisplayIndex >= 0 && (!selectedRowVisible || !firstRowVisible) && (
      <button
        type="button"
        className="absolute bottom-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border shadow-md transition-transform hover:scale-105"
        style={{
          background: IMAGE_TABLE_SELECTED_BACKGROUND,
          color: "var(--colorBrandForeground1)",
          borderColor: "var(--colorBrandStroke1)",
          opacity: 0.7,
        }}
        aria-label={selectedRowVisible ? "返回第一行" : "定位到选中项"}
        title={selectedRowVisible ? "返回第一行" : "定位到选中项"}
        onClick={() => {
          if (selectedRowVisible) setImageTableScrollTop(0);
          else ensureImageTableRowVisible(currentDisplayIndex);
          scrollRef.current?.focus({ preventScroll: true });
        }}
      >
        {selectedRowVisible ? <ChevronUp24Regular className="h-5 w-5" aria-hidden="true" />
          : <TableCellCenterSearch24Regular className="h-5 w-5" aria-hidden="true" />}
      </button>
    )}
    </div>
  );
}

export function LceTab({
  schema,
  tomlData,
}: {
  schema: Isp6sSchemaRoot;
  tomlData: Record<string, string>;
}) {
  const labels = ["0", "1", "50", "250", "500", "750", "950", "999"];
  const num = (k: string) => {
    const v = tomlData[k];
    const f = parseFloat(v ?? "");
    return Number.isFinite(f) ? f : NaN;
  };
  const p = labels.map((n) => num(`SW_LCE_P${n}`));
  const o = labels.map((n) => num(`SW_LCE_O${n}`));
  const entry: ImageEntry | undefined = undefined;
  const hideImage = true;
  const previewMode: string = "image_table";
  const setMode = (_mode: string) => {};
  return (
    <PanelGroup direction="horizontal" autoSaveId="isp6s-lce-split" className="h-full w-full">
      <Panel defaultSize={38} minSize={22}>
        <div className="h-full w-full overflow-hidden border"
             style={{
               background: "var(--colorNeutralBackground1)",
               borderColor: "var(--colorNeutralStroke2)",
               borderLeft: 0,
               borderTop: 0,
               borderBottom: 0,
               borderRadius: "0 0 0 12px",
             }}>
          <LcePreviewInfoTable schema={schema} tomlData={tomlData} />
        </div>
        {false && (
        <div className="h-full w-full">
            <div
              className="relative flex h-full w-full items-center justify-center overflow-hidden border"
              style={{
                background: "var(--colorNeutralBackground1)",
                borderColor: "var(--colorNeutralStroke2)",
                borderLeft: 0,
                borderTop: 0,
                borderBottom: 0,
                borderRadius: "0 0 0 12px",
              }}
            >
              <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md px-1 py-1"
                   style={getOverlayChrome()}>
                {!hideImage && (
                  <HoverTooltip content="图片" positioning="below-center" inline>
                    <Button
                      appearance={previewMode === "image" ? "primary" : "subtle"}
                      size="small"
                      icon={<Image24Regular />}
                      onClick={() => setMode("image")}
                    />
                  </HoverTooltip>
                )}
                <HoverTooltip content="三段图" positioning="below-center" inline>
                  <Button
                    appearance={previewMode === "image_split" ? "primary" : "subtle"}
                    size="small"
                    icon={<ChartMultiple24Regular />}
                    onClick={() => setMode("image_split")}
                  />
                </HoverTooltip>
                <HoverTooltip content="二段图" positioning="below-center" inline>
                  <Button
                    appearance={previewMode === "image_table" ? "primary" : "subtle"}
                    size="small"
                    icon={<TableSimple24Regular />}
                    onClick={() => setMode("image_table")}
                  />
                </HoverTooltip>
              </div>
              {previewMode === "image" && <LceImagePreview entry={entry} />}
              {previewMode === "image_table" && (
                <LceImageTableMode entry={entry} schema={schema} tomlData={tomlData} hideImage={hideImage} />
              )}
              {previewMode === "image_split" && (
                <ImageSplitMode entry={entry} schema={schema} tomlData={tomlData} hideImage={hideImage} />
              )}
            </div>
          </div>
        )}
      </Panel>
      <ResizeHandle direction="horizontal" size={10} />
      <Panel minSize={30}>
        <div className="h-full w-full">
          <div
            className="h-full w-full overflow-hidden border"
            style={{
              background: "var(--colorNeutralBackground1)",
              borderColor: "var(--colorNeutralStroke2)",
              borderRight: 0,
              borderTop: 0,
              borderBottom: 0,
              borderRadius: "0 0 12px 0",
            }}
          >
            <LceChart pSeries={p} oSeries={o} />
          </div>
        </div>
      </Panel>
    </PanelGroup>
  );
}

export function LceImagePreview({ entry }: { entry: ImageEntry | undefined }) {
  const { url, loading, error } = useImagePreview(entry?.jpg_path);

  if (!entry) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs"
           style={{ color: "var(--colorNeutralForeground3)" }}>
        请先选择图片文件
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center px-4 text-center text-xs"
           style={{ color: error ? "var(--colorPaletteRedForeground1)" : "var(--colorNeutralForeground3)" }}>
        {loading ? "加载中..." : "图片预览加载失败"}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={entry.name}
      className="max-h-full max-w-full object-contain"
      style={{ display: "block" }}
      draggable={false}
    />
  );
}

function LceImageTableMode({
  entry,
  schema,
  tomlData,
  hideImage = false,
}: {
  entry: ImageEntry | undefined;
  schema: Isp6sSchemaRoot;
  tomlData: Record<string, string>;
  hideImage?: boolean;
}) {
  const url = useImagePreviewUrl(hideImage ? undefined : entry?.jpg_path);

  if (hideImage) {
    return <LcePreviewInfoTable schema={schema} tomlData={tomlData} />;
  }

  return (
    <PanelGroup direction="horizontal" autoSaveId="isp6s-lce-image-table" className="h-full w-full">
      <Panel defaultSize={46} minSize={28}>
        <div className="flex h-full w-full items-center justify-center overflow-hidden p-3">
          {url
            ? <img src={url} alt={entry?.name ?? ""} className="max-h-full max-w-full object-contain" draggable={false} />
            : <span className="text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>请先选择图片文件</span>}
        </div>
      </Panel>

      <ResizeHandle direction="horizontal" size={8} />

      <Panel defaultSize={54} minSize={28}>
        <LcePreviewInfoTable schema={schema} tomlData={tomlData} />
      </Panel>
    </PanelGroup>
  );
}

function LcePreviewInfoTable({
  schema,
  tomlData,
}: {
  schema: Isp6sSchemaRoot;
  tomlData: Record<string, string>;
}) {
  const items = schema.preview_info?.items ?? [];
  return (
    <div className="h-full w-full overflow-auto p-3" data-isp6s-details-scroll="true">
      <table className="w-full text-xs" style={{ fontFamily: "ui-monospace, monospace" }}>
        <tbody>
          {(items as LcePreviewInfoItem[]).map((it, i) => (
            <tr key={`${it.label}-${i}`} style={{ borderBottom: "1px solid var(--colorNeutralStroke3)" }}>
              <td className="whitespace-nowrap px-2 py-1.5 align-top font-semibold"
                  style={{ color: "var(--colorNeutralForeground2)", width: 120 }}>
                {it.label}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5" style={{ color: "var(--colorNeutralForeground1)" }}>
                {formatLcePreviewInfoValue(it, tomlData)}
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td className="p-3 text-center text-xs"
                    style={{ color: "var(--colorNeutralForeground3)" }} colSpan={2}>
              Isp6s.toml 未配置 [[preview_info.items]]
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type LcePreviewInfoItem = {
  label: string;
  toml_key?: string;
  toml_keys?: string[];
};

function formatLcePreviewInfoValue(
  item: LcePreviewInfoItem,
  tomlData: Record<string, string>,
): string {
  if (item.toml_key === "SW_LCE_AEGain") {
    const raw = tomlLookup(tomlData, item.toml_key);
    const aeGain = Number(raw);
    const gain = 10 ** (aeGain / 1024);
    return raw !== "-" && Number.isFinite(aeGain) && Number.isFinite(gain)
      ? `${raw}(${gain.toFixed(2)}xgain)`
      : raw;
  }
  const keys = item.toml_keys?.filter(Boolean) ?? [];
  if (keys.length >= 3) {
    const [valueKey, lowKey, highKey] = keys;
    return `${tomlLookup(tomlData, valueKey)} [${tomlLookup(tomlData, lowKey)}, ${tomlLookup(tomlData, highKey)}]`;
  }
  if (keys.length === 2) {
    return `[${keys.map((key) => tomlLookup(tomlData, key)).join(", ")}]`;
  }
  if (keys.length > 0) {
    return keys.map((key) => tomlLookup(tomlData, key)).join(" / ");
  }
  return tomlLookup(tomlData, item.toml_key);
}

function tomlLookup(tomlData: Record<string, string>, key: string | undefined): string {
  if (!key) return "-";
  const value = tomlData[key] ?? tomlData[key.toLowerCase()];
  if (value !== undefined && value !== "") return value;
  const lowerKey = key.toLowerCase();
  const matched = Object.entries(tomlData).find(([candidate]) =>
    candidate.toLowerCase() === lowerKey || candidate.split(".").pop()?.toLowerCase() === lowerKey);
  return matched?.[1] === undefined || matched[1] === "" ? "-" : matched[1];
}

function getOverlayChrome(): React.CSSProperties {
  const isLight = document.documentElement.classList.contains("light");
  return {
    background: isLight ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.18)",
    borderColor: isLight ? "rgba(138,132,151,0.24)" : "rgba(255,255,255,0.08)",
    backdropFilter: "blur(6px)",
  };
}

function getCurrentImagePickerButtonChrome(open: boolean) {
  const isLight = document.documentElement.classList.contains("light");
  const idleBackground = "transparent";
  const idleBorder = "transparent";
  const hoverBackground = isLight ? "rgba(103, 80, 164, 0.06)" : "rgba(123, 97, 255, 0.10)";
  const hoverBorder = "transparent";

  return {
    background: open ? hoverBackground : idleBackground,
    borderColor: open ? hoverBorder : idleBorder,
    hoverBackground,
    hoverBorderColor: hoverBorder,
  };
}

function imageTableColumnText(
  column: ImageTableColumn,
  data: Record<string, string>,
  target: ReturnType<typeof imageFaceTargetValues> | null | undefined,
  sceneOnly: boolean,
): string {
  if (column.kind === "aeGain" && (!column.sourceOverride || isAeGainPairSource(column.key ?? ""))) {
    return target?.aeGain ?? "-";
  }
  if (column.kind === "ev" && (!column.sourceOverride || isCwrEvFormula(column.key ?? ""))) {
    return formatCwrEvTriplet(target?.normalEv ?? null, target?.backEv ?? null, target?.evPair ?? null);
  }
  if (column.kind === "delta" && (!column.sourceOverride || isCwrDeltaFormula(column.key ?? ""))) {
    return sceneOnly ? formatFaceTargetDelta(target?.normalDelta ?? null) : target?.delta ?? "-";
  }
  if (column.sourceOverride) return customImageColumnText(column.key ?? "", (key) =>
    imageTableFormulaAlias(key, target, sceneOnly) ?? tomlLookup(data, key));
  if (column.kind === "extra") {
    if (column.id.startsWith("custom:")) {
      return customImageColumnText(column.key ?? "", (key) =>
        imageTableFormulaAlias(key, target, sceneOnly) ?? tomlLookup(data, key));
    }
    const sourceLabel = column.originalLabel ?? column.label;
    const keys = (column.key ?? "").split("").filter(Boolean);
    const fallbackKeys: Record<string, string[]> = {
      LV: ["SW_LCE_LV", "SW_LCE_LVIdx_L", "SW_LCE_LVIdx_H"],
      DR: ["SW_LCE_CurrDR", "SW_LCE_DRIdx_L", "SW_LCE_DRIdx_H"],
      D_S_Level: ["SW_LCE_DStrengthLevel"],
      B_S_Level: ["SW_LCE_BStrengthLevel"],
      Target: ["SW_LCE_FinalTarget"],
      AEGain: ["SW_LCE_AEGain"],
    };
    const resolvedKeys = keys.length > 0 ? keys : (fallbackKeys[sourceLabel] ?? []);
    const fallback = fallbackKeys[sourceLabel] ?? [];
    if (resolvedKeys.length === 1 && tomlLookup(data, resolvedKeys[0]) === "-" && fallback.length > 0) {
      return tomlLookup(data, fallback[0]);
    }
    if (resolvedKeys.length > 1) {
      return formatLcePreviewInfoValue({ label: sourceLabel, toml_keys: resolvedKeys }, data);
    }
    if (resolvedKeys.length === 1 && sourceLabel === "AEGain") {
      return formatLcePreviewInfoValue({ label: "AEGain", toml_key: resolvedKeys[0] }, data);
    }
    if (resolvedKeys.length === 1) return tomlLookup(data, resolvedKeys[0]);
    return "-";
  }
  if (column.kind === "aeGain") return target?.aeGain ?? "-";
  if (column.kind === "normalCwr") return target?.normalCwr ?? "-";
  if (column.kind === "backCwr") return target?.backCwr ?? "-";
  if (column.kind === "cwr") return target?.cwr ?? "-";
  if (column.kind === "delta") {
    return sceneOnly ? formatFaceTargetDelta(target?.normalDelta ?? null) : target?.delta ?? "-";
  }
  if (column.kind === "ev") return formatDeltaEv(selectImageTableEv(sceneOnly, undefined,
    target?.normalEv ?? null, target?.evPair ?? null));
  return "-";
}

function imageTableFormulaAlias(
  key: string,
  target: ReturnType<typeof imageFaceTargetValues> | null | undefined,
  sceneOnly: boolean,
): string | null {
  const pairs: Record<string, string | undefined> = {
    Normal: target?.normalCwr,
    BackTar: target?.backCwr,
    FLinkTar: target?.cwr,
    CWR: sceneOnly ? target?.normalCwr : target?.cwr,
    AEGain: target?.aeGain,
  };
  const match = /^(Normal|BackTar|FLinkTar|CWR|AEGain)_(old|new)$/.exec(key);
  if (!match) return null;
  const pair = /^([^()]*)\(([^()]*)\)$/.exec(pairs[match[1]] ?? "");
  return pair?.[match[2] === "old" ? 1 : 2] || "-";
}

function expandImageColumnKeys(columns: ReadonlyArray<ReadonlyArray<string>>): string[] {
  return [...new Set(columns.flatMap(([, key]) => key.split("").filter(Boolean)))];
}

let imageColumnMeasureContext: CanvasRenderingContext2D | null = null;
function estimateImageColumnTextWidth(value: string): number {
  if (!imageColumnMeasureContext) {
    imageColumnMeasureContext = document.createElement("canvas").getContext("2d");
    if (imageColumnMeasureContext) imageColumnMeasureContext.font = '13px "Segoe UI", Arial, sans-serif';
  }
  if (imageColumnMeasureContext) {
    return Math.ceil(imageColumnMeasureContext.measureText(value || "-").width + 20);
  }
  return Math.ceil((value || "-").length * 8 + 20);
}

function mergeImageTableColumnOrder(saved: string[], defaults: string[]): string[] {
  const next = saved.filter((id, index) => defaults.includes(id) && saved.indexOf(id) === index);
  for (const id of defaults) {
    if (next.includes(id)) continue;
    const defaultIndex = defaults.indexOf(id);
    const precedingId = defaults
      .slice(0, defaultIndex)
      .reverse()
      .find((candidate) => next.includes(candidate));
    if (precedingId) {
      next.splice(next.indexOf(precedingId) + 1, 0, id);
      continue;
    }
    const followingId = defaults
      .slice(defaultIndex + 1)
      .find((candidate) => next.includes(candidate));
    next.splice(followingId ? next.indexOf(followingId) : next.length, 0, id);
  }
  if (defaults.includes("idx")) {
    return ["idx", ...(defaults.includes("thumbnail") ? ["thumbnail"] : []),
      ...(defaults.includes("name") ? ["name"] : []),
      ...next.filter((id) => id !== "idx" && id !== "thumbnail" && id !== "name")];
  }
  return next;
}

function readImageTableSortControlsEnabled(): boolean {
  try {
    const stored = window.localStorage.getItem(IMAGE_TABLE_SORT_CONTROLS_STORAGE_KEY);
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

function writeImageTableSortControlsEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(IMAGE_TABLE_SORT_CONTROLS_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore storage failures; the in-memory state still works for this mount.
  }
}

function parseImageSortNumber(value: string | undefined): number | null {
  const text = (value ?? "").trim();
  if (!text || text === "-") return null;
  const normalised = text.replace(/[,_\s]/g, "");
  const direct = Number(normalised);
  if (Number.isFinite(direct)) return direct;
  const matched = text.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i)?.[0];
  if (!matched) return null;
  const parsed = Number(matched);
  return Number.isFinite(parsed) ? parsed : null;
}

function ImageSortHeader({
  label,
  align,
  active,
  direction,
  loading,
  onClick,
  onReset,
}: {
  label: string;
  align: "left" | "center";
  active: boolean;
  direction: ImageSortDirection;
  loading: boolean;
  onClick: () => void;
  onReset: () => void;
}) {
  const tooltip = `${label} 数值${active && direction === "desc" ? "逆序" : "正序"}排序，右键恢复 IDX 顺序`;
  return (
    <HoverTooltip content={tooltip} positioning="below-center" inline>
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded px-0.5 py-0 text-xs font-semibold uppercase transition-colors"
        style={{
          background: "transparent",
          border: 0,
          cursor: "pointer",
          justifyContent: align === "center" ? "center" : "flex-start",
          color: active ? "var(--colorBrandForeground1)" : "inherit",
          opacity: loading ? 0.68 : 1,
        }}
        aria-label={tooltip}
        onClick={onClick}
        onContextMenu={(event) => {
          event.preventDefault();
          onReset();
        }}
      >
        <span className="min-w-0 truncate">{label}</span>
        <span className="flex shrink-0 flex-col leading-none" aria-hidden="true">
          <ChevronUp24Regular
            className="h-2.5 w-2.5"
            style={{ opacity: active && direction === "asc" ? 1 : 0.32 }}
          />
          <ChevronDown24Regular
            className="h-2.5 w-2.5"
            style={{ marginTop: -3, opacity: active && direction === "desc" ? 1 : 0.32 }}
          />
        </span>
      </button>
    </HoverTooltip>
  );
}

function Th({
  children,
  align = "left",
  onResizeStart,
  columnId,
  dragOver = false,
  stickyLeft,
  onPointerDown,
}: {
  children: React.ReactNode;
  align?: "left" | "center";
  onResizeStart?: (event: ReactPointerEvent<HTMLSpanElement>) => void;
  columnId?: string;
  dragOver?: boolean;
  stickyLeft?: number;
  onPointerDown?: (event: ReactPointerEvent<HTMLTableCellElement>) => void;
}) {
  return (
    <th
        className="relative overflow-hidden text-ellipsis whitespace-nowrap px-2 py-1 text-xs font-semibold"
        data-image-table-column-id={columnId}
        onPointerDown={onPointerDown}
        style={{
          borderRight: "1px solid var(--colorNeutralStroke2)",
          borderBottom: "2px solid var(--colorNeutralStroke1)",
          height: IMAGE_TABLE_HEADER_HEIGHT,
          boxSizing: "border-box",
          position: "sticky",
          top: 0,
          left: stickyLeft,
          zIndex: stickyLeft !== undefined ? (stickyLeft === 0 ? 7 : 6) : 5,
          background: dragOver ? "var(--colorBrandBackground2)"
            : columnId === "idx" ? IMAGE_TABLE_CORNER_BACKGROUND : "var(--colorNeutralBackground2)",
          color: columnId === "idx" ? "var(--colorNeutralForeground1)" : undefined,
          boxShadow: dragOver ? "inset 2px 0 0 var(--colorBrandForeground1)" : undefined,
          cursor: onPointerDown ? "grab" : undefined,
        }}>
      <span style={{ display: "block", textAlign: align }}>{children}</span>
      {onResizeStart && (
        <span
          role="separator"
          aria-orientation="vertical"
          title="拖拽调整列宽"
          onPointerDown={onResizeStart}
          style={{
            position: "absolute",
            top: 0,
            right: -3,
            zIndex: 2,
            width: 7,
            height: "100%",
            cursor: "col-resize",
            touchAction: "none",
          }}
        />
      )}
    </th>
  );
}

function Td({
  children,
  align = "left",
  compact = false,
  stickyLeft,
  stickyBackground,
  selected = false,
  selectedBody = false,
  selectedOutlineStart = false,
  selectedOutlineEnd = false,
  title,
}: {
  children: React.ReactNode;
  align?: "left" | "center";
  compact?: boolean;
  stickyLeft?: number;
  stickyBackground?: string;
  selected?: boolean;
  selectedBody?: boolean;
  selectedOutlineStart?: boolean;
  selectedOutlineEnd?: boolean;
  title?: string;
}) {
  return (
    <td className={`${compact ? "px-px" : "px-2"} ${selectedBody ? "py-px" : "py-0.5"}`}
        style={{
          borderTop: selectedBody ? "2px dashed var(--colorBrandStroke1)" : undefined,
          borderRight: selectedBody
            ? selectedOutlineEnd ? "2px dashed var(--colorBrandStroke1)" : `1px solid ${IMAGE_TABLE_SELECTED_COLUMN_STROKE}`
            : "1px solid var(--colorNeutralStroke2)",
          borderBottom: selectedBody ? "2px dashed var(--colorBrandStroke1)" : "1px solid var(--colorNeutralStroke2)",
          borderLeft: selectedBody && selectedOutlineStart ? "2px dashed var(--colorBrandStroke1)" : undefined,
          textAlign: align,
          whiteSpace: "nowrap",
          height: IMAGE_TABLE_ROW_HEIGHT,
          boxSizing: "border-box",
          position: stickyLeft !== undefined ? "sticky" : undefined,
          left: stickyLeft,
          zIndex: stickyLeft !== undefined ? (stickyLeft === 0 ? 3 : 2) : undefined,
          background: selectedBody || stickyLeft !== undefined ? stickyBackground : undefined,
          boxShadow: selected ? "inset 3px 0 0 var(--colorBrandStroke1)"
            : stickyLeft !== undefined && stickyLeft === 0 ? "inset -1px 0 0 var(--colorNeutralStroke2)" : undefined,
        }}>
      <span className={compact ? "flex min-w-0 items-center justify-center overflow-hidden" : "block min-w-0 truncate"}
        title={title} data-tooltip-truncated={title ? "true" : undefined}>{children}</span>
    </td>
  );
}

function matchExt(path: string, exts: string[]): boolean {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = lower.slice(dot + 1);
  return exts.includes(ext);
}

function classifyImageDrop(paths: string[]): "ok" | "bad" {
  if (paths.length === 0) return "bad";
  return paths.every((path) => matchExt(path, IMG_EXTS) || looksLikeDirectory(path))
    ? "ok"
    : "bad";
}

function looksLikeDirectory(path: string): boolean {
  const dot = path.lastIndexOf(".");
  const slashes = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return dot < 0 || dot < slashes;
}

function getPathBaseName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || path;
}
