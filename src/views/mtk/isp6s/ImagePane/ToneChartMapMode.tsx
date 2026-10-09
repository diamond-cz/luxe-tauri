import { useEffect, useMemo, useRef, useState } from "react";
import { Code24Regular, DataHistogram24Regular, Save24Regular, TableLink24Regular } from "@fluentui/react-icons";
import { Panel, PanelGroup } from "react-resizable-panels";

import { parseCppFile, type CardSourceSpec } from "@/ipc/cppParser";
import { loadImageTomlFieldsBatch, type ImageEntry } from "@/ipc/imageScan";
import { useIsp6sVisualStore } from "@/stores/isp6sVisualStore";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import type { FieldEntry, ParseResult, StructNode } from "@/types/cpp_parser";
import type { ChartSourceJumpDetails } from "./ChartMapMode";

const TONE_TABS = ["LTM", "LCE", "GMA", "DCE", "CA-LTM"] as const;
type ToneTab = (typeof TONE_TABS)[number];

interface ToneGroup {
  path: string;
  label: string;
  line: number;
  fields: FieldEntry[];
}

interface Props {
  filePath: string;
  parsed: ParseResult;
  tomlData: Record<string, string>;
  entries: ImageEntry[];
  sourceDraftText: string | null;
  sourceInitialText: string | null;
  sourceSavedText: string | null;
  onSourceDraftTextChange: (text: string) => void;
  onSaveSourceDraft: () => Promise<void>;
  onSelectHeatmapImages?: (paths: string[]) => void;
  onSourceJump: (label: string, spec: CardSourceSpec, details?: ChartSourceJumpDetails) => void;
}

type ToneLceTableId = "ratio" | "target" | "prob" | "darkStrength" | "brightStrength" | "face";
type HeatmapMode = { enabled: boolean; showCounts: boolean };
type HeatmapPoint = { path: string; position: LceImagePosition };

const TONE_HEATMAP_KEYS = ["SW_LCE_LV", "SW_LCE_CurrDR", "SW_LCE_LVIdx_L", "SW_LCE_LVIdx_H", "SW_LCE_DRIdx_L", "SW_LCE_DRIdx_H"];
const TONE_NUMBER_RE = /[-+]?(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;
const toneSourceLines = new Map<string, string[]>();

function sourceLines(text: string): string[] {
  const cached = toneSourceLines.get(text);
  if (cached) return cached;
  const lines = text.split("\n");
  if (toneSourceLines.size >= 3) toneSourceLines.delete(toneSourceLines.keys().next().value!);
  toneSourceLines.set(text, lines);
  return lines;
}

interface AxisBracket {
  low: number;
  high: number;
  weight: number;
}

interface LceImagePosition {
  lv: number;
  dr: number;
  lvLow: number;
  lvHigh: number;
  drLow: number;
  drHigh: number;
}

function imageNumber(data: Record<string, string>, key: string): number {
  const raw = data[key] ?? data[key.toLowerCase()];
  if (!raw || raw.trim() === "-") return NaN;
  const value = Number(raw);
  return Number.isFinite(value) ? value : NaN;
}

function imagePosition(data: Record<string, string>): LceImagePosition {
  return {
    lv: imageNumber(data, "SW_LCE_LV"),
    dr: imageNumber(data, "SW_LCE_CurrDR"),
    lvLow: imageNumber(data, "SW_LCE_LVIdx_L"),
    lvHigh: imageNumber(data, "SW_LCE_LVIdx_H"),
    drLow: imageNumber(data, "SW_LCE_DRIdx_L"),
    drHigh: imageNumber(data, "SW_LCE_DRIdx_H"),
  };
}

function numericTokens(line: string): RegExpMatchArray[] {
  const commentStart = line.indexOf("//");
  const code = commentStart < 0 ? line : line.slice(0, commentStart);
  return Array.from(code.matchAll(TONE_NUMBER_RE));
}

function fieldsByLine(fields: FieldEntry[]): Map<number, FieldEntry[]> {
  const grouped = new Map<number, FieldEntry[]>();
  for (const field of fields) {
    const line = grouped.get(field.line) ?? [];
    line.push(field);
    grouped.set(field.line, line);
  }
  for (const line of grouped.values()) line.sort((a, b) => a.column_start - b.column_start || a.index - b.index);
  return grouped;
}

function fieldOrdinal(field: FieldEntry, lineFields: Map<number, FieldEntry[]>): number {
  return (lineFields.get(field.line) ?? []).findIndex((item) =>
    item.path === field.path && item.index === field.index && item.column_start === field.column_start);
}

function fieldToken(text: string | null, field: FieldEntry, lineFields: Map<number, FieldEntry[]>): string | null {
  if (!text) return null;
  const line = sourceLines(text)[field.line - 1];
  if (line === undefined) return null;
  return numericTokens(line)[fieldOrdinal(field, lineFields)]?.[0] ?? null;
}

function lastLineComment(text: string | null, field: FieldEntry | undefined): string | undefined {
  if (!text || !field) return undefined;
  const line = sourceLines(text)[field.line - 1];
  const comment = line?.match(/\/\/\s*([^/\r\n]*)\s*$/)?.[1]?.trim();
  return comment || undefined;
}

function replaceFieldToken(text: string, field: FieldEntry, lineFields: Map<number, FieldEntry[]>, value: string): string | null {
  const lines = [...sourceLines(text)];
  const line = lines[field.line - 1];
  if (line === undefined) return null;
  const token = numericTokens(line)[fieldOrdinal(field, lineFields)];
  if (token?.index === undefined) return null;
  lines[field.line - 1] = line.slice(0, token.index) + value + line.slice(token.index + token[0].length);
  return lines.join("\n");
}

function tableDirty(rows: FieldEntry[][], draft: string | null, saved: string | null, lineFields: Map<number, FieldEntry[]>): boolean {
  if (!draft || !saved) return false;
  return rows.some((fields) => fields.some((field) => fieldToken(draft, field, lineFields) !== fieldToken(saved, field, lineFields)));
}

function fieldChangeColor(field: FieldEntry, current: string, initial: string | null, lineFields: Map<number, FieldEntry[]>): string | undefined {
  const baselineToken = fieldToken(initial, field, lineFields);
  if (baselineToken === null) return undefined;
  const baseline = Number(baselineToken);
  const value = Number(current);
  if (!Number.isFinite(baseline) || !Number.isFinite(value)) return undefined;
  return value > baseline ? "var(--colorPaletteRedForeground1)" : value < baseline ? "var(--colorPaletteBlueForeground2)" : undefined;
}

function axisBracket(value: number, points: number[]): AxisBracket | null {
  if (!Number.isFinite(value)) return null;
  const valid = points.map((point, index) => ({ point, index }))
    .filter(({ point }) => Number.isFinite(point))
    .sort((a, b) => a.point - b.point);
  if (valid.length === 0) return null;
  if (value <= valid[0].point) return { low: valid[0].index, high: valid[0].index, weight: 0 };
  for (let index = 1; index < valid.length; index += 1) {
    const left = valid[index - 1];
    const right = valid[index];
    if (value <= right.point) {
      if (value === right.point) return { low: right.index, high: right.index, weight: 0 };
      if (right.point === left.point) return { low: left.index, high: left.index, weight: 0 };
      return { low: left.index, high: right.index, weight: (value - left.point) / (right.point - left.point) };
    }
  }
  const last = valid[valid.length - 1].index;
  return { low: last, high: last, weight: 0 };
}

function indexedBracket(value: number, low: number, high: number, count: number): AxisBracket | null {
  if (!Number.isFinite(value) || count === 0) return null;
  if (Number.isInteger(low) && Number.isInteger(high) && low >= 0 && low <= high && high < count) {
    return { low, high, weight: low === high ? 0 : Math.max(0, Math.min(1, (value - low) / (high - low))) };
  }
  return axisBracket(value, Array.from({ length: count }, (_, index) => index));
}

function interpolateFields(fields: FieldEntry[], bracket: AxisBracket | null): number {
  if (!bracket) return NaN;
  const left = Number(fields[bracket.low]?.value);
  if (!Number.isFinite(left)) return NaN;
  if (bracket.low === bracket.high) return left;
  const right = Number(fields[bracket.high]?.value);
  return Number.isFinite(right) ? left + (right - left) * bracket.weight : NaN;
}

function interpolateMatrix(rows: FieldEntry[][], row: AxisBracket | null, column: AxisBracket | null): number {
  if (!row || !column) return NaN;
  const low = interpolateFields(rows[row.low] ?? [], column);
  if (row.low === row.high) return low;
  const high = interpolateFields(rows[row.high] ?? [], column);
  return Number.isFinite(low) && Number.isFinite(high) ? low + (high - low) * row.weight : NaN;
}

function formatInterpolation(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(2))) : "-";
}

