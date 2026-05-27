import { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import {
  Folder24Regular,
  DocumentText24Regular,
  Image24Regular,
} from "@fluentui/react-icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Panel, PanelGroup, type ImperativePanelGroupHandle } from "react-resizable-panels";

import { ensureDirectory } from "@/ipc/shell";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { HoverTooltip } from "@/components/common/HoverTooltip";

interface Props {
  /** "AE.cpp" / "Tone.cpp" / ... — pure hint text */
  cppFileHint:        string;
  cppPath:            string | null;
  onCppPathChange:    (path: string) => void;

  /** Set to false to grey-out the image folder slot (e.g. for ToneMap tab). */
  imageEnabled:       boolean;
  imageDir:           string | null;
  onImageDirChange:   (dir: string) => void;
}

const CPP_EXTS = ["cpp", "c", "h", "hpp", "cxx", "cc"];
const IMG_EXTS = ["jpg", "jpeg", "png"];

type Slot = "cpp" | "image" | null;

/**
 * Unified picker bar — replaces both the old `CppImportPanel` file row and the
 * `Isp6sAeVisual` inline image-folder row.
 *
 * Layout: two equal-width slots side by side. Each slot is:
 *   - clickable → opens system dialog
 *   - drop target → Tauri native onDragDropEvent (full paths)
 *   - extension-aware → highlights green when the dragged file matches, red
 *     when it doesn't, so the user sees the validation BEFORE releasing.
 */
export function MtkPickerBar(props: Props) {
  const cppRef     = useRef<HTMLDivElement | null>(null);
  const imageRef   = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<Slot>(null);
  /** "ok" = accepted ext / "bad" = wrong ext / null = no overlay */
  const [hoverValid, setHoverValid] = useState<"ok" | "bad" | null>(null);

  /* Refs for the imperative PanelGroup and the two primary text nodes — used
   * by the auto-balance effect below to rebalance the splitter so both paths
   * fit on-screen whenever possible. */
  const groupRef        = useRef<ImperativePanelGroupHandle | null>(null);
  const imagePrimaryRef = useRef<HTMLDivElement | null>(null);
  const cppPrimaryRef   = useRef<HTMLDivElement | null>(null);

  /* Auto-balance the splitter when both slots have content. Compares each
   * primary's natural width (scrollWidth) against the slot's fixed overhead
   * (icon + paddings + gaps + action button); if the total required width
   * fits inside the available PanelGroup space, allocates each slot exactly
   * enough plus an equal share of the slack so both fully fit. Otherwise
   * (combined required > available), falls back to a proportional split
   * clamped to [25%, 75%] and the Tooltip wrapper still provides a hover
   * preview. */
  useEffect(() => {
    if (!props.cppPath || !props.imageDir || !props.imageEnabled) return;

    const rebalance = () => {
      const group   = groupRef.current;
      const imgEl   = imagePrimaryRef.current;
      const cppEl   = cppPrimaryRef.current;
      const imgSlot = imageRef.current;
      const cppSlot = cppRef.current;
      if (!group || !imgEl || !cppEl || !imgSlot || !cppSlot) return;

      const imgSlotW = imgSlot.getBoundingClientRect().width;
      const cppSlotW = cppSlot.getBoundingClientRect().width;
      const total    = imgSlotW + cppSlotW;
      if (total <= 0) return;

      // Per-slot overhead = everything outside the primary text node
      // (slot border + padding + icon + gaps + action button).
      const imgOverhead = imgSlotW - imgEl.clientWidth;
      const cppOverhead = cppSlotW - cppEl.clientWidth;

      // Required widths to display each primary in full.
      const imgRequired = imgEl.scrollWidth + imgOverhead;
      const cppRequired = cppEl.scrollWidth + cppOverhead;

      let imgPct: number;
      if (imgRequired + cppRequired <= total) {
        /* Both fit — give each what it needs and split leftover equally so
         * the two slots stay visually balanced. */
        const leftover = total - (imgRequired + cppRequired);
        imgPct = ((imgRequired + leftover / 2) / total) * 100;
      } else {
        /* Can't fit both — proportional split, clamped. */
        const ratio = imgRequired / (imgRequired + cppRequired);
        imgPct = Math.max(25, Math.min(75, ratio * 100));
      }

      group.setLayout([imgPct, 100 - imgPct]);
    };

    const raf = requestAnimationFrame(rebalance);
    window.addEventListener("resize", rebalance);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", rebalance);
    };
  }, [props.cppPath, props.imageDir, props.imageEnabled]);

  /* Hook into Tauri's native drag/drop event — only this surface gives us
   * absolute file paths (HTML5 DataTransfer in webview hides paths for security). */
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          const slot = hitTest(payload.position);
          setHover(slot);
          setHoverValid(slot ? classify(slot, payload.paths, props.imageEnabled) : null);
          return;
        }
        if (payload.type === "over") {
          // `over` payloads don't carry paths — only update which slot is hovered;
          // validity was already classified at `enter`.
          setHover(hitTest(payload.position));
          return;
        }
        if (payload.type === "leave") {
          setHover(null);
          setHoverValid(null);
          return;
        }
        if (payload.type === "drop") {
          const slot = hitTest(payload.position);
          setHover(null);
          setHoverValid(null);
          if (!slot || payload.paths.length === 0) return;
          if (slot === "cpp") {
            const p = payload.paths.find((p) => matchExt(p, CPP_EXTS));
            if (p) props.onCppPathChange(p);
          } else if (slot === "image" && props.imageEnabled) {
            const first = payload.paths[0];
            // If the user dropped a JPG inside a folder, use its parent dir.
            ensureDirectory(first)
              .then((dir) => props.onImageDirChange(dir))
              .catch((err) => console.warn("ensureDirectory failed", err));
          }
        }
      });
    })();
    return () => { unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.imageEnabled]);

  function hitTest(p: { x: number; y: number }): Slot {
    const dpr = window.devicePixelRatio || 1;
    const x = p.x / dpr;
    const y = p.y / dpr;
    const inside = (el: HTMLElement | null) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    if (inside(cppRef.current))   return "cpp";
    if (inside(imageRef.current)) return "image";
    return null;
  }

  /* ── Manual pick (button click) ── */
  const pickCpp = async () => {
    const picked = await openDialog({
      multiple: false,
      filters:  [{ name: "Source", extensions: CPP_EXTS }],
    });
    if (typeof picked === "string") props.onCppPathChange(picked);
  };
  const pickImage = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") props.onImageDirChange(picked);
  };

  return (
    <PanelGroup
      ref={groupRef}
      direction="horizontal"
      autoSaveId="mtk-picker-bar"
      className="w-full"
      style={{ minHeight: 92 }}
    >
      {/* ── Image folder slot (LEFT) ── */}
      <Panel defaultSize={50} minSize={25}>
        <Slot
          innerRef={imageRef}
          primaryRef={imagePrimaryRef}
          active={hover === "image" && props.imageEnabled}
          valid={hover === "image" ? hoverValid : null}
          disabled={!props.imageEnabled}
          icon={<Image24Regular />}
          title="图片文件夹"
          primary={
            props.imageEnabled
              ? (props.imageDir ?? "未选择图片文件夹")
              : "（仅 ISP6S / AE Basic 需要）"
          }
          secondary={
            props.imageEnabled
              ? (props.imageDir ? null : "点 '浏览' 或拖入文件夹 / 任一图片")
              : "其他 Tab 不需要图片"
          }
          action={
            <Button
              appearance="secondary"
              icon={<Folder24Regular />}
              onClick={pickImage}
              disabled={!props.imageEnabled}
            >
              {props.imageDir ? "更换" : "选择"}
            </Button>
          }
        />
      </Panel>

      <ResizeHandle direction="horizontal" />

      {/* ── CPP slot (RIGHT) ── */}
      <Panel defaultSize={50} minSize={25}>
        <Slot
          innerRef={cppRef}
          primaryRef={cppPrimaryRef}
          active={hover === "cpp"}
          valid={hover === "cpp" ? hoverValid : null}
          icon={<DocumentText24Regular />}
          title="参数文件"
          primary={props.cppPath ?? `期望 ${props.cppFileHint}`}
          secondary={
            props.cppPath
              ? null
              : "点 '浏览' 或拖入 .cpp / .c / .h 文件"
          }
          action={
            <Button appearance="secondary" icon={<Folder24Regular />} onClick={pickCpp}>
              浏览
            </Button>
          }
        />
      </Panel>
    </PanelGroup>
  );
}

