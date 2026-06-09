import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@fluentui/react-components";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown24Regular,
  ChevronUp24Regular,
  Image24Regular,
  TableSimple24Regular,
  ChartMultiple24Regular,
} from "@fluentui/react-icons";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Panel, PanelGroup } from "react-resizable-panels";

import { loadImageThumbnailBatch, loadImageTomlFieldsBatch, type ImageEntry } from "@/ipc/imageScan";
import { ensureDirectory } from "@/ipc/shell";
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { LceChart } from "./LceChart";
import { NormalTable } from "./NormalTable";
import { FaceTable } from "./FaceTable";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import { ImageSplitMode } from "../ImagePane/ImageSplitMode";

type TabId = "image" | "normal" | "face" | "lce";
type ImageSortDirection = "asc" | "desc";
type ImageSortState = {
  column: string;
  key: string;
  direction: ImageSortDirection;
};
type LcePreviewMode = "image" | "image_table" | "image_split";

interface Props {
  schema:    Isp6sSchemaRoot;
  entries:   ImageEntry[];
  current:   number;
  imageDir:  string | null;
  tomlData:  Record<string, string>;
  onPickImage: (idx: number) => void;
  onImageDirChange: (dir: string) => void;
  collapsed: boolean;
  onToggleCollapsed: (next: boolean) => void;
  headerRatios: number[];
  onHeaderRatiosChange: (next: number[]) => void;
}

const IMG_EXTS = ["jpg", "jpeg", "png"];
const IMAGE_OPTION_HEIGHT = 44;
const IMAGE_OPTION_LIST_HEIGHT = 320;
const IMAGE_OPTION_OVERSCAN = 6;
const IMAGE_DROPDOWN_THUMBNAIL_SIZE = 48;
const IMAGE_DROPDOWN_THUMBNAIL_BATCH = 3;
const IMAGE_DROPDOWN_THUMBNAIL_FALLBACK_CONCURRENCY = 2;
const IMAGE_DROPDOWN_THUMBNAIL_CACHE_LIMIT = 160;
const IMAGE_HEADER_THUMBNAIL_SIZE = 80;
const IMAGE_THUMBNAIL_IDLE_DELAY = 0;
const IMAGE_TABLE_HEADER_HEIGHT = 34;
const IMAGE_TABLE_ROW_HEIGHT = 32;
const IMAGE_TABLE_OVERSCAN = 12;
const IMAGE_TABLE_LOAD_DEBOUNCE_MS = 8;
const IMAGE_TABLE_FIELD_CACHE_LIMIT = 768;
const IMAGE_TABLE_PREFETCH_DELAY_MS = 90;
const IMAGE_TABLE_PREFETCH_MIN_ROWS = 96;
const IMAGE_TABLE_PREFETCH_PAGES = 3;
const IMAGE_TABLE_SORT_CONTROLS_STORAGE_KEY = "luxe:isp6s:image-table-sort-controls";
const IMAGE_LIST_TAB_STORAGE_KEY = "luxe:isp6s:image-list-tab";
const LCE_PREVIEW_MODE_STORAGE_KEY = "luxe:isp6s:lce-preview-mode";

const TABS: { id: TabId; label: string }[] = [
  { id: "image",  label: "Image" },
  { id: "normal", label: "Normal" },
  { id: "face",   label: "Face" },
  { id: "lce",    label: "LCE" },
];
const DEFAULT_TAB_ORDER: TabId[] = TABS.map((item) => item.id);
const DEFAULT_HEADER_RATIOS = [24, 18, 58];