function bracketHits(bracket: AxisBracket | null, index: number): boolean {
  return bracket !== null && (index === bracket.low || index === bracket.high);
}

function toneHeatmapHits(tableId: ToneLceTableId, points: HeatmapPoint[], tables: ToneLceTables, rowCount: number, columnCount: number): string[][][] {
  const hits = Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => [] as string[]));
  for (const point of points) {
    const position = point.position;
    const lv = tableId === "ratio"
      ? axisBracket(position.lv, tables.ratio[0].map((field) => Number(field.value)))
      : indexedBracket(position.lv / 10, position.lvLow, position.lvHigh, columnCount);
    if (!lv) continue;
    const dr = tableId === "ratio" || tableId === "target" || tableId === "prob" || tableId === "face" ? null
      : indexedBracket(position.dr / 100, position.drLow, position.drHigh, rowCount);
    if (tableId === "darkStrength" || tableId === "brightStrength") {
      if (!dr) continue;
    }
    const rowIndexes = dr ? [...new Set([dr.low, dr.high])] : Array.from({ length: rowCount }, (_, index) => index);
    for (const row of rowIndexes) {
      for (const column of new Set([lv.low, lv.high])) hits[row][column]?.push(point.path);
    }
  }
  return hits;
}

function heatCellStyle(count: number, maximum: number): React.CSSProperties {
  const intensity = maximum > 0 ? Math.log1p(count) / Math.log1p(maximum) : 0;
  return { background: count > 0
    ? `color-mix(in srgb, var(--face-heat-high) ${Math.round(20 + intensity * 60)}%, var(--face-heat-low))`
    : "var(--colorNeutralBackground2)",
    color: count > 0 ? "var(--face-heat-fg)" : "var(--colorNeutralForeground3)" };
}

function toneTabForComment(comment: string): ToneTab | null {
  const normalized = comment.toUpperCase();
  if (/(?:^|[^A-Z0-9])CA[\s_-]*LTM(?:$|[^A-Z0-9])/.test(normalized)) return "CA-LTM";
  for (const tab of TONE_TABS) {
    if (tab === "CA-LTM") continue;
    if (new RegExp(`(?:^|[^A-Z0-9])${tab}(?:$|[^A-Z0-9])`).test(normalized)) return tab;
  }
  return null;
}

function fieldsUnder(node: StructNode): FieldEntry[] {
  return [...node.values, ...node.children.flatMap(fieldsUnder)];
}

function fieldsAtPath(result: ParseResult, path: string): FieldEntry[] {
  return result.fields
    .filter((field) => field.path === path || field.path.startsWith(`${path}.`) || field.path.startsWith(`${path}[`))
    .sort((a, b) => a.line - b.line || a.column_start - b.column_start || a.index - b.index);
}

