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

import { loadImageToml, type ImageEntry } from "@/ipc/imageScan";
import { ensureDirectory } from "@/ipc/shell";
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { LceChart } from "./LceChart";
import { NormalTable } from "./NormalTable";
import { FaceTable } from "./FaceTable";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import { ImageSplitMode } from "../ImagePane/ImageSplitMode";

type TabId = "image" | "normal" | "face" | "lce";

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
  const [tab, setTab] = useState<TabId>("image");
  const [tabOrder, setTabOrder] = useState<TabId[]>(DEFAULT_TAB_ORDER);
  const [dropState, setDropState] = useState<"ok" | "bad" | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const currentEntry = entries[current];
  const thumbUrl = useMemo(() => {
    if (!currentEntry) return null;
    try { return convertFileSrc(currentEntry.jpg_path); }
    catch { return null; }
  }, [currentEntry?.jpg_path]);

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
            {thumbUrl ? (
              <img
                src={thumbUrl}
                alt={currentEntry?.name ?? ""}
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <Image24Regular />
            )}
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
  const [open, setOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [menuRect, setMenuRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const disabled = entries.length === 0;
  const selectedIndex = current >= 0 && current < entries.length ? current : 0;
  const currentEntry = entries[selectedIndex];
  const menuColors = useMemo(() => getPortalMenuColors(), [open]);
  const pickerButtonChrome = useMemo(() => getCurrentImagePickerButtonChrome(open), [open]);
  const selectedLabel = currentEntry ? `${selectedIndex + 1} | ${currentEntry.name}` : "未选择图片";
  const indexColumnWidth = Math.max(24, String(entries.length).length * 8 + 10);

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
    listRef.current.scrollTop = Math.max(0, selectedIndex * IMAGE_OPTION_HEIGHT - IMAGE_OPTION_HEIGHT * 2);
  }, [selectedIndex, open]);

  const visible = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / IMAGE_OPTION_HEIGHT) - IMAGE_OPTION_OVERSCAN);
    const count = Math.ceil(IMAGE_OPTION_LIST_HEIGHT / IMAGE_OPTION_HEIGHT) + IMAGE_OPTION_OVERSCAN * 2;
    const end = Math.min(entries.length, start + count);
    return { start, end, rows: entries.slice(start, end) };
  }, [entries, scrollTop]);

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
                      <Thumb url={safeImageUrl(entry.jpg_path)} alt={entry.name} />
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

function ImageTab({
  schema, entries, current, onPick,
}: {
  schema:   Isp6sSchemaRoot;
  entries:  ImageEntry[];
  current:  number;
  onPick:   (idx: number) => void;
}) {
  const extraCols = useMemo(
    () => Object.entries(schema.Image ?? {}),
    [schema],
  );
  const [tomls, setTomls] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, Record<string, string>> = { ...tomls };
      for (const e of entries) {
        if (next[e.toml_path]) continue;
        try {
          next[e.toml_path] = await loadImageToml(e.toml_path);
        } catch { /* ignore */ }
        if (cancelled) return;
      }
      setTomls(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const rows = useMemo(() => entries.map((e, i) => ({ e, i })), [entries]);

  return (
    <div className="h-full w-full overflow-auto">
      <table className="w-full border-collapse text-xs"
             style={{ fontFamily: "ui-monospace, monospace" }}>
        <thead style={{
          background: "var(--colorNeutralBackground3)",
          color: "var(--colorNeutralForeground2)",
          position: "sticky", top: 0, zIndex: 1,
        }}>
          <tr>
            <Th>idx</Th>
            <Th>name</Th>
            {extraCols.map(([col]) => <Th key={col}>{col}</Th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ e, i }) => {
            const data = tomls[e.toml_path] ?? {};
            return (
              <tr key={e.jpg_path}
                  onClick={() => onPick(i)}
                  style={{
                    cursor: "pointer",
                    background: i === current ? "var(--colorBrandBackground2)" : "transparent",
                    borderBottom: "1px solid var(--colorNeutralStroke3)",
                  }}>
                <Td>{i + 1}</Td>
                <Td>{e.name}</Td>
                {extraCols.map(([col, key]) => (
                  <Td key={col}>{data[key as string] ?? "-"}</Td>
                ))}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td className="p-4 text-center"
                    style={{ color: "var(--colorNeutralForeground3)" }}
                    colSpan={2 + extraCols.length}>
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
  const [mode, setMode] = useState<"image" | "image_table" | "image_split">("image");
  const labels = ["0", "1", "50", "250", "500", "750", "950", "999"];
  const num = (k: string) => {
    const v = tomlData[k];
    const f = parseFloat(v ?? "");
    return Number.isFinite(f) ? f : NaN;
  };
  const p = labels.map((n) => num(`SW_LCE_P${n}`));
  const o = labels.map((n) => num(`SW_LCE_O${n}`));

  return (
    <PanelGroup direction="horizontal" autoSaveId="isp6s-lce-split" className="h-full w-full">
      <Panel defaultSize={38} minSize={22}>
        <div className="h-full w-full p-3 pr-0">
            <div
              className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl border"
              style={{
                background: "var(--colorNeutralBackground1)",
                borderColor: "var(--colorNeutralStroke2)",
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
        <div className="h-full w-full p-3 pl-0">
          <div
            className="h-full w-full overflow-hidden rounded-xl border"
            style={{
              background: "var(--colorNeutralBackground1)",
              borderColor: "var(--colorNeutralStroke2)",
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-xs font-semibold uppercase"
        style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-3 py-1.5"
        style={{ color: "var(--colorNeutralForeground2)" }}>
      {children}
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
