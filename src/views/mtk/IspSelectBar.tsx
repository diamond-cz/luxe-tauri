import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { ChevronDown16Regular, DocumentText24Regular } from "@fluentui/react-icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Panel, PanelGroup } from "react-resizable-panels";

import { HoverTooltip } from "@/components/common/HoverTooltip";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import type { ToastKind } from "@/components/common/Toast";
import { ISP_LIST, ISP_TABS, type IspId, type IspTab } from "./ispTabs";

interface Props {
  isp: IspId;
  tabIdx: number;
  cppFileHint: string | null;
  cppPath: string | null;
  pickerRatios: number[];
  onIspChange: (id: IspId) => void;
  onTabChange: (idx: number) => void;
  onCppPathChange: (path: string) => void;
  onPickerRatiosChange: (sizes: number[]) => void;
  onToast: (toast: { kind: ToastKind; title: string; detail?: string; duration?: number }) => void;
}

const CPP_EXTS = ["cpp", "c", "h", "hpp", "cxx", "cc"];
const DEFAULT_PICKER_RATIOS = [68, 32];

export function IspSelectBar({
  isp,
  tabIdx,
  cppFileHint,
  cppPath,
  pickerRatios,
  onIspChange,
  onTabChange,
  onCppPathChange,
  onPickerRatiosChange,
  onToast,
}: Props) {
  const tabs = ISP_TABS[isp];
  const selectRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const lastHoverValidRef = useRef<"ok" | "bad" | null>(null);
  const [selectHover, setSelectHover] = useState(false);
  const [selectFocus, setSelectFocus] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [pickerHover, setPickerHover] = useState(false);
  const [pickerDropState, setPickerDropState] = useState<"ok" | "bad" | null>(null);
  const selectHighlighted = selectHover || selectFocus || selectOpen;
  const currentIspLabel = ISP_LIST.find((item) => item.id === isp)?.label ?? isp;
  const safeRatios = pickerRatios.length === 2 && pickerRatios.every((item) => Number.isFinite(item) && item > 0)
    ? pickerRatios
    : DEFAULT_PICKER_RATIOS;

  useEffect(() => {
    if (!selectOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!selectRef.current?.contains(event.target as Node)) setSelectOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selectOpen]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          const inside = hitTest(pickerRef.current, payload.position);
          const nextState = cppFileHint ? classifyCppDrop(payload.paths) : null;
          lastHoverValidRef.current = nextState;
          setPickerDropState(inside ? nextState : null);
          return;
        }
        if (payload.type === "over") {
          setPickerDropState(
            hitTest(pickerRef.current, payload.position) && cppFileHint
              ? lastHoverValidRef.current
              : null,
          );
          return;
        }
        if (payload.type === "leave") {
          setPickerDropState(null);
          lastHoverValidRef.current = null;
          return;
        }
        if (payload.type === "drop") {
          const inside = hitTest(pickerRef.current, payload.position);
          const nextState = lastHoverValidRef.current;
          setPickerDropState(null);
          lastHoverValidRef.current = null;
          if (!inside || nextState !== "ok" || !cppFileHint || payload.paths.length === 0) return;
          const path = payload.paths.find((item) => matchExt(item, CPP_EXTS));
          if (path) onCppPathChange(path);
        }
      });
    })();

    return () => {
      setPickerDropState(null);
      lastHoverValidRef.current = null;
      unlisten?.();
    };
  }, [cppFileHint, onCppPathChange]);

  const pickerHighlight = pickerHover || pickerDropState !== null;

  return (
    <div
      className="flex h-11 shrink-0 items-stretch gap-3 pl-0 pr-3"
      style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}
    >
      <div
        ref={selectRef}
        className="relative flex h-full w-[140px] items-stretch transition-colors"
        style={{
          background: selectHighlighted ? "var(--colorNeutralBackground3)" : "var(--colorNeutralBackground2)",
          borderRight: `1px solid ${selectHighlighted ? "var(--colorNeutralStroke1)" : "var(--colorNeutralStroke2)"}`,
          color: selectHighlighted ? "var(--colorNeutralForeground1)" : "var(--colorNeutralForeground2)",
        }}
        onMouseEnter={() => setSelectHover(true)}
        onMouseLeave={() => setSelectHover(false)}
      >
        <button
          type="button"
          className="flex h-full w-full items-center justify-between gap-2 px-3 text-sm transition-colors"
          aria-haspopup="listbox"
          aria-expanded={selectOpen}
          onClick={() => setSelectOpen((value) => !value)}
          onFocus={() => setSelectFocus(true)}
          onBlur={() => setSelectFocus(false)}
          style={{
            background: selectHighlighted ? "var(--colorNeutralBackground3)" : "var(--colorNeutralBackground2)",
            color: "inherit",
            outline: selectFocus ? "1px solid var(--colorBrandStroke1)" : "none",
            outlineOffset: -1,
          }}
        >
          <span>{currentIspLabel}</span>
          <ChevronDown16Regular
            className="shrink-0 transition-transform"
            style={{ transform: selectOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </button>

        {selectOpen && (
          <div
            role="listbox"
            className="absolute left-0 top-full z-50 w-full overflow-hidden rounded-b-md border text-sm shadow-lg"
            style={{
              background: "var(--colorNeutralBackground1)",
              borderColor: "var(--colorNeutralStroke2)",
              color: "var(--colorNeutralForeground1)",
              boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
            }}
          >
            {ISP_LIST.map((item, index) => (
              <IspOption
                key={item.id}
                id={item.id}
                label={item.label}
                active={item.id === isp}
                separated={index > 0}
                onSelect={(id) => {
                  onIspChange(id);
                  setSelectOpen(false);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 overflow-hidden">
        {cppFileHint ? (
          <PanelGroup direction="horizontal" className="h-full w-full">
            <Panel
              defaultSize={safeRatios[0]}
              minSize={36}
              onResize={(size) => onPickerRatiosChange([size, 100 - size])}
            >
              <div className="flex h-full min-w-0 items-stretch overflow-x-hidden">
                {tabs.map((tab, index) => (
                  <TabButton
                    key={`${tab.label}-${index}`}
                    tab={tab}
                    active={index === tabIdx}
                    onClick={() => onTabChange(index)}
                  />
                ))}
              </div>
            </Panel>

            <ResizeHandle direction="horizontal" size={8} alwaysVisible />

            <Panel
              defaultSize={safeRatios[1]}
              minSize={22}
              onResize={(size) => onPickerRatiosChange([100 - size, size])}
            >
              <ParameterPicker
                innerRef={pickerRef}
                fileHint={cppFileHint}
                path={cppPath}
                highlighted={pickerHighlight}
                dropState={pickerDropState}
                onHoverChange={setPickerHover}
                onToast={onToast}
                onPick={async () => {
                  const picked = await openDialog({
                    multiple: false,
                    filters: [{ name: "Source", extensions: CPP_EXTS }],
                  });
                  if (typeof picked === "string") onCppPathChange(picked);
                }}
              />
            </Panel>
          </PanelGroup>
        ) : (
          <div className="flex h-full min-w-0 items-stretch overflow-x-hidden">
            {tabs.map((tab, index) => (
              <TabButton
                key={`${tab.label}-${index}`}
                tab={tab}
                active={index === tabIdx}
                onClick={() => onTabChange(index)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IspOption({
  id,
  label,
  active,
  separated,
  onSelect,
}: {
  id: IspId;
  label: string;
  active: boolean;
  separated: boolean;
  onSelect: (id: IspId) => void;
}) {
  const [hover, setHover] = useState(false);
  const highlighted = hover || active;

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className="flex h-9 w-full items-center px-3 text-left transition-colors"
      style={{
        background: highlighted ? "var(--colorNeutralBackground3)" : "var(--colorNeutralBackground1)",
        borderTop: separated ? "1px solid var(--colorNeutralStroke2)" : "none",
        color: active ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground1)",
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onSelect(id)}
    >
      {label}
    </button>
  );
}

function TabButton({
  tab,
  active,
  onClick,
}: {
  tab: IspTab;
  active: boolean;
  onClick: () => void;
}) {
  const stub = tab.fileHint === null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex h-full items-center gap-2 px-4 text-sm transition-colors"
      style={{
        color: active ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground2)",
        fontWeight: active ? 600 : 500,
      }}
    >
      <span>{tab.label}</span>
      {stub && (
        <span
          className="rounded px-1.5 py-0.5 text-[10px]"
          style={{
            background: "var(--colorNeutralBackground3)",
            color: "var(--colorNeutralForeground3)",
          }}
        >
          待开发
        </span>
      )}
      {active && (
        <span
          aria-hidden
          className="absolute bottom-0 left-2 right-2 h-0.5 rounded"
          style={{ background: "var(--colorBrandForeground1)" }}
        />
      )}
    </button>
  );
}

function ParameterPicker({
  innerRef,
  fileHint,
  path,
  highlighted,
  dropState,
  onHoverChange,
  onToast,
  onPick,
}: {
  innerRef: MutableRefObject<HTMLDivElement | null>;
  fileHint: string;
  path: string | null;
  highlighted: boolean;
  dropState: "ok" | "bad" | null;
  onHoverChange: (next: boolean) => void;
  onToast: (toast: { kind: ToastKind; title: string; detail?: string; duration?: number }) => void;
  onPick: () => void | Promise<void>;
}) {
  const chrome = getPickerChrome(dropState, highlighted);
  const title = `${fileHint}参数路径`;
  const secondary = path ?? "未加载";
  const tooltip = path
    ? "左键单击更换参数文件，右键复制文件路径"
    : "左键单击选择参数文件";
  const [textHover, setTextHover] = useState(false);

  const copyPath = async () => {
    if (!path) {
      onToast({ kind: "error", title: "复制失败", duration: 1200 });
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      onToast({ kind: "success", title: "复制成功", duration: 1000 });
    } catch (error) {
      console.warn("copy parameter path failed", error);
      onToast({ kind: "error", title: "复制失败", duration: 1200 });
    }
  };

  const openPicker = (event?: React.MouseEvent | React.KeyboardEvent) => {
    event?.stopPropagation();
    void onPick();
  };

  return (
    <div className="flex h-full min-w-0 items-stretch pl-1">
      <div
        ref={innerRef}
        className="flex h-full w-full min-w-0 items-center gap-2 rounded-lg border px-3 text-left transition-colors"
        style={chrome}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
      >
        <button
          type="button"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
          style={{
            background: "var(--colorNeutralBackground3)",
            color: "var(--colorNeutralForeground2)",
          }}
          onClick={(event) => openPicker(event)}
          aria-label="选择参数文件"
        >
          <DocumentText24Regular className="h-4 w-4" />
        </button>
        <HoverTooltip content={tooltip} positioning="below-start" wrap maxWidth={520} inline>
          <span
            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-md px-2 py-1 transition-colors"
            style={{
              color: "var(--colorNeutralForeground1)",
              background: textHover ? "var(--colorSubtleBackgroundHover)" : "transparent",
            }}
            onMouseEnter={() => setTextHover(true)}
            onMouseLeave={() => setTextHover(false)}
            onFocus={() => setTextHover(true)}
            onBlur={() => setTextHover(false)}
            onClick={(event) => openPicker(event)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void copyPath();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            role="button"
            aria-label={tooltip}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openPicker(event);
              }
            }}
          >
            <span className="shrink-0 text-xs font-semibold">{title}</span>
            <span
              className="min-w-0 truncate text-[11px]"
              style={{ color: "var(--colorNeutralForeground3)" }}
            >
              {secondary}
            </span>
          </span>
        </HoverTooltip>
      </div>
    </div>
  );
}

function getPickerChrome(
  dropState: "ok" | "bad" | null,
  highlighted: boolean,
): React.CSSProperties {
  if (dropState === "ok") {
    return {
      background: "var(--colorPaletteGreenBackground1)",
      borderColor: "var(--colorPaletteGreenBorder2)",
      backdropFilter: "blur(6px)",
      height: "100%",
    };
  }
  if (dropState === "bad") {
    return {
      background: "var(--colorPaletteRedBackground1)",
      borderColor: "var(--colorPaletteRedBorder2)",
      backdropFilter: "blur(6px)",
      height: "100%",
    };
  }
  const isLight = document.documentElement.classList.contains("light");
  return {
    background: highlighted
      ? isLight ? "rgba(255,255,255,0.82)" : "rgba(0,0,0,0.26)"
      : isLight ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.18)",
    borderColor: highlighted
      ? isLight ? "rgba(138,132,151,0.38)" : "rgba(255,255,255,0.16)"
      : isLight ? "rgba(138,132,151,0.24)" : "rgba(255,255,255,0.08)",
    backdropFilter: "blur(6px)",
    height: "100%",
  };
}

function hitTest(el: HTMLElement | null, p: { x: number; y: number }): boolean {
  if (!el) return false;
  const dpr = window.devicePixelRatio || 1;
  const x = p.x / dpr;
  const y = p.y / dpr;
  const rect = el.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function matchExt(path: string, exts: string[]): boolean {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return exts.includes(lower.slice(dot + 1));
}

function classifyCppDrop(paths: string[]): "ok" | "bad" {
  if (paths.length === 0) return "bad";
  return paths.some((path) => matchExt(path, CPP_EXTS)) ? "ok" : "bad";
}