const LCE_RATIO_PATHS = [
  "[0][0][0][0][0]", "[0][0][0][0][1]", "[0][0][0][0][2]",
] as const;
const LCE_TARGET_PATHS = [
  "[0][0][0][0][3]", "[0][0][0][0][4]", "[0][0][0][0][5]",
] as const;
const LCE_PROB_PATHS = Array.from({ length: 4 }, (_, index) => `[0][0][0][3][${index}]`);
const LCE_FACE_PATHS = Array.from({ length: 15 }, (_, index) => `[0][0][0][4][${index + 1}]`);
const LCE_DARK_STRENGTH_PATHS = Array.from({ length: 11 }, (_, index) => `[0][0][0][2][0][${index}]`);
const LCE_BRIGHT_STRENGTH_PATHS = Array.from({ length: 11 }, (_, index) => `[0][0][0][2][1][${index}]`);

function buildToneGroups(result: ParseResult): Record<ToneTab, ToneGroup[]> {
  const groups: Record<ToneTab, ToneGroup[]> = {
    LTM: [], LCE: [], GMA: [], DCE: [], "CA-LTM": [],
  };
  const assigned = new Set<string>();
  const visit = (node: StructNode) => {
    node.children.forEach(visit);
    const tab = toneTabForComment(node.section_comment);
    if (tab && node.path !== "[root]") {
      const fields = fieldsUnder(node)
        .filter((field) => !assigned.has(field.path)
          && (!toneTabForComment(field.comment) || toneTabForComment(field.comment) === tab))
        .sort((a, b) => a.line - b.line || a.index - b.index);
      if (fields.length > 0) {
        groups[tab].push({
          path: node.path,
          label: node.section_comment || node.path,
          line: node.line_start,
          fields,
        });
        fields.forEach((field) => assigned.add(field.path));
      }
    }
  };
  visit(result.tree);

  for (const field of result.fields) {
    if (assigned.has(field.path)) continue;
    const tab = toneTabForComment(field.comment);
    if (!tab) continue;
    const parentPath = field.path.replace(/\.\d+$/, "");
    let group = groups[tab].find((item) => item.path === parentPath);
    if (!group) {
      group = { path: parentPath, label: field.comment, line: field.line, fields: [] };
      groups[tab].push(group);
    }
    group.fields.push(field);
  }
  for (const tab of TONE_TABS) {
    groups[tab].sort((a, b) => a.line - b.line);
    groups[tab].forEach((group) => group.fields.sort((a, b) => a.line - b.line || a.index - b.index));
  }
  return groups;
}

