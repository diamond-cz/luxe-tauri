import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ImageEntry } from "@/ipc/imageScan";
import type { ParseResult } from "@/types/cpp_parser";
import { rememberSourceScroll, type WorkspaceSession } from "../workspaceSession";
import { cppClearCache, type CardSourceSpec, type Isp6sSchemaRoot } from "@/ipc/cppParser";
import { readTextFile, writeTempTextFile, writeTextFile } from "@/ipc/text";
import { HoverTooltip } from "@/components/common/HoverTooltip";
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

export function ImagePane({
  mode, toneMode = false, toneParsed, onMode, filePath, importRevision, onCppPathChange, schema, entry, entries, visibleHeatmapPaths, tomlData, onSelectHeatmapImages, onCalculatorSourcePathChange, onSourceEditorBindingChange, scrollSession,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const dropPathsRef = useRef<string[]>([]);
  const [dropState, setDropState] = useState<"ok" | "bad" | null>(null);
  const [sourceOverride, setSourceOverride] = useState<SourceOverride | undefined>(undefined);
  const [sourceDraft, setSourceDraft] = useState<SourceCodeDraft | null>(null);
  const sourceDraftRef = useRef<SourceCodeDraft | null>(null);
  const undoHistoryRef = useRef<string[]>([]);
  const [sourceDraftError, setSourceDraftError] = useState<string | null>(null);
  const [tempDraft, setTempDraft] = useState<{ version: number; path: string } | null>(null);
  const [tempDraftPending, setTempDraftPending] = useState(false);
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

  const draftDirty = sourceDraftDirty(sourceDraft);
  const tempDraftReady = Boolean(sourceDraft && tempDraft && tempDraft.version === sourceDraft.version);
  const toneImportedPathsMatchDraft = Boolean(toneMode && sourceDraft && toneParsed && sourceDraft.text === sourceDraft.initialText);
  const toneSourceFields = toneImportedPathsMatchDraft
    ? toneParsed?.fields
    : toneMode && draftDirty && !tempDraftReady ? [] : undefined;
  const draftResolvePath = draftDirty && tempDraftReady ? tempDraft!.path : filePath;
  const chartFilePath = filePath ? (draftDirty ? (tempDraftReady ? tempDraft!.path : tempDraft?.path ?? filePath) : filePath) : null;
  const chartSourceRevision = draftDirty
    ? (tempDraftReady ? tempDraft!.version : tempDraft?.version ?? 0)
    : sourceDraft?.version ?? 0;
  const calculatorSourcePath = draftDirty ? (tempDraftReady ? tempDraft!.path : null) : filePath;
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

  useEffect(() => {
    let cancelled = false;
    setSourceDraft(null);
    sourceDraftRef.current = null;
    undoHistoryRef.current = [];
    setSourceDraftError(null);
    setTempDraft(null);
    setTempDraftPending(false);
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
          filePath,
          text: normalized.text,
          savedText: normalized.text,
          initialText,
          lineEnding: normalized.lineEnding,
          version: 0,
          loadVersion: 1,
        };
        sourceDraftRef.current = nextDraft;
        setSourceDraft(nextDraft);
      })
      .catch((e) => {
        if (!cancelled) setSourceDraftError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, importRevision]);

  useEffect(() => {
    if (!sourceDraft || !draftDirty) {
      setTempDraftPending(false);
      return;
    }
    if (tempDraft?.version === sourceDraft.version) return;

    let cancelled = false;
    const draft = sourceDraft;
    setTempDraftPending(true);
    writeTempTextFile(filePath, serializeSourceText(draft))
      .then(async (path) => {
        await cppClearCache();
        if (!cancelled) setTempDraft({ version: draft.version, path });
      })
      .catch((e) => {
        if (!cancelled) setSourceDraftError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setTempDraftPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draftDirty, filePath, sourceDraft, tempDraft]);

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
    setSourceOverride({ label, spec, details });
    onMode("param_map");
  }, [onMode]);

  const handleBackToChart = useCallback((target?: ChartPreviewTarget) => {
    if (target?.label) {
      setChartFocus((current) => ({
        label: target.label,
        key: (current?.key ?? 0) + 1,
      }));
    }
    onMode("chart_map");
  }, [onMode]);

  const handleDraftTextChange = useCallback((text: string) => {
    const current = sourceDraftRef.current;
    if (!current || current.text === text) return;
    undoHistoryRef.current.push(current.text);
    if (undoHistoryRef.current.length > 100) undoHistoryRef.current.shift();
    const nextDraft = { ...current, text, version: current.version + 1 };
    sourceDraftRef.current = nextDraft;
    setSourceDraft(nextDraft);
  }, []);

  useEffect(() => {
    if (effectiveMode !== "chart_map") return;
    const onUndo = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.shiftKey) return;
      if (!rootRef.current?.contains(event.target as Node)) return;
      const previous = undoHistoryRef.current.pop();
      const current = sourceDraftRef.current;
      if (previous === undefined || !current) return;
      event.preventDefault();
      event.stopPropagation();
      const nextDraft = { ...current, text: previous, version: current.version + 1 };
      sourceDraftRef.current = nextDraft;
      setSourceDraft(nextDraft);
    };
    window.addEventListener("keydown", onUndo, true);
    return () => window.removeEventListener("keydown", onUndo, true);
  }, [effectiveMode]);

  const handleSaveDraft = useCallback(async () => {
    const draft = sourceDraftRef.current;
    if (!draft) return;
    await writeTextFile(filePath, serializeSourceText(draft));
    await cppClearCache();
    const current = sourceDraftRef.current;
    if (current && current.filePath === draft.filePath) {
      const nextDraft = { ...current, savedText: draft.text, version: current.version + 1 };
      sourceDraftRef.current = nextDraft;
      setSourceDraft(nextDraft);
    }
    if (current?.text === draft.text) setTempDraft(null);
  }, [filePath]);

  const getDraftText = useCallback(() => sourceDraftRef.current?.text ?? "", []);
  useEffect(() => {
    onSourceEditorBindingChange?.(sourceDraft?.filePath === filePath ? {
      filePath,
      importRevision,
      resolveFilePath: draftDirty ? (tempDraftReady ? tempDraft!.path : null) : filePath,
      text: sourceDraft.text,
      savedText: sourceDraft.savedText,
      getText: getDraftText,
      onTextChange: handleDraftTextChange,
      onSave: handleSaveDraft,
      onSourceJump: handleSourceJump,
    } : null);
  }, [filePath, importRevision, sourceDraft, draftDirty, tempDraftReady, tempDraft, getDraftText,
    handleDraftTextChange, handleSaveDraft, handleSourceJump, onSourceEditorBindingChange]);
  useEffect(() => () => onSourceEditorBindingChange?.(null), [onSourceEditorBindingChange]);

  const handleSaveDraftAs = useCallback(async (path: string) => {
    const draft = sourceDraft;
    if (!draft) return;
    await writeTextFile(path, serializeSourceText(draft));
  }, [sourceDraft]);

  const handleRestoreDraft = useCallback(() => {
    const current = sourceDraftRef.current;
    if (!current || current.text === current.initialText) return;
    undoHistoryRef.current.push(current.text);
    const nextDraft = { ...current, text: current.initialText, version: current.version + 1 };
    sourceDraftRef.current = nextDraft;
    setSourceDraft(nextDraft);
    setTempDraft(null);
  }, []);

  return (
    <div ref={rootRef} className="relative flex h-full w-full flex-col"
         style={{
           background: dropState === "ok" ? "var(--colorPaletteGreenBackground1)" : "var(--colorNeutralBackground2)",
           border: `1px solid ${dropState === "ok" ? "var(--colorPaletteGreenBorder2)" : dropState === "bad" ? "var(--colorPaletteRedBorder2)" : "var(--colorNeutralStroke2)"}`,
           borderRadius: 12,
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
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {effectiveMode === "chart_map" && chartFilePath && (!toneMode || toneParsed) && (
          <div ref={chartWrapRef}
               style={{ width: "100%", height: "100%" }}
               onScrollCapture={(event) => {
                 const target = event.target;
                 if (target instanceof HTMLElement && target.matches("[data-isp6s-chart-scroll]") && scrollSession) {
                   rememberSourceScroll(scrollSession, `${filePath}|chart_map`, { top: target.scrollTop, left: target.scrollLeft });
                 }
               }}>
            {toneMode && toneParsed ? <ToneChartMapMode
              filePath={chartFilePath}
              parsed={toneParsed}
              tomlData={tomlData}
              entries={entries}
              visibleHeatmapPaths={visibleHeatmapPaths}
              sourceDraftText={sourceDraft?.text ?? null}
              sourceInitialText={sourceDraft?.initialText ?? null}
              sourceSavedText={sourceDraft?.savedText ?? null}
              onSourceDraftTextChange={handleDraftTextChange}
              onSaveSourceDraft={handleSaveDraft}
              onSelectHeatmapImages={onSelectHeatmapImages}
              onSourceJump={handleSourceJump}
            /> : <ChartMapMode
              filePath={chartFilePath}
              sourceBasePath={filePath}
              schema={schema}
              entries={entries}
              visibleHeatmapPaths={visibleHeatmapPaths}
              tomlData={tomlData}
              active={effectiveMode === "chart_map"}
              onSelectHeatmapImages={onSelectHeatmapImages}
              focusTarget={chartFocus}
              onFocusHandled={(key) => setChartFocus((current) => current?.key === key ? null : current)}
              sourceRevision={chartSourceRevision}
              sourceDraftText={sourceDraft?.text ?? null}
              sourceInitialText={sourceDraft?.initialText ?? null}
              sourceSavedText={sourceDraft?.savedText ?? null}
              onSourceDraftTextChange={handleDraftTextChange}
              onSaveSourceDraft={handleSaveDraft}
              onSourceJump={handleSourceJump}
            />}
          </div>
        )}
        {effectiveMode === "chart_map" && !chartFilePath && (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
            {tempDraftPending ? "\u6b63\u5728\u540c\u6b65\u6e90\u7801\u8349\u7a3f..." : "\u6e90\u7801\u8349\u7a3f\u672a\u51c6\u5907\u5b8c\u6210"}
          </div>
        )}
        {effectiveMode === "chart_map" && toneMode && chartFilePath && !toneParsed && (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
            正在解析 Tone.cpp...
          </div>
        )}
        {effectiveMode === "param_map"   && (
          <ParamMapMode
            filePath={filePath}
            resolveFilePath={draftResolvePath}
            schema={schema}
            sourceOverride={sourceOverride}
            draft={sourceDraft}
            draftLoadError={sourceDraftError}
            onDraftTextChange={handleDraftTextChange}
            onSaveDraft={handleSaveDraft}
            onSaveDraftAs={handleSaveDraftAs}
            onRestoreDraft={handleRestoreDraft}
            onBackToChart={handleBackToChart}
            sourceFields={toneSourceFields}
            sourceTree={toneImportedPathsMatchDraft ? toneParsed?.tree : undefined}
            scrollSession={scrollSession}
          />
        )}
      </div>
    </div>
  );
}
