import { useEffect, useState } from "react";
import { Button } from "@fluentui/react-components";
import {
  ArrowDownload24Regular,
  ArrowReset24Regular,
  Save24Regular,
} from "@fluentui/react-icons";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";

import { HoverTooltip } from "@/components/common/HoverTooltip";
import { cppResolveCardSource } from "@/ipc/cppParser";
import type { CardSourceSpec, Isp6sSchemaRoot } from "@/ipc/cppParser";
import {
  SourceCodeView,
  sourceDraftCanRestore,
  sourceDraftDirty,
  type SourceCodeDraft,
  type SourceRangeGroup,
} from "../SourceCodeView";

interface Props {
  filePath: string;
  resolveFilePath: string;
  schema: Isp6sSchemaRoot;
  activeCard?: string;
  activeCardKey?: number;
  sourceOverride?: SourceOverride;
  draft: SourceCodeDraft | null;
  draftLoadError?: string | null;
  onDraftTextChange: (text: string) => void;
  onSaveDraft: () => Promise<void>;
  onSaveDraftAs: (path: string) => Promise<void>;
  onRestoreDraft: () => void;
  onBackToChart?: (target?: ChartPreviewTarget) => void;
}

export interface SourceOverride {
  label: string;
  spec: CardSourceSpec;
}

export interface ChartPreviewTarget {
  label: string;
}

const MAIN_T_SOURCE_RANGE_GROUPS: SourceRangeGroup[] = [
  {
    id: "mtwv",
    label: "MTWV",
    paths: ["[0][3][1][20]"],
    chartTargetLabel: "MTWV.weight_table",
  },
  {
    id: "mainTargetThreshold",
    label: "Main Target Threshold",
    paths: ["[0][3][1][22]", "[0][3][1][23]", "[0][3][1][24]"],
    chartTargetLabel: "Main_Target_Threshold.bv",
  },
  {
    id: "midCurve",
    label: "Mid 曲线",
    paths: ["[0][3][1].65", "[0][3][1].66", "[0][3][1].67", "[0][3][1].68"],
    chartTargetLabel: "Main_Target_Threshold.mid",
  },
  {
    id: "b2dOri",
    label: "B2D ori",
    paths: ["[0][3][1][45]", "[0][3][1][46]"],
    chartTargetLabel: "Main_Target_Threshold.mid",
  },
  {
    id: "b2dCorr",
    label: "B2D corr",
    paths: ["[0][3][1].73", "[0][3][1].74", "[0][3][1].75", "[0][3][1].76", "[0][3][1].77"],
    chartTargetLabel: "Main_Target_Threshold.mid",
  },
];
const MAIN_T_MID_SOURCE_RANGE_GROUPS = MAIN_T_SOURCE_RANGE_GROUPS.filter((group) =>
  group.id === "midCurve" || group.id === "b2dOri" || group.id === "b2dCorr",
);
const MAIN_TARGET_THRESHOLD_SOURCE_RANGE_GROUPS = MAIN_T_SOURCE_RANGE_GROUPS.filter((group) =>
  group.id === "mainTargetThreshold",
);
const MTWV_SOURCE_RANGE_GROUPS = MAIN_T_SOURCE_RANGE_GROUPS.filter((group) =>
  group.id === "mtwv",
);
const HS_WEIGHT_SOURCE_RANGE_GROUPS: SourceRangeGroup[] = [
  {
    id: "hsWeight",
    label: "HS.Weight",
    paths: ["[0][3][1][40]", "[0][3][1][41]", "[0][3][1][42]", "[0][3][1][43]"],
    chartTargetLabel: "HS.Weight",
  },
];
const HS_BRIGHT_AREA_SOURCE_RANGE_GROUPS: SourceRangeGroup[] = [
  {
    id: "hsBrightArea",
    label: "HS.Bright Area",
    paths: ["[0][3][1][25]", "[0][3][1][27]", "[0][3][1][28]", "[0][3][1].93", "[0][3][1].94"],
    chartTargetLabel: "HS.Bright Area",
  },
];
const HS_MIDDLE_AREA_SOURCE_RANGE_GROUPS: SourceRangeGroup[] = [
  {
    id: "hsMiddleArea",
    label: "HS.Middle Area",
    paths: ["[0][3][1][33]", "[0][3][1][35]", "[0][3][1][36]", "[0][3][1].98", "[0][3][1].99"],
    chartTargetLabel: "HS.Middle Area",
  },
];
const HS_DARK_AREA_SOURCE_RANGE_GROUPS: SourceRangeGroup[] = [
  {
    id: "hsDarkArea",
    label: "HS.Dark Area",
    paths: ["[0][3][1][37]", "[0][3][1][38]", "[0][3][1][39]", "[0][3][1].100", "[0][3][1].101"],
    chartTargetLabel: "HS.Dark Area",
  },
];