export function ToneChartMapMode({
  filePath, parsed, tomlData, entries, sourceDraftText, sourceInitialText, sourceSavedText,
  onSourceDraftTextChange, onSaveSourceDraft, onSelectHeatmapImages, onSourceJump,
}: Props) {
  const [result, setResult] = useState(parsed);
  const [error, setError] = useState<string | null>(null);
  const savedTab = useIsp6sVisualStore((state) => state.visual.tone_chart_map_tab);
  const tab: ToneTab = TONE_TABS.find((item) => item === savedTab) ?? "LTM";
  const savedHeatmapModes = useIsp6sVisualStore((state) => state.visual.chart_face_heatmap_modes);
  const patchVisual = useIsp6sVisualStore((state) => state.patch);
  const setTab = (next: ToneTab) => patchVisual({ tone_chart_map_tab: next });
  const heatmapModes = Object.fromEntries(
    (["ratio", "target", "prob", "darkStrength", "brightStrength", "face"] as const).map((id) => {
      const saved = savedHeatmapModes?.[`ToneMap_${id}`];
      return [id, { enabled: saved?.enabled ?? false, showCounts: saved?.show_hit_counts ?? true }];
    }),
  ) as Record<ToneLceTableId, HeatmapMode>;
  const [heatmapData, setHeatmapData] = useState<{ entries: ImageEntry[]; points: HeatmapPoint[]; failed: boolean } | null>(null);
  const [heatmapRetry, setHeatmapRetry] = useState(0);
  const sourceDraftRef = useRef(sourceDraftText);
  sourceDraftRef.current = sourceDraftText;

  const heatmapRequested = Object.values(heatmapModes).some((mode) => mode.enabled);
  useEffect(() => {
    if (!heatmapRequested || entries.length === 0) return;
    let cancelled = false;
    loadImageTomlFieldsBatch(entries.map((entry) => entry.toml_path), TONE_HEATMAP_KEYS)
      .then((rows) => {
        if (!cancelled) setHeatmapData({ entries, points: entries.map((entry) => ({
          path: entry.toml_path, position: imagePosition(rows[entry.toml_path] ?? {}),
        })), failed: false });
      })
      .catch(() => { if (!cancelled) setHeatmapData({ entries, points: [], failed: true }); });
    return () => { cancelled = true; };
  }, [entries, heatmapRequested, heatmapRetry]);
  const currentHeatmap = heatmapData?.entries === entries ? heatmapData : null;
  const setHeatmapMode = (tableId: ToneLceTableId, patch: Partial<HeatmapMode>) => {
    const next = { ...heatmapModes[tableId], ...patch };
    patchVisual({ chart_face_heatmap_modes: {
      ...savedHeatmapModes,
      [`ToneMap_${tableId}`]: { enabled: next.enabled, show_hit_counts: next.showCounts },
    } });
  };
  const requestHeatmap = () => {
    if (currentHeatmap?.failed) {
      setHeatmapData(null);
      setHeatmapRetry((current) => current + 1);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!filePath) return;
    parseCppFile(filePath).then((next) => {
      if (!cancelled) {
        setResult(next);
        setError(null);
      }
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { cancelled = true; };
  }, [filePath, parsed]);

  const groups = useMemo(() => buildToneGroups(result), [result]);
  const currentGroups = groups[tab];
  const lceTables = useMemo(() => ({
    ratio: LCE_RATIO_PATHS.map((path) => fieldsAtPath(result, path)),
    target: LCE_TARGET_PATHS.map((path) => fieldsAtPath(result, path)),
    prob: LCE_PROB_PATHS.map((path) => fieldsAtPath(result, path)),
    face: LCE_FACE_PATHS.map((path) => fieldsAtPath(result, path)),
    darkStrength: LCE_DARK_STRENGTH_PATHS.map((path) => fieldsAtPath(result, path)),
    brightStrength: LCE_BRIGHT_STRENGTH_PATHS.map((path) => fieldsAtPath(result, path)),
  }), [result]);
  const currentPosition = imagePosition(tomlData);
  const lineFields = useMemo(() => fieldsByLine(result.fields), [result]);
  const displayedTables = useMemo<ToneLceTables>(() => {
    const overlay = (rows: FieldEntry[][]) => rows.map((fields) => fields.map((field) => {
      const value = fieldToken(sourceDraftText, field, lineFields);
      return value === null ? field : { ...field, value };
    }));
    return {
      ratio: overlay(lceTables.ratio), target: overlay(lceTables.target),
      prob: overlay(lceTables.prob), face: overlay(lceTables.face),
      darkStrength: overlay(lceTables.darkStrength), brightStrength: overlay(lceTables.brightStrength),
    };
  }, [lceTables, lineFields, sourceDraftText]);
  const commitCell = (field: FieldEntry, value: string): boolean => {
    const trimmed = value.trim();
    if (!/^[-+]?(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(trimmed)) return false;
    const current = sourceDraftRef.current;
    if (!current) return false;
    const next = replaceFieldToken(current, field, lineFields, trimmed);
    if (next === null) return false;
    if (next !== current) {
      sourceDraftRef.current = next;
      onSourceDraftTextChange(next);
    }
    return true;
  };
  const jumpToCell = (tableId: ToneLceTableId, field: FieldEntry, value: string) => {
    onSourceJump(`Tone.LCE.${tableId}.${field.path}`, {
      paths: [field.path], jump_to: "first", highlight: "ranges",
    }, { selection: { line: field.line, value, ordinal: fieldOrdinal(field, lineFields) } });
  };
  const tableProps = {
    tomlData, lineFields, sourceDraftText, sourceInitialText, sourceSavedText, onSaveSourceDraft, onCommit: commitCell,
    onCellJump: jumpToCell, heatmapModes, setHeatmapMode, requestHeatmap,
    heatmapPoints: currentHeatmap?.points ?? [], heatmapLoading: heatmapRequested && entries.length > 0 && !currentHeatmap,
    heatmapFailed: currentHeatmap?.failed ?? false, onSelectHeatmapImages, tables: displayedTables,
  };
  const jump = (label: string, firstLine: number, lastLine: number, field?: FieldEntry) => onSourceJump(label, {
    line_ranges: [[firstLine, lastLine]], jump_to: "first", highlight: "ranges",
  }, field ? { selection: {
    line: field.line,
    value: field.value,
    ordinal: 0,
    columnStart: field.column_start,
    columnEnd: field.column_end,
  } } : undefined);

  return (
    <div className="flex h-full w-full min-w-0 flex-col" style={{ background: "var(--colorNeutralBackground1)" }}>
      <div className="flex h-8 shrink-0 items-stretch overflow-x-auto border-b px-2"
           style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground2)" }} role="tablist">
        {TONE_TABS.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item}
                  onClick={() => setTab(item)}
                  className="shrink-0 border-b-2 px-3 text-xs"
                  style={{
                    borderColor: tab === item ? "var(--colorBrandStroke1)" : "transparent",
                    color: tab === item ? "var(--colorNeutralForeground1)" : "var(--colorNeutralForeground3)",
                    fontWeight: tab === item ? 600 : 400,
                  }}>{item}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3" role="tabpanel">
        {error && <div className="mb-2 text-xs" style={{ color: "var(--colorPaletteRedForeground1)" }}>{error}</div>}
        {tab === "LCE" ? (
          <div className="flex flex-col gap-3">
            <ToneLceTargetCard position={currentPosition} {...tableProps} onSourceJump={onSourceJump} />
            <ToneLceProbCard position={currentPosition} {...tableProps} onSourceJump={onSourceJump} />
            <ToneLceStrengthCard position={currentPosition} {...tableProps} onSourceJump={onSourceJump} />
            <ToneLceFaceCard position={currentPosition} {...tableProps} onSourceJump={onSourceJump} />
          </div>
        ) : currentGroups.length === 0 && (
          <div className="py-8 text-center text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
            Tone.cpp 中未找到带 {tab} 注释的参数段
          </div>
        )}
        {tab !== "LCE" && <div className="flex flex-col gap-3">
          {currentGroups.map((group) => (
            <section key={`${tab}:${group.path}:${group.line}`} className="min-w-0 overflow-hidden rounded-md border"
                     style={{ borderColor: "var(--colorNeutralStroke2)" }}>
              <div className="flex min-h-8 items-center gap-2 border-b px-3 py-1"
                   style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground2)" }}>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={group.label}>{group.label}</span>
                <button type="button" title={`跳转源码 ${group.path}`} aria-label={`跳转源码 ${group.path}`}
                        onClick={() => jump(group.label, group.fields[0].line, group.fields[group.fields.length - 1].line)}
                        style={{ color: "var(--colorBrandForeground1)" }}><Code24Regular className="h-4 w-4" /></button>
              </div>
              <div className="border-b px-3 py-1 font-mono text-[11px]"
                   style={{ borderColor: "var(--colorNeutralStroke2)", color: "var(--colorNeutralForeground3)" }}>
                paths={group.path} · L{group.line} · {group.fields.length} 个值
              </div>
              <ToneGroupRows group={group} onJump={(field) => jump(field.comment || field.path, field.line, field.line, field)} />
            </section>
          ))}
        </div>}
      </div>
    </div>
  );
}

