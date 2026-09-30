import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { AppGeneric24Regular, ChevronDown16Regular, DocumentText24Regular } from "@fluentui/react-icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Panel, PanelGroup, type ImperativePanelHandle } from "react-resizable-panels";

import { HoverTooltip } from "@/components/common/HoverTooltip";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import type { ToastKind } from "@/components/common/Toast";
import { ISP_LIST, ISP_TABS, type IspId, type IspTab } from "./ispTabs";

interface Props {
  isp: IspId;
  tabIdx: number;
  cppFileHint: string | null;
  cppPath: string | null;
  debugParserPath: string | null;
  pickerRatios: number[];
  onRegisterWorkspaceDividerAlign: (align: ((x: number) => void) | null) => void;
  onIspChange: (id: IspId) => void;
  onTabChange: (idx: number) => void;
  onCppPathChange: (path: string) => void;
  onDebugParserPathChange: (path: string) => void;
  onPickerRatiosChange: (sizes: number[]) => void;
  onToast: (toast: { kind: ToastKind; title: string; detail?: string; duration?: number }) => void;
}

const CPP_EXTS = ["cpp", "c", "h", "hpp", "cxx", "cc"];
const DEFAULT_PICKER_RATIOS = [40, 60];
type PickerSlot = "cpp" | "debugParser" | null;