function sourceRangeGroupsForLabel(label: string | undefined): SourceRangeGroup[] | undefined {
  if (!label) return undefined;
  if (label === "MainT") return MAIN_T_SOURCE_RANGE_GROUPS;
  if (label === "HS.Weight") return HS_WEIGHT_SOURCE_RANGE_GROUPS;
  if (label === "HS.Bright Area" || label === "HS.Bright area") return HS_BRIGHT_AREA_SOURCE_RANGE_GROUPS;
  if (label === "HS.Middle Area" || label === "HS.Middle area") return HS_MIDDLE_AREA_SOURCE_RANGE_GROUPS;
  if (label === "HS.Dark Area" || label === "HS.Dark area") return HS_DARK_AREA_SOURCE_RANGE_GROUPS;
  if (label.startsWith("Main_Target_Threshold.mid")) return MAIN_T_MID_SOURCE_RANGE_GROUPS;
  if (label.startsWith("Main_Target_Threshold")) return MAIN_TARGET_THRESHOLD_SOURCE_RANGE_GROUPS;
  if (label.startsWith("MTWV")) return MTWV_SOURCE_RANGE_GROUPS;
  return undefined;
}

export function ParamMapMode({
  filePath,
  resolveFilePath,
  schema,
  activeCard,
  activeCardKey,
  sourceOverride,
  draft,
  draftLoadError,
  onDraftTextChange,
  onSaveDraft,
  onSaveDraftAs,
  onRestoreDraft,
  onBackToChart,
}: Props) {
  const [ranges, setRanges] = useState<Array<[number, number]>>([]);
  const [jumpLine, setJumpLine] = useState(1);
  const [jumpKey, setJumpKey] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const dirty = sourceDraftDirty(draft);
  const canRestore = sourceDraftCanRestore(draft);
  const activeLabel = sourceOverride?.label ?? activeCard;

  const handleSave = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setActionMessage(null);
    try {
      await onSaveDraft();
      setActionMessage("\u5df2\u4fdd\u5b58\u5230\u539f\u59cb\u53c2\u6570\u6587\u4ef6");
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAs = async () => {
    if (saving || !draft) return;
    const selected = await saveDialog({
      title: "\u53e6\u5b58\u4e3a\u65b0\u53c2\u6570\u6587\u4ef6",
      defaultPath: buildSaveAsDefaultPath(filePath),
      filters: [{ name: "Source", extensions: ["cpp", "c", "h", "hpp", "cxx", "cc"] }],
    });
    if (!selected) return;
    setSaving(true);
    setActionMessage(null);
    try {
      await onSaveDraftAs(selected);
      setActionMessage("\u5df2\u53e6\u5b58\u4e3a\u65b0\u53c2\u6570\u6587\u4ef6");
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = () => {
    if (!canRestore) return;
    onRestoreDraft();
    setActionMessage("\u5df2\u6062\u590d\u5230\u7b2c\u4e00\u6b21\u5bfc\u5165\u72b6\u6001");
  };

  useEffect(() => {
    setActionMessage(null);
    if (!activeLabel) {
      setRanges([]);
      setJumpLine(1);
      setErr(null);
      return;
    }
    const spec = sourceOverride?.spec ?? schema.card_source?.[activeLabel];
    if (!spec) {
      setRanges([]);
      setJumpLine(1);
      setErr(`[card_source.${activeLabel}] \u672a\u914d\u7f6e`);
      return;
    }

    let cancelled = false;
    cppResolveCardSource(resolveFilePath, spec)
      .then((hit) => {
        if (cancelled) return;
        setRanges(hit.ranges.map(([a, b]) => [a, b] as [number, number]));
        setJumpLine(hit.jump_line);
        setJumpKey((current) => current + 1);
        setErr(null);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [resolveFilePath, activeCard, activeCardKey, activeLabel, schema, sourceOverride]);

  return (
    <div className="flex h-full w-full flex-col">
      <div
        className="flex items-center gap-3 px-3 py-1.5 text-xs"
        style={{
          background: "var(--colorNeutralBackground3)",
          color: "var(--colorNeutralForeground3)",
          borderBottom: "1px solid var(--colorNeutralStroke2)",
        }}
      >
        <span className="shrink-0">
          {activeLabel
            ? `\u5361\u7247\uff1a${activeLabel}`
            : "\u70b9\u51fb\u5de6\u4fa7\u4efb\u4e00\u5b50\u5361\u7247\u5728\u6e90\u7801\u4e2d\u5b9a\u4f4d"}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-right"
          style={{ color: err ? "var(--colorPaletteRedForeground1)" : "var(--colorNeutralForeground3)" }}
        >
          {err ?? actionMessage}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <HoverTooltip content={"\u4fdd\u5b58\u5230\u539f\u59cb\u53c2\u6570\u6587\u4ef6"} positioning="below-center" inline>
            <Button
              size="small"
              appearance="subtle"
              icon={<Save24Regular />}
              disabled={!dirty || saving}
              onClick={handleSave}
              aria-label={"\u4fdd\u5b58\u5230\u539f\u59cb\u53c2\u6570\u6587\u4ef6"}
            />
          </HoverTooltip>
          <HoverTooltip content={"\u6062\u590d\u5230\u7b2c\u4e00\u6b21\u5bfc\u5165\u72b6\u6001"} positioning="below-center" inline>
            <Button
              size="small"
              appearance="subtle"
              icon={<ArrowReset24Regular />}
              disabled={!canRestore || saving}
              onClick={handleRestore}
              aria-label={"\u6062\u590d\u5230\u7b2c\u4e00\u6b21\u5bfc\u5165\u72b6\u6001"}
            />
          </HoverTooltip>
          <HoverTooltip content={"\u53e6\u5b58\u4e3a\u65b0\u53c2\u6570\u6587\u4ef6"} positioning="below-center" inline>
            <Button
              size="small"
              appearance="subtle"
              icon={<ArrowDownload24Regular />}
              disabled={!draft || saving}
              onClick={handleSaveAs}
              aria-label={"\u53e6\u5b58\u4e3a\u65b0\u53c2\u6570\u6587\u4ef6"}
            />
          </HoverTooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <SourceCodeView
          draft={draft}
          resolveFilePath={resolveFilePath}
          loadError={draftLoadError}
          ranges={ranges}
          jumpLine={jumpLine}
          jumpKey={jumpKey}
          onTextChange={onDraftTextChange}
          chartJumpLabel={activeLabel}
          rangeGroups={sourceRangeGroupsForLabel(activeLabel)}
          onPreviewChart={(targetLabel) => {
            const label = targetLabel ?? activeLabel;
            onBackToChart?.(label ? { label } : undefined);
          }}
        />
      </div>
    </div>
  );
}

function buildSaveAsDefaultPath(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (dot > slash) return `${filePath.slice(0, dot)}_modified${filePath.slice(dot)}`;
  return `${filePath}_modified.cpp`;
}