interface ToneLceTables {
  ratio: FieldEntry[][];
  target: FieldEntry[][];
  prob: FieldEntry[][];
  face: FieldEntry[][];
  darkStrength: FieldEntry[][];
  brightStrength: FieldEntry[][];
}

interface ToneTableProps {
  tables: ToneLceTables;
  tomlData: Record<string, string>;
  lineFields: Map<number, FieldEntry[]>;
  sourceDraftText: string | null;
  sourceInitialText: string | null;
  sourceSavedText: string | null;
  onSaveSourceDraft: () => Promise<void>;
  onCommit: (field: FieldEntry, value: string) => boolean;
  onCellJump: (tableId: ToneLceTableId, field: FieldEntry, value: string) => void;
  onSourceJump: Props["onSourceJump"];
  heatmapModes: Record<ToneLceTableId, HeatmapMode>;
  setHeatmapMode: (tableId: ToneLceTableId, patch: Partial<HeatmapMode>) => void;
  requestHeatmap: () => void;
  heatmapPoints: HeatmapPoint[];
  heatmapLoading: boolean;
  heatmapFailed: boolean;
  onSelectHeatmapImages?: (paths: string[]) => void;
}

function ToneLceTableHeader({ tableId, title, result, rows, controls }: {
  tableId: ToneLceTableId;
  title: string;
  result: string;
  rows: FieldEntry[][];
  controls: ToneTableProps;
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = tableDirty(rows, controls.sourceDraftText, controls.sourceSavedText, controls.lineFields);
  const mode = controls.heatmapModes[tableId];
  return <div className="flex min-h-9 items-center justify-between gap-2 border-b px-2" style={{ borderColor: "var(--colorNeutralStroke2)", background: "color-mix(in srgb, var(--colorBrandBackground2) 18%, var(--colorNeutralBackground2))" }}>
    <div className="flex min-w-0 items-baseline gap-2 text-xs font-semibold">
      <span className="shrink-0">{title}</span>
      <strong className="min-w-0 truncate font-mono" style={{ color: "var(--colorBrandForeground1)" }} title={result}>{result}</strong>
    </div>
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" className="relative flex h-7 w-7 items-center justify-center" disabled={!dirty || saving} title={saveError ?? (dirty ? "保存表格修改" : "表格未修改")}
        aria-label="保存表格修改" style={{ opacity: dirty ? 1 : 0.45, color: "var(--colorBrandForeground1)" }}
        onClick={() => { setSaving(true); setSaveError(null); void controls.onSaveSourceDraft().catch((reason) => setSaveError(String(reason))).finally(() => setSaving(false)); }}>
        <Save24Regular className="h-4 w-4" />{dirty && <span className="absolute -right-0.5 -top-1 text-sm" style={{ color: "var(--colorPaletteRedForeground1)" }}>*</span>}
      </button>
      <button type="button" className="flex h-7 w-7 items-center justify-center" title={mode.enabled ? "左键关闭热力图，右键切换命中数/参数值" : "显示图片命中热力图"}
        aria-label={`${title} 热力图`} aria-pressed={mode.enabled}
        style={{ color: "var(--colorBrandForeground1)", background: mode.enabled ? "var(--colorBrandBackground2)" : undefined }}
        onClick={() => { if (!mode.enabled) controls.requestHeatmap(); controls.setHeatmapMode(tableId, { enabled: !mode.enabled }); }}
        onContextMenu={(event) => { if (!mode.enabled) return; event.preventDefault(); controls.setHeatmapMode(tableId, { showCounts: !mode.showCounts }); }}>
        <DataHistogram24Regular className="h-4 w-4" />
      </button>
      <button type="button" className="flex h-7 w-7 items-center justify-center" disabled={rows.every((row) => row.length === 0)}
        title={`跳转 ${title} 源码`} aria-label={`跳转 ${title} 源码`} style={{ color: "var(--colorBrandForeground1)" }}
        onClick={() => {
          const fields = rows.flat();
          controls.onSourceJump(`Tone.LCE.${tableId}`, {
            line_ranges: [[Math.min(...fields.map((field) => field.line)), Math.max(...fields.map((field) => field.line))]],
            jump_to: "first", highlight: "ranges",
          });
        }}>
        <TableLink24Regular className="h-4 w-4" />
      </button>
    </div>
  </div>;
}

function ToneCorner({ top, bottom }: { top: string; bottom: string }) {
  return <div className="relative min-w-0 border-b border-r text-[10px] font-bold" style={{ height: 40, borderColor: "var(--colorNeutralStroke1)", background: "color-mix(in srgb, var(--colorBrandBackground2) 35%, var(--colorNeutralBackground2))" }}>
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <line x1="0" y1="0" x2="100" y2="100" stroke="var(--colorNeutralStroke1)" vectorEffect="non-scaling-stroke" />
    </svg>
    <span className="absolute right-2 top-1">{top}</span><span className="absolute bottom-1 left-2">{bottom}</span>
  </div>;
}

function ToneNumberCell({ field, fallback, active, heat, hitCount, showCount, onHitImages, tableId, controls }: {
  field?: FieldEntry;
  fallback?: string;
  active: boolean;
  heat?: React.CSSProperties;
  hitCount?: number;
  showCount?: boolean;
  onHitImages?: () => void;
  tableId: ToneLceTableId;
  controls: ToneTableProps;
}) {
  const value = field?.value ?? fallback ?? "-";
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const lastCommitted = useRef<string | null>(null);
  const discardOnBlur = useRef(false);
  useEffect(() => { if (!focused) setDraft(value); }, [focused, value]);
  const commit = () => {
    if (!field || draft.trim() === value) return true;
    if (lastCommitted.current === draft.trim()) return true;
    if (!controls.onCommit(field, draft)) { setDraft(value); return false; }
    lastCommitted.current = draft.trim();
    return true;
  };
  const color = field ? fieldChangeColor(field, value, controls.sourceInitialText, controls.lineFields) : undefined;
  const cellStyle: React.CSSProperties = {
    minWidth: 0, minHeight: 26, borderRight: "1px solid var(--colorNeutralStroke2)", borderBottom: "1px solid var(--colorNeutralStroke2)",
    background: heat?.background ?? (active ? "var(--colorBrandBackground2)" : undefined),
    color: heat?.color ?? color ?? "var(--colorNeutralForeground1)",
    boxShadow: active ? "inset 0 0 0 1px var(--colorBrandStroke1)" : undefined,
  };
  if (showCount) return <div className="flex items-center justify-center font-mono text-[10px]" style={cellStyle}
    onContextMenu={(event) => { event.preventDefault(); if (!controls.heatmapLoading && !controls.heatmapFailed) onHitImages?.(); }}>
    {controls.heatmapLoading ? "…" : controls.heatmapFailed ? "-" : hitCount ?? 0}
  </div>;
  return <div style={cellStyle}>
    <input value={draft} readOnly={!field || !controls.sourceDraftText} aria-label={`${tableId} ${field?.path ?? fallback ?? ""}`}
      inputMode="decimal" className="h-full w-full min-w-0 bg-transparent px-1 text-right font-mono text-[10px] outline-none"
      style={{ color: "inherit", cursor: field ? "text" : "default" }}
      onFocus={(event) => { setFocused(true); event.currentTarget.select(); }}
      onBlur={() => { setFocused(false); if (discardOnBlur.current) discardOnBlur.current = false; else commit(); }}
      onChange={(event) => { lastCommitted.current = null; setDraft(event.target.value); }}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); } else if (event.key === "Escape") { discardOnBlur.current = true; setDraft(value); event.currentTarget.blur(); } }}
      onContextMenu={(event) => { if (!field) return; event.preventDefault(); const ok = commit(); controls.onCellJump(tableId, field, ok ? draft.trim() : value); }} />
  </div>;
}

