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
} from "../SourceCodeView";

interface Props {
  filePath: string;
  resolveFilePath: string;
  schema: Isp6sSchemaRoot;
  activeCard?: string;
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

export function ParamMapMode({
  filePath,
  resolveFilePath,
  schema,
  activeCard,
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
    const label = sourceOverride?.label ?? activeCard;
    if (!label) {
      setRanges([]);
      setJumpLine(1);
      setErr(null);
      return;
    }
    const spec = sourceOverride?.spec ?? schema.card_source?.[label];
    if (!spec) {
      setRanges([]);
      setJumpLine(1);
      setErr(`[card_source.${label}] \u672a\u914d\u7f6e`);
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
  }, [resolveFilePath, activeCard, schema, sourceOverride]);

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
          {sourceOverride?.label ?? activeCard
            ? `\u5361\u7247\uff1a${sourceOverride?.label ?? activeCard}`
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
          onPreviewChart={() => {
            const label = sourceOverride?.label ?? activeCard;
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