interface SlotProps {
  innerRef:  React.RefObject<HTMLDivElement>;
  active:    boolean;
  valid:     "ok" | "bad" | null;
  disabled?: boolean;
  icon:      React.ReactNode;
  title:     string;
  primary:   string;
  secondary: string | null;
  primaryRef?: React.RefObject<HTMLDivElement>;
  action:    React.ReactNode;
}

function Slot({
  innerRef, active, valid, disabled,
  icon, title, primary, secondary, primaryRef, action,
}: SlotProps) {
  const borderColor =
    !active        ? "var(--colorNeutralStroke2)" :
    valid === "ok" ? "var(--colorPaletteGreenBorder2)" :
    valid === "bad"? "var(--colorPaletteRedBorder2)" :
                     "var(--colorBrandStroke1)";
  const bg =
    !active        ? "var(--colorNeutralBackground2)" :
    valid === "ok" ? "var(--colorPaletteGreenBackground1)" :
    valid === "bad"? "var(--colorPaletteRedBackground1)" :
                     "var(--colorNeutralBackground2)";
  return (
    <div
      ref={innerRef}
      className="flex h-full w-full items-center gap-3 rounded-lg border p-3 transition-colors"
      style={{
        background:  bg,
        borderColor,
        opacity:     disabled ? 0.55 : 1,
      }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
        style={{
          background: "var(--colorNeutralBackground3)",
          color:      "var(--colorNeutralForeground2)",
        }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs"
             style={{ color: "var(--colorNeutralForeground3)" }}>
          {title}
        </div>
        <HoverTooltip content={primary}
                      truncatableRef={primaryRef}
                      positioning="below-start"
                      wrap maxWidth={600}>
          <div ref={primaryRef}
               className="mt-0.5 truncate text-sm font-semibold"
               style={{ color: "var(--colorNeutralForeground1)" }}>
            {primary}
          </div>
        </HoverTooltip>
        {secondary !== null && (
          <div className="mt-0.5 truncate text-[11px]"
               style={{ color: "var(--colorNeutralForeground3)" }}>
            {secondary}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}

/* ── helpers ── */

function matchExt(path: string, exts: string[]): boolean {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  const ext = lower.slice(dot + 1);
  return exts.includes(ext);
}

function classify(slot: NonNullable<Slot>, paths: string[], imageEnabled: boolean): "ok" | "bad" {
  if (paths.length === 0) return "bad";
  if (slot === "cpp") {
    return paths.some((p) => matchExt(p, CPP_EXTS)) ? "ok" : "bad";
  }
  // image slot
  if (!imageEnabled) return "bad";
  // Accept a directory OR a path with image extension (we'll fall back to parent).
  const first = paths[0];
  if (matchExt(first, IMG_EXTS)) return "ok";
  // No extension → probably a directory.
  const dot = first.lastIndexOf(".");
  const slashes = Math.max(first.lastIndexOf("/"), first.lastIndexOf("\\"));
  if (dot < 0 || dot < slashes) return "ok";
  return "bad";
}