function ToneLceTargetCard(props: ToneTableProps & { position: LceImagePosition }) {
  const { tables, position } = props;
  const ratioLabels = ["LV(Base10)", "DStrenthRatio", "BStrenthRatio"];
  const targetLabels = ["LVTarget", "MaxLceGain", "MaxFinalTarget"];
  const targetWidth = Math.max(1, ...tables.target.map((fields) => fields.length));
  const ratioBracket = axisBracket(position.lv, tables.ratio[0].map((field) => Number(field.value)));
  const targetBracket = indexedBracket(position.lv / 10, position.lvLow, position.lvHigh, targetWidth);
  return (
    <section className="min-w-0 border" style={{ borderColor: "var(--colorNeutralStroke2)" }}>
      <div className="flex h-7 items-center border-b px-2 text-xs font-semibold"
           style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground3)" }}>Target</div>
      <div className="flex min-w-0 flex-col gap-2 p-2">
        <PanelGroup direction="horizontal" autoSaveId="isp6s-tone-lce-ratio-cal" className="flex w-full min-w-0 items-stretch">
          <Panel defaultSize={50} minSize={25} className="flex min-w-0 flex-col">
            <ToneLceValueGrid tableId="ratio" title="Ratio" labels={ratioLabels} rows={tables.ratio} bracket={ratioBracket} controls={props} fillHeight />
          </Panel>
          <ResizeHandle direction="horizontal" size={8} />
          <Panel defaultSize={50} minSize={25} className="min-w-0">
            <ToneLceCalCard tomlData={props.tomlData} parameterLvTarget={interpolateFields(tables.target[0] ?? [], targetBracket)} />
          </Panel>
        </PanelGroup>
        <ToneLceValueGrid tableId="target" title="Target" labels={targetLabels} rows={tables.target} bracket={targetBracket} controls={props} />
      </div>
    </section>
  );
}

function ToneLceCalCard({ tomlData, parameterLvTarget }: { tomlData: Record<string, string>; parameterLvTarget: number }) {
  const lvTarget = imageNumber(tomlData, "SW_LCE_LVTarget");
  const lvProb = imageNumber(tomlData, "SW_LCE_LVProb");
  const lumaTarget = imageNumber(tomlData, "SW_LCE_LumaFlatTarget");
  const lumaProb = imageNumber(tomlData, "SW_LCE_LumaFlatProb");
  const flatProb = imageNumber(tomlData, "SW_LCE_FlatProb");
  const flatTarget = imageNumber(tomlData, "SW_LCE_FlatTarget");
  const lumaFlatProb = Math.round(lumaProb * flatProb / 1000);
  const finalTarget = Math.round((lvTarget * lvProb + lumaTarget * (1000 - lvProb)) / 1000);
  const parameterFinalTarget = Math.round((parameterLvTarget * lvProb + lumaTarget * (1000 - lvProb)) / 1000);
  const lumaFlatTarget = flatTarget * lumaFlatProb + lumaTarget * (1000 - lumaFlatProb);
  const value = (number: number) => Number.isFinite(number) ? String(number) : "-";

  return <section className="flex h-full min-w-0 flex-col border" style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground1)" }}>
    <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-2 border-b px-2 text-xs font-semibold"
      style={{ borderColor: "var(--colorNeutralStroke2)", background: "color-mix(in srgb, var(--colorBrandBackground2) 18%, var(--colorNeutralBackground2))" }}>
      <span>Cal <span className="font-mono font-normal">EXIF: {value(finalTarget)}</span></span>
      <span className="font-mono font-normal">参数插值: {value(parameterFinalTarget)}</span>
    </div>
    <div className="flex min-w-0 flex-col gap-2 p-2 font-mono text-[11px] leading-5"
      style={{ color: "var(--colorNeutralForeground1)", overflowWrap: "anywhere" }}>
      <div>FinalTarget = (LVTarget * LVProb + LumaFlatTarget * (1000 - LVProb)) / 1000</div>
      <div>EXIF: ({value(lvTarget)} * {value(lvProb)} + {value(lumaTarget)} * (1000 - {value(lvProb)})) / 1000 = <strong>{value(finalTarget)}</strong></div>
      <div>lumaFlatProb = (LumaProb * FlatProb) / 1000 = ({value(lumaProb)} * {value(flatProb)}) / 1000 = <strong>{value(lumaFlatProb)}</strong></div>
      <div>LumaFlatTarget = FlatTarget * LumaFlatProb + LumaTarget * (1000 - LumaFlatProb)</div>
      <div>EXIF: {value(flatTarget)} * {formatInterpolation(lumaFlatProb)} + {value(lumaTarget)} * (1000 - {formatInterpolation(lumaFlatProb)}) = <strong>{formatInterpolation(lumaFlatTarget)}</strong></div>
    </div>
  </section>;
}

