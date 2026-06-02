import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@fluentui/react-components";
import {
  ChevronDown24Regular,
  ChevronUp24Regular,
  Image24Regular,
} from "@fluentui/react-icons";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { loadImageToml, type ImageEntry } from "@/ipc/imageScan";
import { ensureDirectory } from "@/ipc/shell";
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";
import { LceChart } from "./LceChart";

type TabId = "image" | "normal" | "face" | "lce" | "all";

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
  { id: "all",    label: "All" },
];

export function TablePane({
  schema, entries, current, imageDir, tomlData, onPickImage, onImageDirChange,
  collapsed, onToggleCollapsed,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<TabId>("image");
  const [dropState, setDropState] = useState<"ok" | "bad" | null>(null);

  const currentEntry = entries[current];
  const thumbUrl = useMemo(() => {
    if (!currentEntry) return null;
    try { return convertFileSrc(currentEntry.jpg_path); }
    catch { return null; }
  }, [currentEntry?.jpg_path]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          setDropState(hitTest(payload.position) ? classifyImageDrop(payload.paths) : null);
          return;
        }
        if (payload.type === "over") {
          setDropState((prev) => hitTest(payload.position) ? prev : null);
          return;
        }
        if (payload.type === "leave") {
          setDropState(null);
          return;
        }
        if (payload.type === "drop") {
          const inside = hitTest(payload.position);
          setDropState(null);
          if (!inside || payload.paths.length === 0) return;
          if (classifyImageDrop(payload.paths) !== "ok") return;
          const first = payload.paths[0];
          ensureDirectory(first)
            .then(onImageDirChange)
            .catch((err) => console.warn("ensureDirectory failed", err));
        }
      });
    })();
    return () => { unlisten?.(); };
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
         className="flex h-full w-full flex-col transition-colors"
         style={{
           background,
           border:      `1px solid ${borderColor}`,
           borderRadius: 12,
           overflow:    "hidden",
         }}>
      {/* Header bar: always visible thumbnail + folder path + image selector + collapse toggle */}
      <div className="shrink-0 px-3 py-2"
           style={!collapsed
             ? { borderBottom: "1px solid var(--colorNeutralStroke2)" }
             : undefined}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md"
               style={{
                 background: "var(--colorNeutralBackground3)",
                 color:      "var(--colorNeutralForeground2)",
               }}>
            {thumbUrl ? (
              <img src={thumbUrl}
                   alt={currentEntry?.name ?? ""}
                   className="h-full w-full object-cover"
                   draggable={false} />
            ) : (
              <Image24Regular />
            )}
          </div>
          <div
            role="button"
            tabIndex={0}
            className="flex h-12 min-w-[180px] flex-1 flex-col justify-center rounded-md px-2 text-left transition-colors"
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
            <div className="mt-0.5 break-all text-[11px] font-medium leading-5"
                 style={{ color: imageDir ? "var(--colorNeutralForeground3)" : "var(--colorNeutralForeground3)" }}>
              {imageDir ?? "未选择图片文件夹 · 拖入图片文件夹或 jpg/jpeg/png 图片加载整个文件夹"}
            </div>
          </div>
          <ImagePickerDropdown
            entries={entries}
            current={current}
            onPick={onPickImage}
          />
          </div>
      </div>

      {!collapsed && (
        <>
          {/* Tabs row */}
          <div className="flex shrink-0 items-center gap-2 px-2 py-1.5"
               style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
            {TABS.map((t) => {
              const active = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className="rounded-md px-3 py-1.5 text-xs transition-colors"
                  style={{
                    background: active ? "var(--colorBrandBackground)" : "transparent",
                    color:      active
                      ? "var(--colorNeutralForegroundOnBrand)"
                      : "var(--colorNeutralForeground2)",
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
            <div className="flex-1" />
          </div>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {tab === "image"  && <ImageTab    schema={schema} entries={entries} current={current}
                                             onPick={onPickImage} />}
            {tab === "normal" && <Placeholder label="Normal 表格，待 normal_table.toml 映射" />}
            {tab === "face"   && <Placeholder label="Face 表格，待 face_table.toml 映射" />}
            {tab === "lce"    && <LceTab tomlData={tomlData} />}
            {tab === "all"    && <AllTab tomlData={tomlData} />}
          </div>
        </>
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
  const selectedLabel = currentEntry
    ? `${selectedIndex + 1} | ${currentEntry.name}`
    : "未选择图片";
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
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        className="flex h-12 items-center gap-2 rounded-md border px-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          width: "clamp(220px, 30vw, 360px)",
          background: "var(--colorNeutralBackground1)",
          borderColor: "var(--colorNeutralStroke1)",
          color: "var(--colorNeutralForeground1)",
        }}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selectedLabel}
      >
        <span className="min-w-0 flex-1 truncate">
          {selectedLabel}
        </span>
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
        </div>
        , document.body)}
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

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs"
         style={{ color: "var(--colorNeutralForeground3)" }}>
      {label}
    </div>
  );
}

/* Image tab: list of images with extra columns from [Image] schema */

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
  /* All toml maps loaded on demand. We cache per path so switching images
   * doesn't re-fetch. */
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
          color:      "var(--colorNeutralForeground2)",
          position:   "sticky", top: 0, zIndex: 1,
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
                    background: i === current
                      ? "var(--colorBrandBackground2)" : "transparent",
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

/* LCE tab */

function LceTab({ tomlData }: { tomlData: Record<string, string> }) {
  const labels = ["0", "1", "50", "250", "500", "750", "950", "999"];
  const num = (k: string) => {
    const v = tomlData[k];
    const f = parseFloat(v ?? "");
    return Number.isFinite(f) ? f : NaN;
  };
  const p = labels.map((n) => num(`SW_LCE_P${n}`));
  const o = labels.map((n) => num(`SW_LCE_O${n}`));
  return (
    <div className="h-full w-full p-3">
      <LceChart pSeries={p} oSeries={o} />
    </div>
  );
}

/* All tab: flat key/value of the current image TOML */

function AllTab({ tomlData }: { tomlData: Record<string, string> }) {
  const rows = useMemo(() => {
    return Object.entries(tomlData)
      .sort(([a], [b]) => a.localeCompare(b));
  }, [tomlData]);

  return (
    <div className="h-full w-full overflow-auto">
      <table className="w-full text-xs"
             style={{ fontFamily: "ui-monospace, monospace" }}>
        <thead style={{
          background: "var(--colorNeutralBackground3)",
          color:      "var(--colorNeutralForeground2)",
          position:   "sticky", top: 0, zIndex: 1,
        }}>
          <tr>
            <Th>key</Th>
            <Th>value</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}
                style={{ borderBottom: "1px solid var(--colorNeutralStroke3)" }}>
              <Td>{k}</Td>
              <Td>{v}</Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={2} className="p-4 text-center"
                    style={{ color: "var(--colorNeutralForeground3)" }}>
              （无数据）
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
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