export function TablePane({
  schema,
  entries,
  current,
  imageDir,
  tomlData,
  onPickImage,
  onImageDirChange,
  collapsed,
  onToggleCollapsed,
  headerRatios,
  onHeaderRatiosChange,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const lastDropStateRef = useRef<"ok" | "bad" | null>(null);
  const [tab, setTab] = useState<TabId>(readImageListTab);
  const [tabOrder, setTabOrder] = useState<TabId[]>(DEFAULT_TAB_ORDER);
  const [dropState, setDropState] = useState<"ok" | "bad" | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const currentEntry = entries[current];

  const orderedTabs = useMemo(
    () => tabOrder
      .map((id) => TABS.find((item) => item.id === id))
      .filter((item): item is { id: TabId; label: string } => Boolean(item)),
    [tabOrder],
  );

  const safeHeaderRatios = useMemo(() => {
    if (headerRatios.length === 3 && headerRatios.every((value) => Number.isFinite(value) && value > 0)) {
      return headerRatios;
    }
    return DEFAULT_HEADER_RATIOS;
  }, [headerRatios]);

  useEffect(() => {
    writeImageListTab(tab);
  }, [tab]);

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

  const pickImageDir = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") onImageDirChange(picked);
  };

  const onTabDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabOrder.indexOf(active.id as TabId);
    const newIndex = tabOrder.indexOf(over.id as TabId);
    if (oldIndex < 0 || newIndex < 0) return;
    setTabOrder((prev) => arrayMove(prev, oldIndex, newIndex));
  };

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
         className={`flex w-full flex-col transition-colors ${collapsed ? "" : "h-full"}`}
         style={{
           background,
           border: `1px solid ${borderColor}`,
           borderRadius: 12,
           overflow: "hidden",
         }}>
      <div className="shrink-0 px-3 py-2"
           style={!collapsed ? { borderBottom: "1px solid var(--colorNeutralStroke2)" } : undefined}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md"
               style={{
                 background: "var(--colorNeutralBackground3)",
                 color: "var(--colorNeutralForeground2)",
               }}>
            <HeaderImageThumb entry={currentEntry} />
          </div>

          <div className="min-w-0 flex-1">
            <PanelGroup direction="horizontal" autoSaveId="isp6s-table-header">
              <Panel
                defaultSize={safeHeaderRatios[0]}
                minSize={18}
                onResize={(size) => onHeaderRatiosChange([size, safeHeaderRatios[1], safeHeaderRatios[2]])}
              >
                <div className="flex h-12 min-w-0 items-center">
                  <div
                    role="button"
                    tabIndex={0}
                    className="flex h-12 min-w-0 w-full flex-col justify-center rounded-md px-2 text-left transition-colors"
                    onClick={pickImageDir}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        pickImageDir();
                      }
                    }}
                    title={imageDir ?? "选择图片文件夹"}
                    style={{
                      color: "inherit",
                      background: "transparent",
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = "var(--colorSubtleBackgroundHover)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div className="flex items-center gap-1 text-sm font-semibold"
                         style={{ color: "var(--colorNeutralForeground1)" }}>
                      图片列表卡片
                      <Button
                        appearance="subtle"
                        size="small"
                        icon={collapsed ? <ChevronDown24Regular /> : <ChevronUp24Regular />}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleCollapsed(!collapsed);
                        }}
                        aria-label={collapsed ? "展开" : "收起"}
                      />
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-medium leading-5"
                         style={{ color: "var(--colorNeutralForeground3)" }}>
                      {imageDir ?? "支持拖拽或选择图片文件夹"}
                    </div>
                  </div>
                </div>
              </Panel>

              <ResizeHandle direction="horizontal" size={8} />

              {!collapsed ? (
                <>
                  <Panel
                    defaultSize={safeHeaderRatios[1]}
                    minSize={26}
                    onResize={(size) => onHeaderRatiosChange([safeHeaderRatios[0], size, safeHeaderRatios[2]])}
                  >
                    <div className="flex h-12 min-w-0 items-center px-2">
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={onTabDragEnd}
                      >
                        <SortableContext
                          items={orderedTabs.map((item) => item.id)}
                          strategy={horizontalListSortingStrategy}
                        >
                          <div
                            className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-lg border px-1.5 py-1"
                            style={getOverlayChrome()}
                          >
                            {orderedTabs.map((item) => (
                              <DraggableTabButton
                                key={item.id}
                                id={item.id}
                                label={item.label}
                                active={item.id === tab}
                                onClick={() => setTab(item.id)}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    </div>
                  </Panel>

                  <ResizeHandle direction="horizontal" size={8} />
                  <Panel
                    defaultSize={safeHeaderRatios[2]}
                    minSize={40}
                    onResize={(size) => onHeaderRatiosChange([safeHeaderRatios[0], safeHeaderRatios[1], size])}
                  >
                    <div className="flex h-12 min-w-[320px] items-center justify-end gap-3 px-2">
                      <div
                        className="flex h-full min-w-0 items-stretch gap-3 rounded-lg border px-2 py-1"
                        style={getOverlayChrome()}
                      >
                      <span
                        className="flex shrink-0 items-center self-stretch rounded-md px-2 py-1 text-sm font-semibold"
                        style={getCurrentImageLabelChrome()}
                      >
                        当前图
                        <span className="ml-0.5">:</span>
                      </span>
                      <div
                        className="flex min-w-0 flex-1 items-center self-stretch rounded-md px-1"
                        style={getCurrentImageConnectorChrome()}
                      >
                        <ImagePickerDropdown
                          entries={entries}
                          current={current}
                          onPick={onPickImage}
                        />
                      </div>
                      </div>
                    </div>
                  </Panel>
                </>
              ) : (
                <Panel minSize={40}>
                  <div className="flex h-12 min-w-[320px] items-center justify-end gap-3 px-2">
                    <div
                      className="flex h-full min-w-0 items-stretch gap-3 rounded-lg border px-2 py-1"
                      style={getOverlayChrome()}
                    >
                    <span
                      className="flex shrink-0 items-center self-stretch rounded-md px-2 py-1 text-sm font-semibold"
                      style={getCurrentImageLabelChrome()}
                    >
                      当前图
                      <span className="ml-0.5">:</span>
                    </span>
                    <div
                      className="flex min-w-0 flex-1 items-center self-stretch rounded-md px-1"
                      style={getCurrentImageConnectorChrome()}
                    >
                      <ImagePickerDropdown
                        entries={entries}
                        current={current}
                        onPick={onPickImage}
                      />
                    </div>
                    </div>
                  </div>
                </Panel>
              )}
            </PanelGroup>
          </div>
        </div>
      </div>

      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-hidden">
          {tab === "image"  && <ImageTab schema={schema} entries={entries} current={current} onPick={onPickImage} />}
          {tab === "normal" && <NormalTable tomlData={tomlData} />}
          {tab === "face"   && <FaceTable tomlData={tomlData} />}
          {tab === "lce"    && <LceTab entry={currentEntry} schema={schema} tomlData={tomlData} />}
        </div>
      )}
    </div>
  );
}