function ToneLceProbCard(props: ToneTableProps & { position: LceImagePosition }) {
  const labels = ["LVBriRatio", "LVBriLimit", "FlatLumaLoBound", "FlatLumaHiBound"];
  const width = Math.max(1, ...props.tables.prob.map((fields) => fields.length));
  const bracket = indexedBracket(props.position.lv / 10, props.position.lvLow, props.position.lvHigh, width);
  return <ToneLceValueGrid tableId="prob" title="Prob" labels={labels} rows={props.tables.prob}
    bracket={bracket} controls={props} />;
}

function ToneLceFaceCard(props: ToneTableProps & { position: LceImagePosition }) {
  const labels = LCE_FACE_PATHS.map((_, index) => `i4LCEfaceTbL${index + 1}`);
  const width = Math.max(1, ...props.tables.face.map((fields) => fields.length));
  const bracket = indexedBracket(props.position.lv / 10, props.position.lvLow, props.position.lvHigh, width);
  const rowTooltips = props.tables.face.map((fields, index) => index === 0
    ? "Dark linear blend strength (1000-based)"
    : lastLineComment(props.sourceDraftText, fields[0]));
  return <ToneLceValueGrid tableId="face" title="Face_LCE" labels={labels} rows={props.tables.face}
    bracket={bracket} rowTooltips={rowTooltips} showResult={false} controls={props} />;
}

function ToneLceStrengthCard(props: ToneTableProps & { position: LceImagePosition }) {
  const { tables, position } = props;
  const lvCount = Math.max(19, ...tables.darkStrength.map((fields) => fields.length), ...tables.brightStrength.map((fields) => fields.length));
  const lvBracket = indexedBracket(position.lv / 10, position.lvLow, position.lvHigh, lvCount);
  const drBracket = indexedBracket(position.dr / 100, position.drLow, position.drHigh, tables.darkStrength.length);
  return (
    <section className="min-w-0 border" style={{ borderColor: "var(--colorNeutralStroke2)" }}>
      <div className="flex h-7 items-center border-b px-2 text-xs font-semibold"
           style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground3)" }}>Strength</div>
      <div className="flex min-w-0 flex-col gap-2 p-2">
        <ToneLceMatrixGrid tableId="darkStrength" title="Dark Strength" rows={tables.darkStrength} lvBracket={lvBracket} drBracket={drBracket} controls={props} />
        <ToneLceMatrixGrid tableId="brightStrength" title="Bright Strength" rows={tables.brightStrength} lvBracket={lvBracket} drBracket={drBracket} controls={props} />
      </div>
    </section>
  );
}

function ToneLceValueGrid({ tableId, title, labels, rows, bracket, rowTooltips, showResult = true, fillHeight = false, controls }: {
  tableId: ToneLceTableId;
  title: string;
  labels: string[];
  rows: FieldEntry[][];
  bracket: AxisBracket | null;
  rowTooltips?: Array<string | undefined>;
  showResult?: boolean;
  fillHeight?: boolean;
  controls: ToneTableProps;
}) {
  const count = Math.max(1, ...rows.map((fields) => fields.length));
  const mode = controls.heatmapModes[tableId];
  const hits = useMemo(() => mode.enabled
    ? toneHeatmapHits(tableId, controls.heatmapPoints, controls.tables, rows.length, count) : [],
    [mode.enabled, tableId, controls.heatmapPoints, controls.tables, rows.length, count]);
  const maximum = Math.max(0, ...hits.flat().map((paths) => paths.length));
  const result = showResult ? labels.slice(tableId === "ratio" ? 1 : 0)
    .map((label, index) => `${label}: ${formatInterpolation(interpolateFields(rows[index + (tableId === "ratio" ? 1 : 0)] ?? [], bracket))}`)
    .join(" | ") : "";
  return <div className={`${fillHeight ? "flex-1 " : ""}min-w-0 border`} style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground1)" }}>
    <ToneLceTableHeader tableId={tableId} title={title} result={result} rows={rows} controls={controls} />
    <div className="min-w-0 overflow-x-auto">
      <div style={{ display: "grid", gridTemplateColumns: `128px repeat(${count}, minmax(0, 1fr))`, gridTemplateRows: "40px", gridAutoRows: 26,
        width: "100%", minWidth: 0, border: "2px solid var(--colorNeutralStroke1)", fontFamily: "ui-monospace, Consolas, monospace" }}>
        <ToneCorner top="LV" bottom={tableId === "ratio" ? "Ratio" : tableId === "face" ? "Face" : title} />
        {Array.from({ length: count }, (_, index) => <div key={`h:${index}`} className="flex min-w-0 items-center justify-end border-b border-r px-1 font-mono text-[10px] font-semibold"
          style={{ borderColor: "var(--colorNeutralStroke2)", background: bracketHits(bracket, index) ? "var(--colorBrandBackground2)" : "var(--colorNeutralBackground2)" }}>LV{index}</div>)}
        {labels.map((label, rowIndex) => <div key={label} style={{ display: "contents" }}>
          <div className="flex min-w-0 items-center border-b border-r px-2 text-[10px] font-semibold" title={rowTooltips?.[rowIndex]}
            style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground2)" }}>{label}</div>
          {Array.from({ length: count }, (_, columnIndex) => {
            const paths = hits[rowIndex]?.[columnIndex] ?? [];
            return <ToneNumberCell key={`${rowIndex}:${columnIndex}`} field={rows[rowIndex]?.[columnIndex]} active={bracketHits(bracket, columnIndex)}
              heat={mode.enabled ? heatCellStyle(paths.length, maximum) : undefined} hitCount={controls.heatmapLoading ? undefined : paths.length}
              showCount={mode.enabled && mode.showCounts} tableId={tableId} controls={controls}
              onHitImages={() => controls.onSelectHeatmapImages?.(paths)} />;
          })}
        </div>)}
      </div>
    </div>
  </div>;
}

