import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import type { ImageEntry } from "@/ipc/imageScan";
import { cppClearCache, type CardSourceSpec, type Isp6sSchemaRoot } from "@/ipc/cppParser";
import { readTextFile, writeTempTextFile, writeTextFile } from "@/ipc/text";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import { ChartMapMode } from "./ChartMapMode";
import { ParaCheckMode } from "./ParaCheckMode";
import { ParamMapMode, type ChartPreviewTarget, type SourceOverride } from "./ParamMapMode";
import {
  normalizeSourceText,
  serializeSourceText,
  sourceDraftDirty,
  type SourceCodeDraft,
} from "../SourceCodeView";
import {
  PreviewLink24Regular,
  ChartMultiple24Regular,
  Code24Regular,
  CodeBlock24Regular,
} from "@fluentui/react-icons";

export type PreviewMode = "para_check" | "param_map" | "chart_map";

interface Props {
  mode:        PreviewMode | "image" | "image_split";
  onMode:      (m: PreviewMode) => void;
  filePath:    string;
  schema:      Isp6sSchemaRoot;
  entry:       ImageEntry | undefined;
  tomlData:    Record<string, string>;
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
  { id: "para_check",  label: "参数对比", Icon: PreviewLink24Regular },
];

export function ImagePane({
  mode, onMode, filePath, schema, entry, tomlData, chartCardTarget, sourceCardTarget,
}: Props) {
  const [internalCard] = useState<string | undefined>(undefined);
  const [sourceOverride, setSourceOverride] = useState<SourceOverride | undefined>(undefined);
  const [sourceDraft, setSourceDraft] = useState<SourceCodeDraft | null>(null);
  const [sourceDraftError, setSourceDraftError] = useState<string | null>(null);
  const [tempDraft, setTempDraft] = useState<{ version: number; path: string } | null>(null);
  const [tempDraftPending, setTempDraftPending] = useState(false);
  const [chartFocus, setChartFocus] = useState<{ label: string; key: number } | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [showModeLabels, setShowModeLabels] = useState(true);
  const effectiveMode: PreviewMode =
    mode === "image" || mode === "image_split" ? "param_map" : mode;
  const draftDirty = sourceDraftDirty(sourceDraft);
  const tempDraftReady = Boolean(sourceDraft && tempDraft && tempDraft.version === sourceDraft.version);
  const draftResolvePath = draftDirty && tempDraftReady ? tempDraft!.path : filePath;
  const chartFilePath = filePath ? (draftDirty ? (tempDraftReady ? tempDraft!.path : tempDraft?.path ?? filePath) : filePath) : null;
  const chartSourceRevision = draftDirty
    ? (tempDraftReady ? tempDraft!.version : tempDraft?.version ?? 0)
    : sourceDraft?.version ?? 0;
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
    if (effectiveMode !== "chart_map" || !sourceDraft || !draftDirty) {
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
  }, [draftDirty, effectiveMode, filePath, sourceDraft, tempDraft]);

  const handleMode = (nextMode: PreviewMode) => {
    if (nextMode === "param_map") {
      setSourceOverride(undefined);
    }
    if (nextMode === "chart_map") {
      setChartFocus(null);
    }
    onMode(nextMode);
  };

  const handleSourceJump = (label: string, spec: CardSourceSpec) => {
    setSourceOverride({ label, spec });
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
    <div className="flex h-full w-full flex-col"
         style={{
           background: "var(--colorNeutralBackground2)",
           border: "1px solid var(--colorNeutralStroke2)",
           borderRadius: 12,
           overflow: "hidden",
         }}>
      <div ref={headerRef}
           className="flex h-11 shrink-0 items-center justify-between gap-3 px-4"
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
                  className="h-8"
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
        {effectiveMode === "para_check"  && <ParaCheckMode  filePath={filePath} schema={schema} tomlData={tomlData} />}
        {effectiveMode === "chart_map" && chartFilePath && (
          <ChartMapMode
            filePath={chartFilePath}
            schema={schema}
            tomlData={tomlData}
            activeCard={chartCardTarget?.label}
            activeCardKey={chartCardTarget?.key}
            focusTarget={chartFocus}
            sourceRevision={chartSourceRevision}
            sourceDraftText={sourceDraft?.text ?? null}
            onSourceDraftTextChange={handleDraftTextChange}
            onSourceJump={handleSourceJump}
          />
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