export function IspSelectBar({
  isp,
  tabIdx,
  cppFileHint,
  cppPath,
  debugParserPath,
  pickerRatios,
  onRegisterWorkspaceDividerAlign,
  onIspChange,
  onTabChange,
  onCppPathChange,
  onDebugParserPathChange,
  onPickerRatiosChange,
  onToast,
}: Props) {
  const tabs = ISP_TABS[isp];
  const selectRef = useRef<HTMLDivElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const pickerGroupRef = useRef<HTMLDivElement | null>(null);
  const tabPanelRef = useRef<ImperativePanelHandle | null>(null);
  const debugParserRef = useRef<HTMLDivElement | null>(null);
  const dropPathsRef = useRef<string[]>([]);
  const [selectHover, setSelectHover] = useState(false);
  const [selectFocus, setSelectFocus] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const [pickerHover, setPickerHover] = useState(false);
  const [pickerDropState, setPickerDropState] = useState<"ok" | "bad" | null>(null);
  const [debugParserHover, setDebugParserHover] = useState(false);
  const [debugParserDropState, setDebugParserDropState] = useState<"ok" | "bad" | null>(null);
  const selectHighlighted = selectHover || selectFocus || selectOpen;
  const currentIspLabel = ISP_LIST.find((item) => item.id === isp)?.label ?? isp;
  const safeRatios = pickerRatios.length === 2 && pickerRatios.every((item) => Number.isFinite(item) && item > 0)
    ? pickerRatios
    : DEFAULT_PICKER_RATIOS;
  const tabRatio = Math.max(16, Math.min(78, safeRatios[0]));

  const alignWorkspaceDivider = useCallback((workspaceDividerX: number) => {
    const group = pickerGroupRef.current;
    const panel = tabPanelRef.current;
    if (!cppFileHint || !group || !panel) return;
    const rect = group.getBoundingClientRect();
    const panelWidth = rect.width - 8;
    if (panelWidth <= 0) return;
    const ratio = ((workspaceDividerX - rect.left - 4) / panelWidth) * 100;
    const next = Math.max(16, Math.min(78, ratio));
    if (Math.abs(panel.getSize() - next) > 0.02) panel.resize(next);
  }, [cppFileHint]);

  useLayoutEffect(() => {
    onRegisterWorkspaceDividerAlign(alignWorkspaceDivider);
    return () => onRegisterWorkspaceDividerAlign(null);
  }, [alignWorkspaceDivider, onRegisterWorkspaceDividerAlign]);

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
    let cancelled = false;
    const slotAt = (position: { x: number; y: number }): PickerSlot => {
      if (!cppFileHint) return null;
      if (hitTest(debugParserRef.current, position)) return "debugParser";
      return hitTest(pickerRef.current, position) ? "cpp" : null;
    };
    const updateDropState = (slot: PickerSlot, paths: string[]) => {
      setPickerDropState(slot === "cpp" ? classifyPickerDrop(slot, paths) : null);
      setDebugParserDropState(slot === "debugParser" ? classifyPickerDrop(slot, paths) : null);
    };
    (async () => {
      const win = getCurrentWindow();
      const stopListening = await win.onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          dropPathsRef.current = payload.paths;
          updateDropState(slotAt(payload.position), payload.paths);
          return;
        }
        if (payload.type === "over") {
          updateDropState(slotAt(payload.position), dropPathsRef.current);
          return;
        }
        if (payload.type === "leave") {
          dropPathsRef.current = [];
          updateDropState(null, []);
          return;
        }
        if (payload.type === "drop") {
          const slot = slotAt(payload.position);
          dropPathsRef.current = [];
          updateDropState(null, []);
          if (!slot || classifyPickerDrop(slot, payload.paths) !== "ok") return;
          if (slot === "cpp") {
            const path = payload.paths.find((item) => matchExt(item, CPP_EXTS));
            if (path) onCppPathChange(path);
          } else {
            const path = payload.paths.find(isDebugParserPath);
            if (path) onDebugParserPathChange(path);
          }
        }
      });
      if (cancelled) stopListening();
      else unlisten = stopListening;
    })().catch((error) => console.warn("register picker drop listener failed", error));

    return () => {
      cancelled = true;
      dropPathsRef.current = [];
      unlisten?.();
    };
  }, [cppFileHint, onCppPathChange, onDebugParserPathChange]);

  const pickerHighlight = pickerHover || pickerDropState !== null;
  const debugParserHighlight = debugParserHover || debugParserDropState !== null;

  return (
    <div
      className="flex h-11 shrink-0 items-stretch gap-3 pl-0 pr-3"
      style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}
    >
      <div
        ref={selectRef}
        className="relative flex h-full w-[140px] shrink-0 items-stretch transition-colors"
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

      <div ref={pickerGroupRef} className="min-w-0 flex-1 overflow-hidden">
        {cppFileHint ? (
          <PanelGroup direction="horizontal" className="h-full w-full min-w-0">
            <Panel
              ref={tabPanelRef}
              defaultSize={tabRatio}
              minSize={16}
              maxSize={78}
              onResize={(size) => onPickerRatiosChange([size, 100 - size])}
            >
              <div className="flex h-full min-w-0 items-stretch overflow-x-auto overflow-y-hidden">
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
              defaultSize={100 - tabRatio}
              minSize={22}
            >
              <div className="flex h-full min-w-0 items-stretch gap-2 overflow-hidden">
                <div className="min-w-0" style={{ flex: "3 1 0" }}>
                  <PathPicker
                    innerRef={pickerRef}
                    title={`${cppFileHint}参数路径`}
                    fileLabel="参数文件"
                    icon={<DocumentText24Regular className="h-4 w-4" />}
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
                </div>
                <div className="min-w-0" style={{ flex: "2 1 0" }}>
                  <PathPicker
                    innerRef={debugParserRef}
                    title="DP解析工具路径"
                    fileLabel="DebugParser.exe"
                    icon={<AppGeneric24Regular className="h-4 w-4" />}
                    path={debugParserPath}
                    highlighted={debugParserHighlight}
                    dropState={debugParserDropState}
                    onHoverChange={setDebugParserHover}
                    onToast={onToast}
                    onPick={async () => {
                      const picked = await openDialog({
                        multiple: false,
                        filters: [{ name: "DebugParser.exe", extensions: ["exe"] }],
                      });
                      if (typeof picked !== "string") return;
                      if (!isDebugParserPath(picked)) {
                        onToast({ kind: "error", title: "请选择 DebugParser.exe" });
                        return;
                      }
                      onDebugParserPathChange(picked);
                    }}
                  />
                </div>
              </div>
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
      className="relative flex h-full shrink-0 items-center gap-2 px-2 text-xs transition-colors"
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

function PathPicker({
  innerRef,
  title,
  fileLabel,
  icon,
  path,
  highlighted,
  dropState,
  onHoverChange,
  onToast,
  onPick,
}: {
  innerRef: MutableRefObject<HTMLDivElement | null>;
  title: string;
  fileLabel: string;
  icon: React.ReactNode;
  path: string | null;
  highlighted: boolean;
  dropState: "ok" | "bad" | null;
  onHoverChange: (next: boolean) => void;
  onToast: (toast: { kind: ToastKind; title: string; detail?: string; duration?: number }) => void;
  onPick: () => void | Promise<void>;
}) {
  const chrome = getPickerChrome(dropState, highlighted);
  const secondary = path ?? "未加载";
  const tooltip = path
    ? `左键单击更换${fileLabel}，右键复制文件路径：${path}`
    : `左键单击选择${fileLabel}`;
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
      console.warn("copy file path failed", error);
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
          aria-label={`选择${fileLabel}`}
        >
          {icon}
        </button>
        <div className="min-w-0 flex-1 overflow-hidden">
          <HoverTooltip content={tooltip} positioning="below-start" wrap maxWidth={520}>
            <span
              className="flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 py-1 transition-colors"
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
              <span className="min-w-0 max-w-[70%] shrink truncate text-xs font-semibold">{title}</span>
              <span
                className="min-w-0 flex-1 truncate text-[11px]"
                style={{ color: "var(--colorNeutralForeground3)" }}
              >
                {secondary}
              </span>
            </span>
          </HoverTooltip>
        </div>
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

function isDebugParserPath(path: string): boolean {
  return path.split(/[\\/]/).pop()?.toLowerCase() === "debugparser.exe";
}

function classifyPickerDrop(slot: Exclude<PickerSlot, null>, paths: string[]): "ok" | "bad" {
  if (slot === "cpp") return classifyCppDrop(paths);
  return paths.some(isDebugParserPath) ? "ok" : "bad";
}
