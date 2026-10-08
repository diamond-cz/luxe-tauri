import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ImageEntry } from "@/ipc/imageScan";
import { cppClearCache, type CardSourceSpec, type Isp6sSchemaRoot } from "@/ipc/cppParser";
import { readTextFile, writeTempTextFile, writeTextFile } from "@/ipc/text";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import { ChartMapMode, type ChartSourceJumpDetails } from "./ChartMapMode";
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

interface Props {
  mode:        PreviewMode | "image" | "image_split";
  onMode:      (m: PreviewMode) => void;
  filePath:    string;
  onCppPathChange: (path: string) => void;
  schema:      Isp6sSchemaRoot;
  entry:       ImageEntry | undefined;
  entries:     ImageEntry[];
  tomlData:    Record<string, string>;
  onSelectHeatmapImages?: (paths: string[]) => void;
  onCalculatorSourcePathChange?: (path: string | null) => void;
  chartCardTarget?: CardJumpTarget;
  sourceCardTarget?: CardJumpTarget;
}

interface CardJumpTarget {
  label: string;
  key:   number;
}

const TABS: { id: PreviewMode; label: string; Icon: React.ComponentType }[] = [
  { id: "param_map",   label: "源码映射", Icon: Code24Regular },
  { id: "chart_map",   label: "图表映射", Icon: ChartMultiple24Regular },
];

export function ImagePane({
  mode, onMode, filePath, onCppPathChange, schema, entry, entries, tomlData, onSelectHeatmapImages, onCalculatorSourcePathChange, chartCardTarget, sourceCardTarget,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dropPathsRef = useRef<string[]>([]);
  const [dropState, setDropState] = useState<"ok" | "bad" | null>(null);
  const [internalCard] = useState<string | undefined>(undefined);
  const [sourceOverride, setSourceOverride] = useState<SourceOverride | undefined>(undefined);
  const [sourceDraft, setSourceDraft] = useState<SourceCodeDraft | null>(null);
  const [sourceDraftError, setSourceDraftError] = useState<string | null>(null);
  const [tempDraft, setTempDraft] = useState<{ version: number; path: string } | null>(null);
  const [tempDraftPending, setTempDraftPending] = useState(false);
  const [chartFocus, setChartFocus] = useState<{ label: string; key: number } | null>(null);
  const [chartMounted, setChartMounted] = useState(mode === "chart_map");
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [showModeLabels, setShowModeLabels] = useState(true);
  const effectiveMode: Exclude<PreviewMode, "para_check"> =
    mode === "chart_map" ? "chart_map" : "param_map";

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

  useEffect(() => {
    if (effectiveMode === "chart_map") setChartMounted(true);
  }, [effectiveMode]);
  const draftDirty = sourceDraftDirty(sourceDraft);
  const tempDraftReady = Boolean(sourceDraft && tempDraft && tempDraft.version === sourceDraft.version);
  const draftResolvePath = draftDirty && tempDraftReady ? tempDraft!.path : filePath;
  const chartFilePath = filePath ? (draftDirty ? (tempDraftReady ? tempDraft!.path : tempDraft?.path ?? filePath) : filePath) : null;
  const chartSourceRevision = draftDirty
    ? (tempDraftReady ? tempDraft!.version : tempDraft?.version ?? 0)
    : sourceDraft?.version ?? 0;
  const calculatorSourcePath = draftDirty ? (tempDraftReady ? tempDraft!.path : null) : filePath;
  useEffect(() => {
    onCalculatorSourcePathChange?.(calculatorSourcePath);
  }, [calculatorSourcePath, onCalculatorSourcePathChange]);
  void internalCard;
  void entry;

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const update = () => {
      setShowModeLabels(header.getBoundingClientRect().width >= 500);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSourceOverride(undefined);
    setChartFocus(null);
  }, [chartCardTarget?.key, sourceCardTarget?.key]);

  useEffect(() => {
    let cancelled = false;
    setSourceDraft(null);
    setSourceDraftError(null);
    setTempDraft(null);
    setTempDraftPending(false);
    if (!filePath) return;
    readTextFile(filePath)
      .then((rawText) => {
        if (cancelled) return;
        const normalized = normalizeSourceText(rawText);
        setSourceDraft({
          filePath,
          text: normalized.text,
          savedText: normalized.text,
          initialText: normalized.text,
          lineEnding: normalized.lineEnding,
          version: 0,
          loadVersion: 1,
        });
      })
      .catch((e) => {
        if (!cancelled) setSourceDraftError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

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

  const handleSourceJump = (label: string, spec: CardSourceSpec, details?: ChartSourceJumpDetails) => {
    setSourceOverride({ label, spec, details });
    onMode("param_map");
  };

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
    setSourceDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        text,
        version: current.version + 1,
      };
    });
  }, []);

  const handleSaveDraft = useCallback(async () => {
    const draft = sourceDraft;
    if (!draft) return;
    await writeTextFile(filePath, serializeSourceText(draft));
    await cppClearCache();
    setSourceDraft((current) => {
      if (!current || current.filePath !== draft.filePath || current.text !== draft.text) return current;
      return {
        ...current,
        savedText: draft.text,
        version: current.version + 1,
      };
    });
    setTempDraft(null);
  }, [filePath, sourceDraft]);

  const handleSaveDraftAs = useCallback(async (path: string) => {
    const draft = sourceDraft;
    if (!draft) return;
    await writeTextFile(path, serializeSourceText(draft));
  }, [sourceDraft]);

  const handleRestoreDraft = useCallback(() => {
    setSourceDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        text: current.initialText,
        version: current.version + 1,
      };
    });
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
        {chartMounted && chartFilePath && (
          <div style={{ display: effectiveMode === "chart_map" ? "block" : "none", width: "100%", height: "100%" }}>
            <ChartMapMode
              filePath={chartFilePath}
              schema={schema}
              entries={entries}
              tomlData={tomlData}
              active={effectiveMode === "chart_map"}
              onSelectHeatmapImages={onSelectHeatmapImages}
              activeCard={chartCardTarget?.label}
              activeCardKey={chartCardTarget?.key}
              focusTarget={chartFocus}
              onFocusHandled={(key) => setChartFocus((current) => current?.key === key ? null : current)}
              sourceRevision={chartSourceRevision}
              sourceDraftText={sourceDraft?.text ?? null}
              onSourceDraftTextChange={handleDraftTextChange}
              onSourceJump={handleSourceJump}
            />
          </div>
        )}
        {effectiveMode === "chart_map" && !chartFilePath && (
          <div className="flex h-full items-center justify-center text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
            {tempDraftPending ? "\u6b63\u5728\u540c\u6b65\u6e90\u7801\u8349\u7a3f..." : "\u6e90\u7801\u8349\u7a3f\u672a\u51c6\u5907\u5b8c\u6210"}
          </div>
        )}
        {effectiveMode === "param_map"   && (
          <ParamMapMode
            filePath={filePath}
            resolveFilePath={draftResolvePath}
            schema={schema}
            activeCard={sourceCardTarget?.label}
            activeCardKey={sourceCardTarget?.key}
            sourceOverride={sourceOverride}
            draft={sourceDraft}
            draftLoadError={sourceDraftError}
            onDraftTextChange={handleDraftTextChange}
            onSaveDraft={handleSaveDraft}
            onSaveDraftAs={handleSaveDraftAs}
            onRestoreDraft={handleRestoreDraft}
            onBackToChart={handleBackToChart}
          />
        )}
      </div>
    </div>
  );
}
