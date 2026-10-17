import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@fluentui/react-components";
import {
  ChevronDown24Regular,
  ChevronUp24Regular,
  Target24Regular,
  Image24Regular,
  ImageMultiple24Regular,
  Person24Regular,
  TableSimple24Regular,
  ChartMultiple24Regular,
  FolderAdd24Regular,
  DocumentData24Regular,
  CalculatorArrowClockwise24Regular,
  Search24Regular,
} from "@fluentui/react-icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Panel, PanelGroup } from "react-resizable-panels";

import { loadImageThumbnailBatch, loadImageTomlFieldsBatchShared, type ImageEntry } from "@/ipc/imageScan";
import { useImagePreview, useImagePreviewUrl } from "@/hooks/useImagePreviewUrl";
import { ensureDirectory } from "@/ipc/shell";
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { LceChart } from "./LceChart";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import { ImageSplitMode } from "../ImagePane/ImageSplitMode";
import { classifyImageTableRow, shouldShowImageTableRow, type ImageTableKind } from "./imageTableClassification";
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
type ImageTableColumnKind = "idx" | "thumbnail" | "name" | "aeGain" | "normalCwr" | "backCwr" | "cwr" | "delta" | "extra";
type ImageTableColumn = {
  id: string;
  kind: ImageTableColumnKind;
  label: string;
  key?: string;
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
  onPickImage: (idx: number) => void;
  onImageDirChange: (dir: string) => void;
  imageSearchQuery: string;
  imageSearchError: string | null;
  onImageSearchQueryChange: (value: string) => void;
  onImageSearch: () => void;
  onParseExif: () => void;
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
const IMAGE_TABLE_ROW_HEIGHT = 58;
const IMAGE_TABLE_THUMBNAIL_SIZE = 48;
const IMAGE_TABLE_THUMBNAIL_COLUMN_WIDTH = IMAGE_TABLE_THUMBNAIL_SIZE + 10;
const IMAGE_TABLE_OVERSCAN = 12;
const IMAGE_TABLE_LOAD_DEBOUNCE_MS = 8;
const IMAGE_TABLE_FIELD_CACHE_LIMIT = 768;
const IMAGE_TABLE_PREFETCH_DELAY_MS = 90;
const IMAGE_TABLE_PREFETCH_MIN_ROWS = 96;
const IMAGE_TABLE_PREFETCH_PAGES = 3;
const IMAGE_TABLE_SORT_CONTROLS_STORAGE_KEY = "luxe:isp6s:image-table-sort-controls";
const IMAGE_TABLE_COLUMN_ORDER_STORAGE_KEY = "luxe:isp6s:image-table-column-order";
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
  "AE_TAG_DRV6_B2D", "AE_TAG_DRV6_B2M", "AE_TAG_DRV6_MIDRATIO", "AE_TAG_HS_EVD",
  "AE_TAG_NS_STS_CDF", "AE_TAG_NS_EVD",
  "NS_OE_THD", "AE_TAG_NS_NORMAL_FINAL_THD", "NS_Y", "AE_TAG_NS_NORMAL_Y",
  "NS_BrightTone_THD", "AE_TAG_NS_BT_FINAL_THD", "NS_BrightTone_Y", "AE_TAG_NS_BT_Y",
  "NS_LOWBND_THD", "AE_TAG_NS_DT_THD", "NS_LOWBND_Y", "AE_TAG_NS_DT_Y",
] as const;
type FaceTargetPair = { exif: number; calculated: number };
type FaceLinkTargetCalculator = (
  tomlData: Record<string, string>, bvKey: string,
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

function faceTargetDeltaStyle(value: number | null): React.CSSProperties | undefined {
  return value !== null && Math.abs(value) > 2
    ? { color: "var(--colorPaletteRedForeground1)" } : undefined;
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
  return {
    aeGain: formatFaceTargetPair(faceTargetRatio(linkExif, backExif), faceTargetRatio(linkCalculated, backCalculated)),
    normalCwr: formatFaceTargetPair(normalExif, normalCalculated),
    backCwr: formatFaceTargetPair(backExif, backCalculated),
    cwr: formatFaceTargetPair(linkExif, linkCalculated),
    delta: `${formatFaceTargetDelta(normalDelta)}|${formatFaceTargetDelta(backDelta)}|${formatFaceTargetDelta(linkDelta)}`,
    normalDelta,
    backDelta,
    linkDelta,
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
  imageSearchQuery,
  imageSearchError,
  onImageSearchQueryChange,
  onImageSearch,
  onParseExif,
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
  const [appliedCalculatorSourcePath, setAppliedCalculatorSourcePath] = useState<string | null>(null);
  const [parseProgress, setParseProgress] = useState<{ done: number; total: number; error?: string } | null>(null);

  useEffect(() => {
    setAppliedCalculatorSourcePath(null);
    setApplyAllVersion(0);
  }, [filePath]);

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
           borderRadius: 12,
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
            <span style={{ color: "var(--colorPaletteGreenForeground1)", whiteSpace: "nowrap" }}>
              已选中 {selectedHeatmapPaths.length} 张
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="small" appearance="subtle" style={{ width: 28, minWidth: 28, height: 28, padding: 0 }} icon={<DocumentData24Regular className="h-4 w-4" />}
            title={exifParsing ? "正在解析图片 EXIF" : "解析图片 EXIF"}
            disabled={entries.length === 0 || exifParsing}
            onClick={onParseExif} aria-label="解析图片 EXIF" />
          {!toneMode && <Button size="small" appearance="subtle" style={{ width: 28, minWidth: 28, height: 28, padding: 0 }} icon={<CalculatorArrowClockwise24Regular className="h-4 w-4" />}
            title="Apply all image: 使用当前参数重新计算 CWR 和 ∆CWR"
            disabled={entries.length === 0 || !calculatorSourcePath || Boolean(parseProgress && parseProgress.done < parseProgress.total)}
            onClick={() => {
              setAppliedCalculatorSourcePath(calculatorSourcePath);
              setApplyAllVersion((version) => version + 1);
              setParseAllVersion((version) => version + 1);
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
          aria-invalid={Boolean(imageSearchError)}
          title={imageSearchError ?? "输入图片名称后按 Enter 搜索"}
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
        <ImageTab schema={schema} toneMode={toneMode} filePath={toneMode ? null : filePath} calculatorSourcePath={appliedCalculatorSourcePath}
          parseAllVersion={parseAllVersion} applyAllVersion={applyAllVersion} onParseProgress={setParseProgress}
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
  const thumbnailSize = Math.max(1, Math.min(IMAGE_TABLE_THUMBNAIL_SIZE, columnWidth - 10));

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
    <span style={{
      display: "inline-flex",
      width: thumbnailSize,
      height: thumbnailSize,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      background: "var(--colorNeutralBackground3)",
      border: "1px solid var(--colorNeutralStroke2)",
    }}>
      {url ? <img src={url} alt={entry.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} draggable={false} /> : <Image24Regular />}
    </span>
  );
}

export function ImageTab({
  schema, toneMode = false, filePath, cppImportRevision, calculatorSourcePath, parseAllVersion = 0, applyAllVersion = 0, onParseProgress,
  entries, current, selectedHeatmapPaths, onPick, onVisibleHeatmapPathsChange,
  imageDataRevision = 0,
  scrollPosition,
  onScrollPositionChange,
}: {
  schema:   Isp6sSchemaRoot;
  toneMode?: boolean;
  filePath: string | null;
  cppImportRevision: number;
  calculatorSourcePath?: string | null;
  parseAllVersion?: number;
  applyAllVersion?: number;
  onParseProgress?: (progress: { done: number; total: number; error?: string } | null) => void;
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
  const filterMountedRef = useRef(false);
  const tableWindowPathsRef = useRef<string[]>([]);
  const tableFieldCacheRef = useRef<Record<string, Record<string, string>>>({});
  const tableFieldAccessOrderRef = useRef<string[]>([]);
  const tableTomlPathSetRef = useRef<Set<string>>(new Set());
  const loadingTableFieldPathsRef = useRef<Set<string>>(new Set());
  const tableFieldKeySignatureRef = useRef("");
  const scrollTopRef = useRef(0);
  const scrollDirectionRef = useRef<1 | -1>(1);
  const lastViewportHeightRef = useRef(0);
  const tableViewportFrameRef = useRef<number | null>(null);
  const pendingViewportReloadRef = useRef(false);
  const sortRequestRef = useRef(0);
  const extraCols = useMemo(
    () => toneMode ? [] : Object.entries(schema.Image ?? {}),
    [schema, toneMode],
  );
  const faceBvKey = schema.Image?.BV ?? "AE_TAG_REALBVX1000";
  const faceFdyKey = schema.Image?.FDY ?? "AE_TAG_FLT_FDY";
  const tableColumns = useMemo<ImageTableColumn[]>(
    () => [
      { id: "idx", kind: "idx", label: "idx", align: "center" },
      { id: "thumbnail", kind: "thumbnail", label: "Thumbnail", align: "center" },
      { id: "name", kind: "name", label: "FileName", align: "left" },
      ...(!toneMode ? [
        { id: "aeGain", kind: "aeGain" as const, label: "AEGain(new)", align: "center" as const },
        { id: "normalCwr", kind: "normalCwr" as const, label: "CWR(Normal)", align: "center" as const },
        { id: "backCwr", kind: "backCwr" as const, label: "CWR(BackTar)", align: "center" as const },
        { id: "cwr", kind: "cwr" as const, label: "CWR(FLinkTar)", align: "center" as const },
        { id: "delta", kind: "delta" as const, label: "∆CWR", align: "center" as const },
      ] : []),
      ...extraCols.map(([label, key], index) => ({
        id: `extra:${key}`,
        kind: "extra" as const,
        label,
        key,
        align: index < 2 ? "center" as const : "left" as const,
      })),
    ],
    [extraCols, toneMode],
  );
  const [columnOrder, setColumnOrder] = useState<string[]>(readImageTableColumnOrder);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const columnDragRef = useRef<ImageTableColumnDragState | null>(null);
  const suppressColumnClickRef = useRef(false);
  const orderedColumns = useMemo(
    () => mergeImageTableColumnOrder(
      columnOrder,
      tableColumns.map((column) => column.id),
    ).map((id) => tableColumns.find((column) => column.id === id))
      .filter((column): column is ImageTableColumn => Boolean(column)),
    [columnOrder, tableColumns],
  );
  const imageTomlKeys = useMemo(
    () => toneMode ? [] : [...new Set([...extraCols.map(([, key]) => key), faceBvKey, ...FACE_LINK_TARGET_IMAGE_KEYS])]
      .filter((key) => key.length > 0),
    [extraCols, faceBvKey, toneMode],
  );
  const imageTomlKeySignature = useMemo(
    () => imageTomlKeys.join("\u001f"),
    [imageTomlKeys],
  );
  const [tomls, setTomls] = useState<Record<string, Record<string, string>>>({});
  const [parsedTomls, setParsedTomls] = useState<{
    entries: ImageEntry[];
    keySignature: string;
    rows: Record<string, Record<string, string>>;
  } | null>(null);
  const [faceLinkTargetState, setFaceLinkTargetState] = useState<{
    filePath: string | null;
    calculate: FaceLinkTargetCalculator;
  } | null>(null);
  const requestedCalculatorPath = applyAllVersion > 0 ? calculatorSourcePath ?? null : filePath;
  const faceLinkTargetCalculator = faceLinkTargetState && faceLinkTargetState.filePath === requestedCalculatorPath
    ? faceLinkTargetState.calculate
    : null;
  const allParsedRows = parsedTomls?.entries === entries && parsedTomls.keySignature === imageTomlKeySignature
    ? parsedTomls.rows : null;
  const allTargets = useMemo(() => {
    if (!allParsedRows || !faceLinkTargetCalculator) return null;
    return Object.fromEntries(entries.map((entry) => [
      entry.toml_path,
      faceLinkTargetCalculator(allParsedRows[entry.toml_path] ?? {}, faceBvKey),
    ]));
  }, [allParsedRows, entries, faceBvKey, faceLinkTargetCalculator]);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [tableReloadVersion, setTableReloadVersion] = useState(0);
  const [sortState, setSortState] = useState<ImageSortState | null>(null);
  const [sortValues, setSortValues] = useState<Record<string, string>>({});
  const [sortLoading, setSortLoading] = useState(false);
  const [sortControlsEnabled, setSortControlsEnabled] = useState(readImageTableSortControlsEnabled);
  const [showScene, setShowScene] = useState(true);
  const [showPortrait, setShowPortrait] = useState(true);
  const [imageKinds, setImageKinds] = useState<{
    entries: ImageEntry[];
    keySignature: string;
    revision: number;
    calculator: FaceLinkTargetCalculator;
    byPath: Record<string, ImageTableKind>;
  } | null>(null);
  const [columnWidthOverrides, setColumnWidthOverrides] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const saved = restoreScrollRef.current;
    if (!el || !saved) return;
    el.scrollTop = saved.top;
    el.scrollLeft = saved.left;
    scrollTopRef.current = el.scrollTop;
    setScrollTop(el.scrollTop);
    restoreScrollRef.current = null;
  }, [entries]);

  useEffect(() => {
    setShowScene(true);
    setShowPortrait(true);
  }, [entries, imageDataRevision]);

  useEffect(() => {
    if (!faceLinkTargetCalculator || toneMode || entries.length === 0) return;
    const savedKinds = globalImageKinds.get(entries);
    if (savedKinds?.revision === imageDataRevision
      && savedKinds.keySignature === imageTomlKeySignature
      && savedKinds.calculator === faceLinkTargetCalculator
      && !allParsedRows) {
      setImageKinds({ entries, ...savedKinds });
      return;
    }
    let cancelled = false;
    const publishKinds = (byPath: Record<string, ImageTableKind>) => {
      const result = { keySignature: imageTomlKeySignature, revision: imageDataRevision, calculator: faceLinkTargetCalculator, byPath };
      globalImageKinds.set(entries, result);
      setImageKinds({ entries, ...result });
    };
    const extraKeys = extraCols.map(([, key]) => key);
    const classifyBatch = (rows: Record<string, Record<string, string>>, byPath: Record<string, ImageTableKind>) => {
      for (const [path, data] of Object.entries(rows)) {
        if (path in byPath) continue;
        const face = imageFaceTargetValues(faceLinkTargetCalculator(data, faceBvKey));
        byPath[path] = classifyImageTableRow(data, face, faceFdyKey, extraKeys);
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
  }, [allParsedRows, entries, extraCols, faceBvKey, faceFdyKey, faceLinkTargetCalculator, imageDataRevision, imageTomlKeySignature, imageTomlKeys, toneMode]);

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
  const requestedKindFilter = showScene && !showPortrait ? "scene"
    : showPortrait && !showScene ? "portrait" : "all";
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
  const displayedColumns = useMemo(() => orderedColumns.filter((column) => !sceneOnly || (
    column.kind !== "aeGain" && column.kind !== "backCwr" && column.kind !== "cwr"
    && column.label !== "FaceSt" && column.label !== "1sSt"
  )), [orderedColumns, sceneOnly]);

  useEffect(() => {
    let cancelled = false;
    const calculatorRevision = `${cppImportRevision}:${applyAllVersion}`;
    getFaceCalculator(requestedCalculatorPath, calculatorRevision)
      .then((calculate) => {
        if (!cancelled) setFaceLinkTargetState({ filePath: requestedCalculatorPath, calculate });
      })
      .catch(() => {
        if (!cancelled) setFaceLinkTargetState(null);
      });
    return () => { cancelled = true; };
  }, [filePath, requestedCalculatorPath, applyAllVersion, cppImportRevision]);

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
        if (!cancelled) setParsedTomls({ entries, keySignature, rows });
      } catch (error) {
        if (!cancelled) onParseProgress?.({
          done: paths.length, total: paths.length,
          error: error instanceof Error ? error.message : String(error),
        });
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

  const currentDisplayIndex = useMemo(
    () => sortedRows.findIndex((row) => row.i === current),
    [current, sortedRows],
  );
  const selectedRowVisible = currentDisplayIndex >= 0 && viewportHeight > IMAGE_TABLE_HEADER_HEIGHT
    && IMAGE_TABLE_HEADER_HEIGHT + (currentDisplayIndex + 1) * IMAGE_TABLE_ROW_HEIGHT > scrollTop + IMAGE_TABLE_HEADER_HEIGHT
    && IMAGE_TABLE_HEADER_HEIGHT + currentDisplayIndex * IMAGE_TABLE_ROW_HEIGHT < scrollTop + viewportHeight;
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

  useEffect(() => {
    const nextOrder = mergeImageTableColumnOrder(
      columnOrder,
      tableColumns.map((column) => column.id),
    );
    if (!areImageTableColumnOrdersEqual(columnOrder, nextOrder)) {
      setColumnOrder(nextOrder);
    }
  }, [columnOrder, tableColumns]);

  useEffect(() => {
    writeImageTableColumnOrder(columnOrder);
  }, [columnOrder]);

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
    const stillSortable = extraCols.some(([col, key]) =>
      col === sortState.column && key === sortState.key,
    );
    if (!stillSortable) {
      setSortState(null);
    }
  }, [extraCols, sortControlsEnabled, sortState]);

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
    loadImageTomlFieldsBatchShared(paths, [sortKey])
      .then((batch) => {
        if (sortRequestRef.current !== requestId) return;
        const nextValues: Record<string, string> = {};
        for (const entry of entries) {
          nextValues[entry.toml_path] = batch[entry.toml_path]?.[sortKey] ?? "";
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
    setColumnOrder((current) => {
      const next = mergeImageTableColumnOrder(
        current,
        tableColumns.map((column) => column.id),
      );
      const firstIndex = next.indexOf(firstId);
      const secondIndex = next.indexOf(secondId);
      if (firstIndex < 0 || secondIndex < 0) return current;
      [next[firstIndex], next[secondIndex]] = [next[secondIndex], next[firstIndex]];
      return next;
    });
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
    if (!preserveRestoredScrollRef.current && currentDisplayIndex >= 0) {
      ensureImageTableRowVisible(currentDisplayIndex);
    }
  }, [currentDisplayIndex]);

  useEffect(() => {
    if (!filterMountedRef.current) {
      filterMountedRef.current = true;
      return;
    }
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    scrollTopRef.current = 0;
    setScrollTop(0);
  }, [showScene, showPortrait]);

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
  const topPadding = visible.start * IMAGE_TABLE_ROW_HEIGHT;
  const bottomPadding = Math.max(0, (sortedRows.length - visible.end) * IMAGE_TABLE_ROW_HEIGHT);
  const nameColumnWidth = useMemo(() => entries.reduce(
    (width, entry) => Math.max(width, estimateImageColumnTextWidth(entry.name)),
    estimateImageColumnTextWidth("FileName") + (sortControlsEnabled ? 16 : 0),
  ), [entries, sortControlsEnabled]);
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
      let width = Math.max(minWidth, headerWidth);
      if (column.kind === "idx") {
        byId[column.id] = Math.max(width, estimateImageColumnTextWidth(String(entries.length)));
        continue;
      }
      for (const { e: entry } of visible.rows) {
        const target = visibleFaceValues[entry.toml_path];
        const text = column.kind === "extra" ? allParsedRows?.[entry.toml_path]?.[column.key ?? ""] ?? tomls[entry.toml_path]?.[column.key ?? ""] ?? "-"
          : column.kind === "aeGain" ? target?.aeGain ?? "-"
          : column.kind === "normalCwr" ? target?.normalCwr ?? "-"
          : column.kind === "backCwr" ? target?.backCwr ?? "-"
          : column.kind === "cwr" ? target?.cwr ?? "-"
          : sceneOnly ? formatFaceTargetDelta(target?.normalDelta ?? null) : target?.delta ?? "-";
        width = Math.max(width, estimateImageColumnTextWidth(text));
      }
      byId[column.id] = width;
    }
    return { byId };
  }, [allParsedRows, entries.length, nameColumnWidth, sceneOnly, sortControlsEnabled, tableColumns, tomls, visible.rows, visibleFaceValues]);

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
        const nextWidth = Math.max(minWidth, Math.min(640, initialWidth + moveEvent.clientX - startX));
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
        const nextScrollTop = event.currentTarget.scrollTop;
        onScrollPositionChange?.({ top: nextScrollTop, left: event.currentTarget.scrollLeft });
        scrollDirectionRef.current = nextScrollTop >= scrollTopRef.current ? 1 : -1;
        scrollTopRef.current = nextScrollTop;
        setScrollTop(nextScrollTop);
      }}
    >
      <table className="w-full border-collapse text-xs"
           style={{
                fontFamily: '"Segoe UI", Arial, sans-serif',
                fontSize: 13,
                color: "var(--colorNeutralForeground1)",
                background: "var(--colorNeutralBackground1)",
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
          position: "sticky", top: 0, zIndex: 3,
          }}>
          <tr>
            {displayedColumns.map((column) => {
              const active = column.kind === "extra" && sortState?.key === column.key;
              const minWidth = column.kind === "idx"
                ? 34
                : column.kind === "thumbnail"
                  ? IMAGE_TABLE_THUMBNAIL_COLUMN_WIDTH
                  : column.kind === "name"
                    ? 120
                    : 52;
              return (
                <Th
                  key={column.id}
                  columnId={column.id}
                  align={column.align}
                  dragOver={dragOverColumnId === column.id}
                  stickyLeft={column.kind === "idx" ? 0 : column.kind === "thumbnail" ? columnWidths.byId.idx ?? 34 : undefined}
                  onPointerDown={column.kind === "idx" || column.kind === "thumbnail" ? undefined : startImageTableColumnDrag(column.id)}
                  onResizeStart={startColumnResize(column.id, columnWidths.byId[column.id], minWidth)}
                >
                  {column.kind === "idx" ? (
                    <HoverTooltip content="IDX 原始顺序" positioning="below-center" inline>
                      <span>idx</span>
                    </HoverTooltip>
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
                        onClick={() => { if (canFilterKinds) { setShowScene(true); setShowPortrait(true); } }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          if (!canFilterKinds) return;
                          const next = bothKinds ? (activeKindFilter === "scene" ? "portrait" : "scene")
                            : activeKindFilter === "all" ? (hasScene ? "scene" : "portrait") : "all";
                          setShowScene(next !== "portrait");
                          setShowPortrait(next !== "scene");
                        }}
                      >
                        {thumbnailHeaderKind === "scene" ? <SceneLeafProtectIcon />
                          : thumbnailHeaderKind === "portrait" ? <Person24Regular className="h-4 w-4" aria-hidden="true" />
                            : <Image24Regular className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    </span>
                  ) : column.kind === "name" ? (
                    <ImageSortToggleHeader
                      enabled={sortControlsEnabled}
                      onToggle={toggleImageSortControls}
                      label={column.label}
                    />
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
                     background: i === current ? "var(--colorBrandBackground2)" : heatmapSelected ? "var(--colorPaletteGreenBackground1)" : "transparent",
                     color: i === current ? "var(--colorNeutralForegroundOnBrand)" : "var(--colorNeutralForeground1)",
                   }}>
                 {displayedColumns.map((column) => (
                   <Td
                     key={column.id}
                     align={column.align}
                     compact={column.kind === "thumbnail"}
                     stickyLeft={column.kind === "idx" ? 0 : column.kind === "thumbnail" ? columnWidths.byId.idx ?? 34 : undefined}
                     stickyBackground={i === current ? "var(--colorBrandBackground)" : heatmapSelected ? "var(--colorPaletteGreenBackground1)" : "var(--colorNeutralBackground3)"}
                   >
                     {column.kind === "idx"
                       ? i + 1
                       : column.kind === "thumbnail"
                         ? <ImageTableThumbnail entry={e} columnWidth={columnWidths.byId[column.id] ?? 72} />
                         : column.kind === "name"
                           ? e.name
                           : column.kind === "aeGain"
                             ? target?.aeGain ?? "-"
                           : column.kind === "normalCwr"
                             ? target?.normalCwr ?? "-"
                           : column.kind === "backCwr"
                             ? target?.backCwr ?? "-"
                           : column.kind === "cwr"
                             ? target?.cwr ?? "-"
                             : column.kind === "delta" && sceneOnly
                               ? <span style={faceTargetDeltaStyle(target?.normalDelta ?? null)}>{formatFaceTargetDelta(target?.normalDelta ?? null)}</span>
                             : column.kind === "delta"
                               ? <><span style={faceTargetDeltaStyle(target?.normalDelta ?? null)}>{formatFaceTargetDelta(target?.normalDelta ?? null)}</span>
                                   <span>|</span>
                                   <span style={faceTargetDeltaStyle(target?.backDelta ?? null)}>{formatFaceTargetDelta(target?.backDelta ?? null)}</span>
                                   <span>|</span>
                                   <span style={faceTargetDeltaStyle(target?.linkDelta ?? null)}>{formatFaceTargetDelta(target?.linkDelta ?? null)}</span></>
                               : data[column.key ?? ""] ?? "-"}
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
          {entries.length === 0 && (
            <tr><td className="p-4 text-center"
                    style={{ color: "var(--colorNeutralForeground3)" }}
                    colSpan={colSpan}>
              拖入图片文件夹，或点击上方路径文本加载图片
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
    {currentDisplayIndex >= 0 && (
      <button
        type="button"
        className="absolute bottom-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border shadow-md transition-transform hover:scale-105"
        style={{
          background: selectedRowVisible ? "var(--colorBrandBackground)" : "var(--colorNeutralBackground1)",
          color: selectedRowVisible ? "var(--colorNeutralForegroundOnBrand)" : "var(--colorBrandForeground1)",
          borderColor: selectedRowVisible ? "var(--colorBrandStroke1)" : "var(--colorNeutralStroke1)",
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
          : <Target24Regular className="h-5 w-5" aria-hidden="true" />}
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
  return value === undefined || value === "" ? "-" : value;
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

function estimateImageColumnTextWidth(value: string): number {
  const text = value || "-";
  let width = 0;
  for (const ch of text) {
    width += ch.charCodeAt(0) > 255 ? 12 : 7;
  }
  return Math.ceil(width + 18);
}

function readImageTableColumnOrder(): string[] {
  try {
    const stored = window.localStorage.getItem(IMAGE_TABLE_COLUMN_ORDER_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function writeImageTableColumnOrder(order: string[]) {
  try {
    window.localStorage.setItem(IMAGE_TABLE_COLUMN_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // Ignore storage failures; the in-memory order still works for this mount.
  }
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
      ...next.filter((id) => id !== "idx" && id !== "thumbnail")];
  }
  return next;
}

function areImageTableColumnOrdersEqual(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every((id, index) => id === second[index]);
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

function ImageSortToggleHeader({
  enabled,
  label,
  onToggle,
}: {
  enabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  const tooltip = enabled ? "关闭其它列排序按钮" : "开启其它列排序按钮";
  return (
    <HoverTooltip content={tooltip} positioning="below-center" inline>
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1 rounded px-0.5 py-0 text-xs font-semibold uppercase transition-colors"
        style={{
          background: "transparent",
          border: 0,
          cursor: "pointer",
          color: enabled ? "var(--colorBrandForeground1)" : "inherit",
          opacity: enabled ? 1 : 0.62,
        }}
        aria-label={tooltip}
        onClick={onToggle}
      >
        <span>{label}</span>
        <span className="flex shrink-0 flex-col leading-none" aria-hidden="true">
          <ChevronUp24Regular
            className="h-2.5 w-2.5"
            style={{ opacity: enabled ? 0.9 : 0.28 }}
          />
          <ChevronDown24Regular
            className="h-2.5 w-2.5"
            style={{ marginTop: -3, opacity: enabled ? 0.9 : 0.28 }}
          />
        </span>
      </button>
    </HoverTooltip>
  );
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
          border: "1px solid var(--colorNeutralStroke2)",
          height: IMAGE_TABLE_HEADER_HEIGHT,
          boxSizing: "border-box",
          position: stickyLeft !== undefined ? "sticky" : undefined,
          left: stickyLeft,
          zIndex: stickyLeft !== undefined ? (stickyLeft === 0 ? 5 : 4) : undefined,
          background: dragOver ? "var(--colorBrandBackground2)" : stickyLeft !== undefined ? "var(--colorNeutralBackground3)" : undefined,
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
}: {
  children: React.ReactNode;
  align?: "left" | "center";
  compact?: boolean;
  stickyLeft?: number;
  stickyBackground?: string;
}) {
  return (
    <td className={compact ? "px-1 py-1" : "px-2 py-1"}
        style={{
          border: "1px solid var(--colorNeutralStroke2)",
          textAlign: align,
          whiteSpace: "nowrap",
          height: IMAGE_TABLE_ROW_HEIGHT,
          boxSizing: "border-box",
          position: stickyLeft !== undefined ? "sticky" : undefined,
          left: stickyLeft,
          zIndex: stickyLeft !== undefined ? (stickyLeft === 0 ? 3 : 2) : undefined,
          background: stickyLeft !== undefined ? stickyBackground : undefined,
          boxShadow: stickyLeft !== undefined ? "inset -2px 0 0 var(--colorNeutralStroke1), 2px 0 4px rgba(0,0,0,0.08)" : undefined,
        }}>
      <span className="block min-w-0 truncate">{children}</span>
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