function ToneLceMatrixGrid({ tableId, title, rows, lvBracket, drBracket, controls }: {
  tableId: ToneLceTableId;
  title: string;
  rows: FieldEntry[][];
  lvBracket: AxisBracket | null;
  drBracket: AxisBracket | null;
  controls: ToneTableProps;
}) {
  const count = Math.max(19, ...rows.map((fields) => fields.length));
  const mode = controls.heatmapModes[tableId];
  const hits = useMemo(() => mode.enabled
    ? toneHeatmapHits(tableId, controls.heatmapPoints, controls.tables, rows.length, count) : [],
    [mode.enabled, tableId, controls.heatmapPoints, controls.tables, rows.length, count]);
  const maximum = Math.max(0, ...hits.flat().map((paths) => paths.length));
  return <div className="min-w-0 border" style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground1)" }}>
    <ToneLceTableHeader tableId={tableId} title={title} result={`插值: ${formatInterpolation(interpolateMatrix(rows, drBracket, lvBracket))}`}
      rows={rows} controls={controls} />
    <div className="min-w-0 overflow-x-auto">
      <div style={{ display: "grid", gridTemplateColumns: `72px repeat(${count}, minmax(0, 1fr))`, gridTemplateRows: "40px", gridAutoRows: 26,
        width: "100%", minWidth: 0, border: "2px solid var(--colorNeutralStroke1)", fontFamily: "ui-monospace, Consolas, monospace" }}>
        <ToneCorner top="LV" bottom="DR" />
        {Array.from({ length: count }, (_, index) => <div key={`h:${index}`} className="flex min-w-0 items-center justify-end border-b border-r px-1 font-mono text-[10px] font-semibold"
          style={{ borderColor: "var(--colorNeutralStroke2)", background: bracketHits(lvBracket, index) ? "var(--colorBrandBackground2)" : "var(--colorNeutralBackground2)" }}>LV{index}</div>)}
        {rows.map((fields, rowIndex) => <div key={rowIndex} style={{ display: "contents" }}>
          <div className="flex min-w-0 items-center border-b border-r px-2 text-[10px] font-semibold"
            style={{ borderColor: "var(--colorNeutralStroke2)", background: bracketHits(drBracket, rowIndex) ? "var(--colorBrandBackground2)" : "var(--colorNeutralBackground2)" }}>{rowIndex}</div>
          {Array.from({ length: count }, (_, columnIndex) => {
            const paths = hits[rowIndex]?.[columnIndex] ?? [];
            return <ToneNumberCell key={`${rowIndex}:${columnIndex}`} field={fields[columnIndex]}
              active={bracketHits(drBracket, rowIndex) && bracketHits(lvBracket, columnIndex)}
              heat={mode.enabled ? heatCellStyle(paths.length, maximum) : undefined} hitCount={controls.heatmapLoading ? undefined : paths.length}
              showCount={mode.enabled && mode.showCounts} tableId={tableId} controls={controls}
              onHitImages={() => controls.onSelectHeatmapImages?.(paths)} />;
          })}
        </div>)}
      </div>
    </div>
  </div>;
}

function ToneGroupRows({ group, onJump }: {
  group: ToneGroup;
  onJump: (field: FieldEntry) => void;
}) {
  const [visibleCount, setVisibleCount] = useState(100);
  return (
    <>
      <div className="max-h-72 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0" style={{ background: "var(--colorNeutralBackground2)" }}>
            <tr><th className="px-3 py-1 text-left font-medium">paths</th><th className="px-3 py-1 text-right font-medium">值</th></tr>
          </thead>
          <tbody>
            {group.fields.slice(0, visibleCount).map((field) => (
              <tr key={`${field.path}:${field.line}:${field.index}`} className="border-t"
                  style={{ borderColor: "var(--colorNeutralStroke2)" }}>
                <td className="max-w-0 truncate px-3 py-1 font-mono" title={`${field.path}${field.comment ? ` | ${field.comment}` : ""}`}>
                  <button type="button" onClick={() => onJump(field)}
                          className="max-w-full truncate text-left" style={{ color: "var(--colorBrandForeground1)" }}>{field.path}</button>
                </td>
                <td className="px-3 py-1 text-right font-mono" title={field.value}>{field.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {group.fields.length > visibleCount && (
        <button type="button" className="w-full border-t py-1 text-xs"
                style={{ borderColor: "var(--colorNeutralStroke2)", color: "var(--colorBrandForeground1)" }}
                onClick={() => setVisibleCount((count) => count + 100)}>
          显示更多 ({Math.min(visibleCount, group.fields.length)}/{group.fields.length})
        </button>
      )}
    </>
  );
}