function ImagePickerDropdown({
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

function safeImageUrl(path: string | undefined): string | null {
  if (!path) return null;
  try { return convertFileSrc(path); }
  catch { return null; }
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

function HeaderImageThumb({ entry }: { entry: ImageEntry | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  const path = entry?.jpg_path;

  useEffect(() => {
    setUrl(null);
    if (!path) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      loadImageThumbnailBatch([path], IMAGE_HEADER_THUMBNAIL_SIZE)
        .then((batch) => {
          if (!cancelled) setUrl(batch[path] || safeImageUrl(path));
        })
        .catch(() => {
          if (!cancelled) setUrl(safeImageUrl(path));
        });
    }, IMAGE_THUMBNAIL_IDLE_DELAY);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [path]);

  if (!url) {
    return <Image24Regular />;
  }

  return (
    <img
      src={url}
      alt={entry?.name ?? ""}
      className="h-full w-full object-cover"
      draggable={false}
    />
  );
}

function ImageTab({
  schema, entries, current, onPick,
}: {
  schema:   Isp6sSchemaRoot;
  entries:  ImageEntry[];
  current:  number;
  onPick:   (idx: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
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
    () => Object.entries(schema.Image ?? {}),
    [schema],
  );
  const imageTomlKeys = useMemo(
    () => extraCols.map(([, key]) => key).filter((key) => key.length > 0),
    [extraCols],
  );
  const imageTomlKeySignature = useMemo(
    () => imageTomlKeys.join("\u001f"),
    [imageTomlKeys],
  );
  const [tomls, setTomls] = useState<Record<string, Record<string, string>>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [tableReloadVersion, setTableReloadVersion] = useState(0);
  const [sortState, setSortState] = useState<ImageSortState | null>(null);
  const [sortValues, setSortValues] = useState<Record<string, string>>({});
  const [sortLoading, setSortLoading] = useState(false);
  const [sortControlsEnabled, setSortControlsEnabled] = useState(readImageTableSortControlsEnabled);

  const sortedRows = useMemo(() => {
    const rows = entries.map((entry, index) => ({ e: entry, i: index }));
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
  }, [entries, sortControlsEnabled, sortState, sortValues]);

  const currentDisplayIndex = useMemo(
    () => sortedRows.findIndex((row) => row.i === current),
    [current, sortedRows],
  );

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

  const visible = useMemo(() => {
    const bodyScrollTop = Math.max(0, scrollTop - IMAGE_TABLE_HEADER_HEIGHT);
    const effectiveHeight = Math.max(viewportHeight, IMAGE_TABLE_ROW_HEIGHT * 8);
    const start = Math.max(0, Math.floor(bodyScrollTop / IMAGE_TABLE_ROW_HEIGHT) - IMAGE_TABLE_OVERSCAN);
    const count = Math.ceil(effectiveHeight / IMAGE_TABLE_ROW_HEIGHT) + IMAGE_TABLE_OVERSCAN * 2;
    const end = Math.min(sortedRows.length, start + count);
    const rows = sortedRows.slice(start, end);
    return { start, end, rows };
  }, [scrollTop, sortedRows, viewportHeight]);

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
    setTomls({});
  }, [entries, imageTomlKeySignature]);

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
    loadImageTomlFieldsBatch(paths, [sortKey])
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
    if (rowTop < viewTop) {
      setImageTableScrollTop(Math.max(0, rowTop - IMAGE_TABLE_ROW_HEIGHT));
    } else if (rowBottom > viewBottom) {
      setImageTableScrollTop(rowBottom - el.clientHeight + IMAGE_TABLE_ROW_HEIGHT);
    }
  }

  function pickDisplayRow(displayIndex: number) {
    const nextRow = sortedRows[displayIndex];
    if (!nextRow) return;
    ensureImageTableRowVisible(displayIndex);
    onPick(nextRow.i);
  }

  function handleImageTableKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (sortedRows.length === 0) return;
    event.preventDefault();

    const fallbackIndex = Math.max(0, Math.min(current, sortedRows.length - 1));
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

  useEffect(() => {
    if (currentDisplayIndex >= 0) {
      ensureImageTableRowVisible(currentDisplayIndex);
    }
  }, [currentDisplayIndex]);

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
      loadImageTomlFieldsBatch(missing, imageTomlKeys)
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
      loadImageTomlFieldsBatch(missing, imageTomlKeys)
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


  const colSpan = 2 + extraCols.length;
  const topPadding = visible.start * IMAGE_TABLE_ROW_HEIGHT;
  const bottomPadding = Math.max(0, (sortedRows.length - visible.end) * IMAGE_TABLE_ROW_HEIGHT);
  const columnWidths = useMemo(() => {
    const idxWidth = clampImageColumnWidth(
      estimateImageColumnTextWidth(String(Math.max(entries.length, 1))),
      42,
      56,
    );
    const nameWidth = clampImageColumnWidth(
      Math.max(
        estimateImageColumnTextWidth("name"),
        ...visible.rows.map(({ e }) => estimateImageColumnTextWidth(e.name)),
      ),
      120,
      260,
    );
    const extraWidths = extraCols.map(([col, key]) => {
      const valueWidth = Math.max(
        estimateImageColumnTextWidth(col),
        ...visible.rows.map(({ e }) => estimateImageColumnTextWidth(tomls[e.toml_path]?.[key] ?? "-")),
      );
      return clampImageColumnWidth(valueWidth, 52, 132);
    });
    return {
      idx: idxWidth,
      name: nameWidth,
      extra: extraWidths,
      table: idxWidth + nameWidth + extraWidths.reduce((sum, width) => sum + width, 0),
    };
  }, [entries.length, extraCols, tomls, visible.rows]);

  return (
    <div
      ref={scrollRef}
      className="h-full w-full overflow-auto outline-none"
      tabIndex={0}
      aria-label="Image table"
      onKeyDown={handleImageTableKeyDown}
      onScroll={(event) => {
        const nextScrollTop = event.currentTarget.scrollTop;
        scrollDirectionRef.current = nextScrollTop >= scrollTopRef.current ? 1 : -1;
        scrollTopRef.current = nextScrollTop;
        setScrollTop(nextScrollTop);
      }}
    >
      <table className="w-full border-collapse text-xs"
             style={{
               fontFamily: "ui-monospace, monospace",
               minWidth: "100%",
               tableLayout: "fixed",
               width: columnWidths.table,
             }}>
        <colgroup>
          <col style={{ width: columnWidths.idx }} />
          <col style={{ width: columnWidths.name }} />
          {extraCols.map(([col], index) => <col key={col} style={{ width: columnWidths.extra[index] }} />)}
        </colgroup>
        <thead style={{
          background: "var(--colorNeutralBackground3)",
          color: "var(--colorNeutralForeground2)",
          position: "sticky", top: 0, zIndex: 1,
          }}>
          <tr>
            <Th align="center">
              <HoverTooltip content="IDX 原始顺序" positioning="below-center" inline>
                <span>idx</span>
              </HoverTooltip>
            </Th>
            <Th align="center">
              <ImageSortToggleHeader
                enabled={sortControlsEnabled}
                onToggle={toggleImageSortControls}
                label="name"
              />
            </Th>
            {extraCols.map(([col, key], index) => {
              const active = sortState?.key === key;
              return (
                <Th key={col} align={index < 2 ? "center" : "left"}>
                  {sortControlsEnabled ? (
                    <ImageSortHeader
                      label={col}
                      align={index < 2 ? "center" : "left"}
                      active={active}
                      direction={active ? sortState.direction : "asc"}
                      loading={active && sortLoading}
                      onClick={() => toggleImageSort(col, key)}
                      onReset={() => setSortState(null)}
                    />
                  ) : col}
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
            const data = tomls[e.toml_path] ?? {};
            return (
              <tr key={e.jpg_path}
                  onClick={() => {
                    scrollRef.current?.focus({ preventScroll: true });
                    onPick(i);
                  }}
                  style={{
                    cursor: "pointer",
                    height: IMAGE_TABLE_ROW_HEIGHT,
                    background: i === current ? "var(--colorBrandBackground2)" : "transparent",
                    borderBottom: "1px solid var(--colorNeutralStroke3)",
                  }}>
                <Td align="center">{i + 1}</Td>
                <Td align="center">{e.name}</Td>
                {extraCols.map(([col, key], index) => (
                  <Td key={col} align={index < 2 ? "center" : "left"}>
                    {data[key] ?? "-"}
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
  );
}

function LceTab({
  entry,
  schema,
  tomlData,
}: {
  entry: ImageEntry | undefined;
  schema: Isp6sSchemaRoot;
  tomlData: Record<string, string>;
}) {
  const [mode, setMode] = useState<LcePreviewMode>(readLcePreviewMode);
  const labels = ["0", "1", "50", "250", "500", "750", "950", "999"];
  const num = (k: string) => {
    const v = tomlData[k];
    const f = parseFloat(v ?? "");
    return Number.isFinite(f) ? f : NaN;
  };
  const p = labels.map((n) => num(`SW_LCE_P${n}`));
  const o = labels.map((n) => num(`SW_LCE_O${n}`));

  useEffect(() => {
    writeLcePreviewMode(mode);
  }, [mode]);

  return (
    <PanelGroup direction="horizontal" autoSaveId="isp6s-lce-split" className="h-full w-full">
      <Panel defaultSize={38} minSize={22}>
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
                <HoverTooltip content="图片" positioning="below-center" inline>
                  <Button
                    appearance={mode === "image" ? "primary" : "subtle"}
                  size="small"
                  icon={<Image24Regular />}
                  onClick={() => setMode("image")}
                />
              </HoverTooltip>
                <HoverTooltip content="三段图" positioning="below-center" inline>
                  <Button
                    appearance={mode === "image_split" ? "primary" : "subtle"}
                    size="small"
                    icon={<ChartMultiple24Regular />}
                    onClick={() => setMode("image_split")}
                  />
                </HoverTooltip>
                <HoverTooltip content="二段图" positioning="below-center" inline>
                  <Button
                    appearance={mode === "image_table" ? "primary" : "subtle"}
                    size="small"
                    icon={<TableSimple24Regular />}
                    onClick={() => setMode("image_table")}
                  />
                </HoverTooltip>
              </div>
              {mode === "image" && <LceImagePreview entry={entry} />}
              {mode === "image_table" && <LceImageTableMode entry={entry} schema={schema} tomlData={tomlData} />}
              {mode === "image_split" && <ImageSplitMode entry={entry} schema={schema} tomlData={tomlData} />}
            </div>
          </div>
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

function LceImagePreview({ entry }: { entry: ImageEntry | undefined }) {
  const url = useMemo(() => safeImageUrl(entry?.jpg_path), [entry?.jpg_path]);

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
           style={{ color: "var(--colorPaletteRedForeground1)" }}>
        图片预览加载失败
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
}: {
  entry: ImageEntry | undefined;
  schema: Isp6sSchemaRoot;
  tomlData: Record<string, string>;
}) {
  const url = useMemo(() => safeImageUrl(entry?.jpg_path), [entry?.jpg_path]);
  const items = schema.preview_info?.items ?? [];

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
        <div className="h-full w-full overflow-auto p-3">
          <table className="w-full text-xs"
                 style={{ fontFamily: "ui-monospace, monospace" }}>
            <tbody>
              {(items as Array<{ label: string; toml_key: string }>).map((it, i) => (
                <tr key={`${it.label}-${i}`}
                    style={{ borderBottom: "1px solid var(--colorNeutralStroke3)" }}>
                  <td className="px-3 py-1.5 align-top font-semibold"
                      style={{ color: "var(--colorNeutralForeground2)", width: 120 }}>
                    {it.label}
                  </td>
                  <td className="px-3 py-1.5"
                      style={{ color: "var(--colorNeutralForeground1)" }}>
                    {tomlData[it.toml_key] ?? "—"}
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
      </Panel>
    </PanelGroup>
  );
}

function DraggableTabButton({
  id,
  label,
  active,
  onClick,
}: {
  id: TabId;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      className="rounded-md border px-2.5 py-1.5 text-xs transition-colors"
      style={{
        transform: CSS.Transform.toString(transform ? { ...transform, y: 0 } : null),
        transition,
        background: active ? "var(--colorBrandBackground)" : "var(--colorNeutralBackground1)",
        borderColor: active ? "var(--colorBrandStroke1)" : "var(--colorNeutralStroke2)",
        color: active
          ? "var(--colorNeutralForegroundOnBrand)"
          : "var(--colorNeutralForeground2)",
        fontWeight: active ? 600 : 500,
        opacity: isDragging ? 0.72 : 1,
        cursor: "grab",
        touchAction: "none",
        flexShrink: 0,
      }}
      onMouseEnter={(event) => {
        if (!active) event.currentTarget.style.background = "var(--colorSubtleBackgroundHover)";
      }}
      onMouseLeave={(event) => {
        if (!active) event.currentTarget.style.background = "var(--colorNeutralBackground1)";
      }}
      {...attributes}
      {...listeners}
    >
      {label}
    </button>
  );
}

function getOverlayChrome(): React.CSSProperties {
  const isLight = document.documentElement.classList.contains("light");
  return {
    background: isLight ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.18)",
    borderColor: isLight ? "rgba(138,132,151,0.24)" : "rgba(255,255,255,0.08)",
    backdropFilter: "blur(6px)",
  };
}

function getCurrentImageLabelChrome(): React.CSSProperties {
  const isLight = document.documentElement.classList.contains("light");
  return {
    background: isLight
      ? "rgba(103, 80, 164, 0.14)"
      : "rgba(123, 97, 255, 0.22)",
    color: isLight ? "#5B3FA0" : "#D9CBFF",
    border: `1px solid ${isLight ? "rgba(103, 80, 164, 0.18)" : "rgba(160, 140, 255, 0.24)"}`,
  };
}

function getCurrentImageConnectorChrome(): React.CSSProperties {
  const isLight = document.documentElement.classList.contains("light");
  return {
    border: `1px dashed ${isLight ? "rgba(103, 80, 164, 0.34)" : "rgba(160, 140, 255, 0.38)"}`,
    background: isLight ? "rgba(103, 80, 164, 0.04)" : "rgba(123, 97, 255, 0.08)",
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

function clampImageColumnWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.ceil(value)));
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

function readImageListTab(): TabId {
  try {
    const stored = window.localStorage.getItem(IMAGE_LIST_TAB_STORAGE_KEY);
    return isImageListTab(stored) ? stored : "image";
  } catch {
    return "image";
  }
}

function writeImageListTab(tab: TabId) {
  try {
    window.localStorage.setItem(IMAGE_LIST_TAB_STORAGE_KEY, tab);
  } catch {
    // Ignore storage failures; the in-memory state still works for this mount.
  }
}

function isImageListTab(value: string | null): value is TabId {
  return value === "image" || value === "normal" || value === "face" || value === "lce";
}

function readLcePreviewMode(): LcePreviewMode {
  try {
    const stored = window.localStorage.getItem(LCE_PREVIEW_MODE_STORAGE_KEY);
    return isLcePreviewMode(stored) ? stored : "image";
  } catch {
    return "image";
  }
}

function writeLcePreviewMode(mode: LcePreviewMode) {
  try {
    window.localStorage.setItem(LCE_PREVIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures; the in-memory state still works for this mount.
  }
}

function isLcePreviewMode(value: string | null): value is LcePreviewMode {
  return value === "image" || value === "image_table" || value === "image_split";
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
}: {
  children: React.ReactNode;
  align?: "left" | "center";
}) {
  return (
    <th className="overflow-hidden text-ellipsis whitespace-nowrap px-2 py-2 text-xs font-semibold uppercase"
        style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
      <span style={{ display: "block", textAlign: align }}>{children}</span>
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "center";
}) {
  return (
    <td className="px-2 py-1.5"
        style={{
          color: "var(--colorNeutralForeground2)",
          textAlign: align,
          whiteSpace: "nowrap",
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
