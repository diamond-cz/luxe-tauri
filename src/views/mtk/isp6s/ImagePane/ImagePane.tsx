import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ImageEntry } from "@/ipc/imageScan";
import type { ParseResult } from "@/types/cpp_parser";
import { rememberSourceScroll, type WorkspaceSession } from "../workspaceSession";
import { cppClearCache, type CardSourceSpec, type Isp6sSchemaRoot } from "@/ipc/cppParser";
import { readTextFile, writeTempTextFile, writeTextFile } from "@/ipc/text";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import { useIsp6sVisualStore } from "@/stores/isp6sVisualStore";
import { WorkspaceHideButton } from "@/views/mtk/isp6s/WorkspaceColumns";
import { ChartMapMode, type ChartSourceJumpDetails } from "./ChartMapMode";
import { ToneChartMapMode } from "./ToneChartMapMode";
import { ParamMapMode, type ChartPreviewTarget, type SourceOverride } from "./ParamMapMode";
import {
  normalizeSourceText,
  serializeSourceText,
  sourceDraftDirty,
  type SourceCodeDraft,
} from "../SourceCodeView";
import {
  ChartMultiple24Regular,
  Code24Regular,
  CodeBlock24Regular,
} from "@fluentui/react-icons";

export type PreviewMode = "para_check" | "param_map" | "chart_map";

export interface SourceEditorBinding {
  filePath: string;
  importRevision: number;
  resolveFilePath: string | null;
  text: string;
  savedText: string;
  getText: () => string;
  onTextChange: (text: string) => void;
  onSave: () => Promise<void>;
  onSourceJump: (label: string, spec: CardSourceSpec, details?: ChartSourceJumpDetails) => void;
}

interface Props {
  mode:        PreviewMode | "image" | "image_split";
  toneMode?: boolean;
  toneParsed?: ParseResult | null;
  caLtmParsed?: ParseResult | null;
  caLtmPath?: string | null;
  caLtmRevision?: number;
  caLtmStatus?: "idle" | "parsing" | "done" | "error";
  caLtmMessage?: string | null;
  onMode:      (m: PreviewMode) => void;
  filePath:    string;
  importRevision: number;
  onCppPathChange: (path: string) => void;
  schema:      Isp6sSchemaRoot;
  entry:       ImageEntry | undefined;
  entries:     ImageEntry[];
  visibleHeatmapPaths?: string[] | null;
  tomlData:    Record<string, string>;
  onSelectHeatmapImages?: (paths: string[]) => void;
  onCalculatorSourcePathChange?: (path: string | null) => void;
  onSourceEditorBindingChange?: (binding: SourceEditorBinding | null) => void;
  scrollSession?: WorkspaceSession;
  onHide?: () => void;
}

const TABS: { id: PreviewMode; label: string; Icon: React.ComponentType }[] = [
  { id: "chart_map",   label: "图表映射", Icon: ChartMultiple24Regular },
  { id: "param_map",   label: "源码映射", Icon: Code24Regular },
];

const sourceHistorySnapshots = new Map<string, { revision: number; text: string }>();
const SOURCE_HISTORY_LIMIT = 3;

function sourceHistorySnapshot(path: string) {
  const snapshot = sourceHistorySnapshots.get(path);
  if (snapshot) {
    sourceHistorySnapshots.delete(path);
    sourceHistorySnapshots.set(path, snapshot);
  }
  return snapshot;
}

function rememberSourceHistory(path: string, snapshot: { revision: number; text: string }) {
  sourceHistorySnapshots.delete(path);
  sourceHistorySnapshots.set(path, snapshot);
  while (sourceHistorySnapshots.size > SOURCE_HISTORY_LIMIT) {
    sourceHistorySnapshots.delete(sourceHistorySnapshots.keys().next().value!);
  }
}

function useSourceDraft(filePath: string, importRevision: number) {
  const [draft, setDraft] = useState<SourceCodeDraft | null>(null);
  const draftRef = useRef<SourceCodeDraft | null>(null);
  const undoHistoryRef = useRef<string[]>([]);
  const redoHistoryRef = useRef<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tempDraft, setTempDraft] = useState<{ version: number; path: string; sourcePath: string } | null>(null);
  const [tempPending, setTempPending] = useState(false);
  const currentDraft = draft?.filePath === filePath ? draft : null;
  const dirty = sourceDraftDirty(currentDraft);
  const tempReady = Boolean(currentDraft && tempDraft && tempDraft.sourcePath === filePath && tempDraft.version === currentDraft.version);
  const resolvePath = dirty && tempReady ? tempDraft!.path : filePath;
  const chartPath = filePath ? (dirty
    ? (tempReady ? tempDraft!.path : tempDraft?.sourcePath === filePath ? tempDraft.path : filePath)
    : filePath) : null;
  const chartRevision = dirty ? (tempReady ? tempDraft!.version : 0) : currentDraft?.version ?? 0;

  useEffect(() => {
    let cancelled = false;
    setDraft(null);
    draftRef.current = null;
    undoHistoryRef.current = [];
    redoHistoryRef.current = [];
    setError(null);
    setTempDraft(null);
    setTempPending(false);
    if (!filePath) return;
    readTextFile(filePath)
      .then((rawText) => {
        if (cancelled) return;
        const normalized = normalizeSourceText(rawText);
        const previousSnapshot = sourceHistorySnapshot(filePath);
        const initialText = previousSnapshot?.revision === importRevision ? previousSnapshot.text : normalized.text;
        if (previousSnapshot?.revision !== importRevision) {
          rememberSourceHistory(filePath, { revision: importRevision, text: normalized.text });
        }
        const nextDraft: SourceCodeDraft = {
          filePath, text: normalized.text, savedText: normalized.text, initialText,
          lineEnding: normalized.lineEnding, version: 0, loadVersion: 1,
        };
        draftRef.current = nextDraft;
        setDraft(nextDraft);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, [filePath, importRevision]);

  useEffect(() => {
    if (!draft || !dirty || draft.filePath !== filePath) {
      setTempPending(false);
      return;
    }
    if (tempDraft?.version === draft.version) return;
    let cancelled = false;
    setTempPending(true);
    writeTempTextFile(filePath, serializeSourceText(draft))
      .then(async (path) => {
        await cppClearCache();
        if (!cancelled) setTempDraft({ version: draft.version, path, sourcePath: filePath });
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => { if (!cancelled) setTempPending(false); });
    return () => { cancelled = true; };
  }, [dirty, draft, filePath, tempDraft]);

  const onTextChange = useCallback((text: string) => {
    const current = draftRef.current;
    if (!current || current.filePath !== filePath || current.text === text) return;
    undoHistoryRef.current.push(current.text);
    redoHistoryRef.current = [];
    if (undoHistoryRef.current.length > 100) undoHistoryRef.current.shift();
    const nextDraft = { ...current, text, version: current.version + 1 };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, [filePath]);

  const onSave = useCallback(async () => {
    const currentDraft = draftRef.current;
    if (!currentDraft || currentDraft.filePath !== filePath) return;
    await writeTextFile(filePath, serializeSourceText(currentDraft));
    await cppClearCache();
    const current = draftRef.current;
    if (current?.filePath === filePath) {
      const nextDraft = { ...current, savedText: currentDraft.text, version: current.version + 1 };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      if (current.text === currentDraft.text) setTempDraft(null);
    }
  }, [filePath]);

  const onSaveAs = useCallback(async (path: string) => {
    const current = draftRef.current;
    if (current?.filePath === filePath) await writeTextFile(path, serializeSourceText(current));
  }, [filePath]);

  const onRestore = useCallback(() => {
    const current = draftRef.current;
    if (!current || current.filePath !== filePath || current.text === current.initialText) return;
    undoHistoryRef.current.push(current.text);
    redoHistoryRef.current = [];
    const nextDraft = { ...current, text: current.initialText, version: current.version + 1 };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setTempDraft(null);
  }, [filePath]);

  const onUndo = useCallback(() => {
    const current = draftRef.current;
    if (current?.filePath !== filePath) return;
    const previous = undoHistoryRef.current.pop();
    if (previous === undefined) return;
    redoHistoryRef.current.push(current.text);
    const nextDraft = { ...current, text: previous, version: current.version + 1 };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, [filePath]);

  const onRedo = useCallback(() => {
    const current = draftRef.current;
    if (current?.filePath !== filePath) return;
    const nextText = redoHistoryRef.current.pop();
    if (nextText === undefined) return;
    undoHistoryRef.current.push(current.text);
    const nextDraft = { ...current, text: nextText, version: current.version + 1 };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, [filePath]);

  const getText = useCallback(() => draftRef.current?.filePath === filePath ? draftRef.current.text : "", [filePath]);
  return { draft: currentDraft, error, dirty, tempReady, tempPending,
    resolvePath, chartPath, chartRevision, getText, onTextChange, onSave, onSaveAs, onRestore,
    onUndo, onRedo, undoHistoryRef, redoHistoryRef };
}

export function ImagePane({
  mode, toneMode = false, toneParsed, caLtmParsed, caLtmPath, caLtmRevision = 0, caLtmStatus, caLtmMessage, onMode, filePath, importRevision, onCppPathChange, schema, entry, entries, visibleHeatmapPaths, tomlData, onSelectHeatmapImages, onCalculatorSourcePathChange, onSourceEditorBindingChange, scrollSession, onHide,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const dropPathsRef = useRef<string[]>([]);
  const [dropState, setDropState] = useState<"ok" | "bad" | null>(null);
  const [sourceOverride, setSourceOverride] = useState<(SourceOverride & { filePath: string }) | undefined>(undefined);
  const toneSource = useSourceDraft(filePath, importRevision);
  const caSource = useSourceDraft(toneMode ? caLtmPath ?? "" : "", caLtmRevision);
  const toneTab = useIsp6sVisualStore((state) => state.visual.tone_chart_map_tab);
  const caLtmActive = toneMode && toneTab === "CA-LTM";
  const activeSource = caLtmActive ? caSource : toneSource;
  const activeFilePath = caLtmActive ? caLtmPath ?? "" : filePath;
  const [chartFocus, setChartFocus] = useState<{ label: string; key: number } | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [showModeLabels, setShowModeLabels] = useState(true);
  const effectiveMode: Exclude<PreviewMode, "para_check"> =
    mode === "chart_map" ? "chart_map" : "param_map";

  useLayoutEffect(() => {
    if (effectiveMode !== "chart_map" || !scrollSession) return;
    const scroller = chartWrapRef.current?.querySelector<HTMLElement>("[data-isp6s-chart-scroll]");
    const saved = scrollSession.sourceScroll[`${filePath}|chart_map`];
    if (!scroller || !saved) return;
    const restore = () => {
      scroller.scrollTop = saved.top;
      scroller.scrollLeft = saved.left;
      if (scroller.scrollTop >= saved.top - 1 && scroller.scrollLeft >= saved.left - 1) observer.disconnect();
    };
    const observer = new ResizeObserver(restore);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    const frame = window.requestAnimationFrame(restore);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [effectiveMode, filePath, scrollSession]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const insideCard = (position: { x: number; y: number }) => {
      const bounds = rootRef.current?.getBoundingClientRect();
      if (!bounds) return false;
      const scale = window.devicePixelRatio || 1;
      const x = position.x / scale;
      const y = position.y / scale;
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    };
    const cppPath = (paths: string[]) => paths.find((path) => /\.(cpp|c|h|hpp|cxx|cc)$/i.test(path));
    getCurrentWindow().onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "leave") {
        dropPathsRef.current = [];
        setDropState(null);
        return;
      }
      if (payload.type === "enter") dropPathsRef.current = payload.paths;
      const hovering = insideCard(payload.position);
      if (payload.type === "drop") {
        dropPathsRef.current = [];
        setDropState(null);
        const path = hovering ? cppPath(payload.paths) : undefined;
        if (path) onCppPathChange(path);
        return;
      }
      setDropState(hovering ? (cppPath(dropPathsRef.current) ? "ok" : "bad") : null);
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    }).catch((error) => console.warn("register source card drop listener failed", error));
    return () => {
      cancelled = true;
      dropPathsRef.current = [];
      unlisten?.();
    };
  }, [onCppPathChange]);

  const toneImportedPathsMatchDraft = Boolean(toneMode && toneSource.draft && toneParsed
    && toneSource.draft.text === toneSource.draft.initialText);
  const toneSourceFields = toneImportedPathsMatchDraft
    ? toneParsed?.fields
    : toneMode && toneSource.dirty && !toneSource.tempReady ? [] : undefined;
  const caImportedPathsMatchDraft = Boolean(caSource.draft && caLtmParsed
    && caSource.draft.text === caSource.draft.initialText);
  const activeSourceFields = caLtmActive
    ? caImportedPathsMatchDraft ? caLtmParsed?.fields : caSource.dirty && !caSource.tempReady ? [] : undefined
    : toneSourceFields;
  const activeSourceTree = caLtmActive
    ? caImportedPathsMatchDraft ? caLtmParsed?.tree : undefined
    : toneImportedPathsMatchDraft ? toneParsed?.tree : undefined;
  const calculatorSourcePath = toneSource.dirty
    ? toneSource.tempReady ? toneSource.resolvePath : null : filePath;
  useEffect(() => {
    onCalculatorSourcePathChange?.(calculatorSourcePath);
  }, [calculatorSourcePath, onCalculatorSourcePathChange]);
  void entry;

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const update = () => {
      const next = header.getBoundingClientRect().width >= 500;
      setShowModeLabels((current) => current === next ? current : next);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const handleMode = (nextMode: PreviewMode) => {
    if (nextMode === "param_map") {
      setSourceOverride(undefined);
    }
    if (nextMode === "chart_map") {
      setChartFocus(null);
    }
    onMode(nextMode);
  };

  const handleSourceJump = useCallback((label: string, spec: CardSourceSpec, details?: ChartSourceJumpDetails) => {
    setSourceOverride({ label, spec, details, filePath: activeFilePath });
    onMode("param_map");
  }, [activeFilePath, onMode]);

  const handleBackToChart = useCallback((target?: ChartPreviewTarget) => {
    if (target?.label) {
      setChartFocus((current) => ({
        label: target.label,
        key: (current?.key ?? 0) + 1,
      }));
    }
    onMode("chart_map");
  }, [onMode]);

  useEffect(() => {
    const onHistory = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (!rootRef.current?.contains(event.target as Node)) return;
      const key = event.key.toLowerCase();
      const undo = key === "z" && !event.shiftKey;
      const redo = key === "y" || (key === "z" && event.shiftKey);
      if (!undo && !redo) return;
      const available = undo ? activeSource.undoHistoryRef.current.length : activeSource.redoHistoryRef.current.length;
      if (!available) return;
      event.preventDefault();
      event.stopPropagation();
      if (undo) activeSource.onUndo();
      else activeSource.onRedo();
    };
    window.addEventListener("keydown", onHistory, true);
    return () => window.removeEventListener("keydown", onHistory, true);
  }, [effectiveMode, activeSource.onUndo, activeSource.onRedo,
    activeSource.undoHistoryRef, activeSource.redoHistoryRef]);

  useEffect(() => {
    onSourceEditorBindingChange?.(toneSource.draft?.filePath === filePath ? {
      filePath,
      importRevision,
      resolveFilePath: toneSource.dirty ? (toneSource.tempReady ? toneSource.resolvePath : null) : filePath,
      text: toneSource.draft.text,
      savedText: toneSource.draft.savedText,
      getText: toneSource.getText,
      onTextChange: toneSource.onTextChange,
      onSave: toneSource.onSave,
      onSourceJump: handleSourceJump,
    } : null);
  }, [filePath, importRevision, toneSource.draft, toneSource.dirty, toneSource.tempReady, toneSource.resolvePath,
    toneSource.getText, toneSource.onTextChange, toneSource.onSave, handleSourceJump, onSourceEditorBindingChange]);
  useEffect(() => () => onSourceEditorBindingChange?.(null), [onSourceEditorBindingChange]);

  return (
    <div ref={rootRef} className="relative flex h-full w-full flex-col"
         style={{
           background: dropState === "ok" ? "var(--colorPaletteGreenBackground1)" : "var(--colorNeutralBackground2)",
           border: `1px solid ${dropState === "ok" ? "var(--colorPaletteGreenBorder2)" : dropState === "bad" ? "var(--colorPaletteRedBorder2)" : "var(--colorNeutralStroke2)"}`,
           borderRadius: "12px 12px 0 0",
           overflow: "hidden",
         }}>
      <div ref={headerRef}
           className="flex h-8 shrink-0 items-center justify-between gap-3 px-4"
           style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
        <div className="flex shrink-0 items-center gap-2 text-xs"
             style={{ color: "var(--colorNeutralForeground2)" }}>
          <CodeBlock24Regular className="h-4 w-4"
                              style={{ color: "var(--colorBrandForeground1)" }} />
          <span>源代码卡片</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden">
          {TABS.map(({ id, label, Icon }) => {
            const active = id === effectiveMode;
            return (
              <HoverTooltip key={id} content={label} positioning="below-center" inline>
                <Button
                  size="small"
                  appearance={active ? "primary" : "subtle"}
                  icon={<Icon />}
                  onClick={() => handleMode(id)}
                  className="h-7"
                  style={{
                    minWidth: showModeLabels ? undefined : 32,
                    paddingLeft: showModeLabels ? undefined : 8,
                    paddingRight: showModeLabels ? undefined : 8,
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {showModeLabels ? label : null}
                </Button>
              </HoverTooltip>
            );
          })}
        </div>
        {onHide && <WorkspaceHideButton side="source" onHide={onHide} />}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {effectiveMode === "chart_map" && (toneMode ? Boolean(toneSource.chartPath || caLtmPath) : Boolean(toneSource.chartPath)) && (
          <div ref={chartWrapRef}
               style={{ width: "100%", height: "100%" }}
               onScrollCapture={(event) => {
                 const target = event.target;
                 if (target instanceof HTMLElement && target.matches("[data-isp6s-chart-scroll]") && scrollSession) {
                   rememberSourceScroll(scrollSession, `${filePath}|chart_map`, { top: target.scrollTop, left: target.scrollLeft });
                 }
               }}>
            {toneMode ? <ToneChartMapMode
              filePath={toneSource.chartPath ?? ""}
              parsed={toneParsed ?? null}
              caLtmParsed={caLtmParsed ?? null}
              caLtmPath={caLtmPath ?? null}
              caLtmSourcePath={caSource.chartPath}
              caLtmSourceRevision={caSource.chartRevision}
              caLtmStatus={caLtmStatus ?? "idle"}
              caLtmMessage={caLtmMessage ?? null}
              tomlData={tomlData}
              entries={entries}
              visibleHeatmapPaths={visibleHeatmapPaths}
              sourceDraftText={toneSource.draft?.text ?? null}
              sourceInitialText={toneSource.draft?.initialText ?? null}
              sourceSavedText={toneSource.draft?.savedText ?? null}
              onSourceDraftTextChange={toneSource.onTextChange}
              onSaveSourceDraft={toneSource.onSave}
              onSelectHeatmapImages={onSelectHeatmapImages}
              onSourceJump={handleSourceJump}
            /> : <ChartMapMode
              filePath={toneSource.chartPath!}
              sourceBasePath={filePath}
              schema={schema}
              entries={entries}
              visibleHeatmapPaths={visibleHeatmapPaths}
              tomlData={tomlData}
              active={effectiveMode === "chart_map"}
              onSelectHeatmapImages={onSelectHeatmapImages}
              focusTarget={chartFocus}
              onFocusHandled={(key) => setChartFocus((current) => current?.key === key ? null : current)}
              sourceRevision={toneSource.chartRevision}
              sourceDraftText={toneSource.draft?.text ?? null}
              sourceInitialText={toneSource.draft?.initialText ?? null}
              sourceSavedText={toneSource.draft?.savedText ?? null}
              onSourceDraftTextChange={toneSource.onTextChange}
              onSaveSourceDraft={toneSource.onSave}
              onSourceJump={handleSourceJump}
            />}
          </div>
        )}
        {effectiveMode === "chart_map" && !toneSource.chartPath && !toneMode && (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
            {toneSource.tempPending ? "\u6b63\u5728\u540c\u6b65\u6e90\u7801\u8349\u7a3f..." : "\u6e90\u7801\u8349\u7a3f\u672a\u51c6\u5907\u5b8c\u6210"}
          </div>
        )}
        {effectiveMode === "chart_map" && toneMode && !toneSource.chartPath && !caLtmPath && (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
            请在上方导入 Tone.cpp 或 CA-LTM.cpp 参数文件
          </div>
        )}
        {effectiveMode === "param_map"   && (
          <ParamMapMode
            key={activeFilePath}
            filePath={activeFilePath}
            resolveFilePath={activeSource.resolvePath}
            schema={schema}
            sourceOverride={sourceOverride?.filePath === activeFilePath ? sourceOverride : undefined}
            draft={activeSource.draft}
            draftLoadError={activeSource.error}
            onDraftTextChange={activeSource.onTextChange}
            onSaveDraft={activeSource.onSave}
            onSaveDraftAs={activeSource.onSaveAs}
            onRestoreDraft={activeSource.onRestore}
            onUndoDraft={activeSource.onUndo}
            onRedoDraft={activeSource.onRedo}
            canUndoDraft={activeSource.undoHistoryRef.current.length > 0}
            canRedoDraft={activeSource.redoHistoryRef.current.length > 0}
            onBackToChart={handleBackToChart}
            sourceFields={activeSourceFields}
            sourceTree={activeSourceTree}
            scrollSession={scrollSession}
          />
        )}
      </div>
    </div>
  );
}
