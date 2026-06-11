import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Code24Regular } from "@fluentui/react-icons";

import {
  cppGetFieldsAtPath,
  cppGetFieldsInRange,
  cppResolveCardSource,
  type CardSourceSpec,
  type Isp6sSchemaRoot,
} from "@/ipc/cppParser";
import type { FieldEntry } from "@/types/cpp_parser";

type ChartTabId = "MainT" | "HS" | "NS" | "ABL" | "Face" | "Face_FLT";
type StepperDirection = "up" | "down";

interface Props {
  filePath: string;
  schema:   Isp6sSchemaRoot;
  tomlData: Record<string, string>;
  activeCard?: string;
  onSourceJump?: (label: string, spec: CardSourceSpec) => void;
}

interface ChartSection {
  id:    string;
  title: string;
  rows:  ChartRow[];
}

interface ChartRow {
  id:     string;
  line:   number;
  label:  string;
  path:   string;
  values: string[];
}

interface MainTargetThresholdRow {
  label:  "BV" | "Base" | "Exp";
  path:   string;
  values: string[];
}

interface MidCurveSource {
  x1: string[];
  y1: string[];
  x2: string[];
  y2: string[];
}

const CHART_TABS: ChartTabId[] = ["MainT", "HS", "NS", "ABL", "Face", "Face_FLT"];
const MAIN_TARGET_THRESHOLD_PATHS = ["[0][3][1][22]", "[0][3][1][23]", "[0][3][1][24]"] as const;
const MID_CURVE_PATHS = {
  x1: "[0][3][1].65",
  y1: "[0][3][1].66",
  x2: "[0][3][1].67",
  y2: "[0][3][1].68",
} as const;
const MID_CURVE_SOURCE_PATHS = [MID_CURVE_PATHS.x1, MID_CURVE_PATHS.y1, MID_CURVE_PATHS.x2, MID_CURVE_PATHS.y2] as const;
const MAIN_TARGET_THRESHOLD_SOURCE_SPEC: CardSourceSpec = {
  paths: [...MAIN_TARGET_THRESHOLD_PATHS],
  jump_to: "first",
  highlight: "ranges",
};
const MAIN_TARGET_THRESHOLD_ROWS: Array<{ label: MainTargetThresholdRow["label"]; path: string }> = [
  { label: "BV",   path: MAIN_TARGET_THRESHOLD_PATHS[0] },
  { label: "Base", path: MAIN_TARGET_THRESHOLD_PATHS[1] },
  { label: "Exp",  path: MAIN_TARGET_THRESHOLD_PATHS[2] },
];

export function ChartMapMode({ filePath, schema, tomlData, activeCard, onSourceJump }: Props) {
  const [tab, setTab] = useState<ChartTabId>(() => coerceTab(activeCard) ?? "MainT");
  const [sections, setSections] = useState<ChartSection[]>([]);
  const [mainTargetThreshold, setMainTargetThreshold] = useState<MainTargetThresholdRow[] | null>(null);
  const [mainTargetMidCurve, setMainTargetMidCurve] = useState<MidCurveSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const next = coerceTab(activeCard);
    if (next) setTab(next);
  }, [activeCard]);

  const sourceKey = useMemo(() => tab, [tab]);
  const imageBvValue = useMemo(
    () => readTomlValue(tomlData, schema.Image?.BV ?? "AE_TAG_REALBVX1000"),
    [schema.Image, tomlData],
  );
  const imageMidratioValue = useMemo(
    () => readTomlValue(tomlData, "AE_TAG_MTV6_MAINT_MID_INTRATIO"),
    [tomlData],
  );
  const corrDrMidratioValue = useMemo(
    () => readTomlValue(tomlData, "AE_TAG_DRV6_CORR_MIDRATIO"),
    [tomlData],
  );
  const midratioOriValue = useMemo(
    () => readTomlValue(tomlData, "AE_TAG_DRV6_CORR_MIDRATIO_ORI"),
    [tomlData],
  );
  const midratioValue = useMemo(
    () => readTomlValue(tomlData, "AE_TAG_DRV6_MIDRATIO"),
    [tomlData],
  );

  useEffect(() => {
    let cancelled = false;
    const spec = schema.card_source?.[sourceKey];
    if (!filePath) {
      setSections([]);
      setMainTargetThreshold(null);
      setMainTargetMidCurve(null);
      setMessage("请先导入 AE.cpp 参数文件");
      return;
    }
    if (!spec) {
      setSections([]);
      setMainTargetThreshold(null);
      setMainTargetMidCurve(null);
      setMessage(`[card_source.${sourceKey}] 未配置`);
      return;
    }

    setLoading(true);
    setMessage(null);
    (async () => {
      let threshold: MainTargetThresholdRow[] | null = null;
      let midCurve: MidCurveSource | null = null;
      if (tab === "MainT") {
        [threshold, midCurve] = await Promise.all([
          loadMainTargetThreshold(filePath),
          loadMainTargetMidCurve(filePath),
        ]);
      }
      const hit = await cppResolveCardSource(filePath, spec);
      const fields: FieldEntry[] = [];
      for (const [start, end] of hit.ranges) {
        const chunk = await cppGetFieldsInRange(filePath, start, end);
        fields.push(...chunk);
      }
      const excludedPaths = tab === "MainT" ? [...MAIN_TARGET_THRESHOLD_PATHS] : [];
      const nextSections = buildSections(tab, hit.ranges, dedupeFields(fields), excludedPaths);
      if (!cancelled) {
        setSections(nextSections);
        setMainTargetThreshold(threshold);
        setMainTargetMidCurve(midCurve);
        setMessage(nextSections.length === 0 && !threshold ? "当前源码范围内没有可展示字段" : null);
        setLoading(false);
      }
    })().catch((err) => {
      if (!cancelled) {
        setSections([]);
        setMainTargetThreshold(null);
        setMainTargetMidCurve(null);
        setMessage(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, schema, sourceKey, tab]);

  return (
    <div className="flex h-full w-full flex-col" style={canvasStyle}>
      <div className="shrink-0 overflow-x-auto px-3 pt-3" style={tabStripWrapStyle}>
        <div className="flex min-w-max items-end gap-0.5">
          {CHART_TABS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              style={tabButtonStyle(item === tab)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 pt-2">
        <div style={innerCanvasStyle}>
          {loading && (
            <div className="mb-2 text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
              loading...
            </div>
          )}

          {tab === "MainT" && mainTargetThreshold && (
            <MainTargetThresholdCard
              rows={mainTargetThreshold}
              imageBvValue={imageBvValue}
              imageMidratioValue={imageMidratioValue}
              corrDrMidratioValue={corrDrMidratioValue}
              midratioOriValue={midratioOriValue}
              midratioValue={midratioValue}
              midCurve={mainTargetMidCurve}
              sourceSpec={schema.card_source?.Main_Target_Threshold ?? MAIN_TARGET_THRESHOLD_SOURCE_SPEC}
              onSourceJump={onSourceJump}
            />
          )}

          {sections.map((section) => (
            <fieldset key={section.id} style={fieldsetStyle}>
              <legend style={legendStyle}>{section.title}</legend>
              <div className="flex flex-col gap-2">
                {section.rows.map((row) => (
                  <div key={row.id} style={rowStyle}>
                    <div style={labelStyle} title={`${row.path} · L${row.line}`}>
                      {row.label}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                      {row.values.map((value, idx) => (
                        <span
                          key={`${row.id}:${idx}`}
                          title={`${row.path} · L${row.line}`}
                          style={valueBoxStyle}
                        >
                          {value}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
          ))}

          {!loading && message && (
            <div className="rounded-md border px-3 py-2 text-xs"
                 style={{
                   borderColor: "var(--colorNeutralStroke2)",
                   color: "var(--colorNeutralForeground3)",
                   background: "var(--colorNeutralBackground2)",
                 }}>
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

async function loadMainTargetThreshold(filePath: string): Promise<MainTargetThresholdRow[]> {
  const rows: MainTargetThresholdRow[] = [];
  for (const row of MAIN_TARGET_THRESHOLD_ROWS) {
    rows.push({
      label: row.label,
      path: row.path,
      values: await loadFieldValuesAtPath(filePath, row.path, ["-"]),
    });
  }
  return rows;
}

async function loadMainTargetMidCurve(filePath: string): Promise<MidCurveSource> {
  const [x1, y1, x2, y2] = await Promise.all(
    MID_CURVE_SOURCE_PATHS.map((path) => loadFieldValuesAtPath(filePath, path, [])),
  );
  return { x1, y1, x2, y2 };
}

async function loadFieldValuesAtPath(filePath: string, path: string, fallback: string[]): Promise<string[]> {
  let fields: FieldEntry[] = [];
  try {
    fields = await cppGetFieldsAtPath(filePath, path);
  } catch {
    fields = [];
  }
  fields = fields.filter((field) => isPathUnder(field.path, path));
  fields.sort((a, b) => a.index - b.index || a.path.localeCompare(b.path));
  return fields.length > 0 ? fields.map((field) => field.value) : fallback;
}

function coerceTab(value: string | undefined): ChartTabId | null {
  return CHART_TABS.includes(value as ChartTabId) ? (value as ChartTabId) : null;
}

function dedupeFields(fields: FieldEntry[]): FieldEntry[] {
  const seen = new Set<string>();
  const out: FieldEntry[] = [];
  for (const field of fields) {
    const key = `${field.path}|${field.line}|${field.index}|${field.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(field);
  }
  return out.sort((a, b) => a.line - b.line || a.index - b.index || a.path.localeCompare(b.path));
}

function buildSections(
  tab: ChartTabId,
  ranges: Array<[number, number]>,
  fields: FieldEntry[],
  excludePathPrefixes: string[] = [],
): ChartSection[] {
  const visibleFields = fields.filter((field) =>
    !excludePathPrefixes.some((prefix) => isPathUnder(field.path, prefix)),
  );
  if (visibleFields.length === 0) return [];
  const sections: ChartSection[] = [];
  for (const [rangeIdx, [start, end]] of ranges.entries()) {
    const inRange = visibleFields.filter((field) => field.line >= start && field.line <= end);
    if (inRange.length === 0) continue;
    const rows = groupRows(inRange);
    sections.push({
      id: `${tab}:${start}-${end}:${rangeIdx}`,
      title: ranges.length === 1
        ? `${tab} · L${start}-L${end}`
        : `${tab} 源码段 ${rangeIdx + 1} · L${start}-L${end}`,
      rows,
    });
  }
  return sections;
}

function MainTargetThresholdCard({
  rows,
  imageBvValue,
  imageMidratioValue,
  corrDrMidratioValue,
  midratioOriValue,
  midratioValue,
  midCurve,
  sourceSpec,
  onSourceJump,
}: {
  rows: MainTargetThresholdRow[];
  imageBvValue: string | null;
  imageMidratioValue: string | null;
  corrDrMidratioValue: string | null;
  midratioOriValue: string | null;
  midratioValue: string | null;
  midCurve: MidCurveSource | null;
  sourceSpec: CardSourceSpec;
  onSourceJump?: (label: string, spec: CardSourceSpec) => void;
}) {
  const bv = rows.find((row) => row.label === "BV");
  const base = rows.find((row) => row.label === "Base");
  const exp = rows.find((row) => row.label === "Exp");
  const orderedRows = [bv, base, exp].filter((row): row is MainTargetThresholdRow => Boolean(row));
  const defaultBv = firstNumericString(bv?.values);
  const initialBv = imageBvValue ?? defaultBv ?? "";
  const [bvInput, setBvInput] = useState(initialBv);
  const [midReadoutMode, setMidReadoutMode] = useState<"value" | "percent">("value");
  const [midChartResetKey, setMidChartResetKey] = useState(0);

  useEffect(() => {
    setBvInput(initialBv);
  }, [initialBv]);

  const bvNumber = parseFiniteNumber(bvInput);
  const baseValue = interpolateTableValue(bvNumber, bv?.values, base?.values);
  const expValue = interpolateTableValue(bvNumber, bv?.values, exp?.values);
  const interpolationColumns = interpolationColumnIndexes(bvNumber, bv?.values);
  const thdMaxValue = Number.isFinite(baseValue) && Number.isFinite(expValue)
    ? baseValue * 2 ** (expValue / 1000)
    : NaN;
  const midCurvePoints = useMemo(() => buildMidCurvePoints(midCurve), [midCurve]);
  const segmentedMidPoints = useMemo(() => buildSegmentedMidPoints(midCurvePoints), [midCurvePoints]);
  const midValue = parseFiniteNumber(imageMidratioValue);
  const corrDrMidratio = parseFiniteNumber(corrDrMidratioValue);
  const midratioOri = parseFiniteNumber(midratioOriValue);
  const midratio = parseFiniteNumber(midratioValue);
  const midFunctionValue = midValueAtCorr(corrDrMidratio, segmentedMidPoints, midValue);
  const effectiveMidValue = Number.isFinite(midFunctionValue) ? midFunctionValue : midValue;
  const targetValue = computeSegmentedThd(corrDrMidratio, baseValue, expValue, thdMaxValue, segmentedMidPoints, midValue);
  const restoreBvTitle = imageBvValue
    ? `恢复图片 BV 值：${imageBvValue}`
    : defaultBv
      ? `恢复默认 BV 值：${defaultBv}`
      : "无可恢复 BV 值";

  return (
    <section style={thresholdCardStyle}>
      <div style={thresholdHeaderStyle}>
        <div style={thresholdTitleStyle}>Main_Target_Threshold</div>
        <button
          type="button"
          title="Jump to source mapping"
          aria-label="Jump to source mapping"
          disabled={!onSourceJump}
          onClick={() => onSourceJump?.("Main_Target_Threshold", sourceSpec)}
          style={sourceButtonStyle(Boolean(onSourceJump))}
        >
          <Code24Regular className="h-4 w-4" />
        </button>
      </div>
      <div style={thresholdFormulaStyle}>
        <span>Main Target THD = Base(bv) x 2^(exp(bv)/1000 x Mid(corr_dr_midratio)/1024)</span>
        <strong style={thresholdResultStyle}>{formatThresholdNumber(targetValue)}</strong>
      </div>
      <div style={thresholdDualControlStyle}>
        <section style={thresholdGroupStyle}>
          <div style={thresholdGroupTitleStyle}>bv控制</div>
          <div style={bvControlRowStyle}>
            <div style={bvInputWrapStyle}>
              <ThresholdValueControl
                label="bv"
                value={bvInput}
                labelButtonTitle={restoreBvTitle}
                onLabelClick={initialBv ? () => setBvInput(initialBv) : undefined}
                editable
                onChange={setBvInput}
                onWheelStep={(delta) => {
                  setBvInput((current) => formatInputNumber((parseFiniteNumber(current) || 0) + delta));
                }}
                showSteppers
              />
            </div>
            <div style={bvComputedStackStyle}>
              <ThresholdCompactReadout label="base" value={formatThresholdNumber(baseValue)} />
              <ThresholdCompactReadout label="exp" value={formatThresholdNumber(expValue)} />
            </div>
            <div style={bvThdMaxWrapStyle}>
              <ThresholdCompactReadout label="THD_MAX" value={formatThresholdNumber(thdMaxValue)} fillHeight />
            </div>
          </div>
          <div style={thresholdTableWrapStyle}>
            <table style={thresholdTableStyle}>
              <tbody>
                {orderedRows.map((row) => (
                  <tr key={row.label}>
                    <th
                      title={row.path}
                      style={thresholdLabelCellStyle(row.label)}
                    >
                      {row.label}
                    </th>
                    {row.values.map((value, idx) => (
                      <td
                        key={`${row.label}:${idx}`}
                        style={thresholdValueCellStyle(row.label, interpolationColumns.has(idx))}
                      >
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section style={thresholdGroupStyle}>
          <div style={thresholdGroupTitleStyle}>mid控制</div>
          <div style={midControlRowStyle}>
            <div style={midPrimaryWrapStyle}>
              <ThresholdValueControl
                label="Mid"
                value={formatMidReadout(effectiveMidValue, midReadoutMode)}
                labelButtonTitle="恢复折线图读取图片和参数时的状态"
                onLabelClick={() => setMidChartResetKey((current) => current + 1)}
                onValueClick={() => {
                  setMidReadoutMode((current) => current === "value" ? "percent" : "value");
                }}
                valueTitle="百分比基于 1024 计算"
              />
            </div>
            <div style={midComputedStackStyle}>
              <ThresholdCompactReadout label="corr_dr_midratio" value={formatComputedNumber(corrDrMidratio)} />
              <ThresholdCompactReadout label="midratio_ori" value={formatComputedNumber(midratioOri)} />
            </div>
            <div style={midRatioWrapStyle}>
              <ThresholdCompactReadout label="midratio" value={formatComputedNumber(midratio)} fillHeight />
            </div>
          </div>
          <MidRatioChart
            baseValue={baseValue}
            expValue={expValue}
            thdMaxValue={thdMaxValue}
            midValue={effectiveMidValue}
            corrDrMidratio={corrDrMidratio}
            midCurvePoints={midCurvePoints}
            resetKey={midChartResetKey}
          />
        </section>
      </div>
    </section>
  );
}

function ThresholdCompactReadout({ label, value, fillHeight = false }: { label: string; value: string; fillHeight?: boolean }) {
  return (
    <div style={compactReadoutStyle(fillHeight)}>
      <span style={compactReadoutLabelStyle}>{label}</span>
      <span style={compactReadoutValueStyle}>{value}</span>
    </div>
  );
}

function MidRatioChart({
  baseValue,
  expValue,
  thdMaxValue,
  midValue,
  corrDrMidratio,
  midCurvePoints,
  resetKey,
}: {
  baseValue: number;
  expValue: number;
  thdMaxValue: number;
  midValue: number;
  corrDrMidratio: number;
  midCurvePoints: Array<{ x: number; y: number }>;
  resetKey: number;
}) {
  const [draggedStartX, setDraggedStartX] = useState<number | null>(null);
  const [draggedEndX, setDraggedEndX] = useState<number | null>(null);
  const [draggedCurrentPoint, setDraggedCurrentPoint] = useState<{ x: number; y: number } | null>(null);
  const [draggingPoint, setDraggingPoint] = useState<"start" | "end" | "current" | null>(null);

  useEffect(() => {
    setDraggedStartX(null);
    setDraggedEndX(null);
    setDraggedCurrentPoint(null);
  }, [baseValue, expValue, thdMaxValue, corrDrMidratio, resetKey]);

  const valid = Number.isFinite(baseValue) && Number.isFinite(expValue) && Number.isFinite(thdMaxValue);
  const xMin = 0;
  const xMax = 1024;
  const yBase = Number.isFinite(baseValue) ? baseValue : 0;
  const safeThdMax = Number.isFinite(thdMaxValue) ? thdMaxValue : yBase;
  const startX = clamp(draggedStartX ?? 400, xMin, draggedEndX ?? 800);
  const endX = clamp(draggedEndX ?? 800, startX, xMax);
  const segmentMidPoints = useMemo(
    () => buildSegmentedMidPoints(midCurvePoints, startX, endX),
    [midCurvePoints, startX, endX],
  );
  const yAt = (x: number) => {
    return computeSegmentedThd(x, yBase, expValue, safeThdMax, segmentMidPoints, midValue, startX, endX);
  };
  const defaultCurrentX = Number.isFinite(corrDrMidratio) ? clamp(corrDrMidratio, xMin, xMax) : startX;
  const currentPointX = draggedCurrentPoint?.x ?? defaultCurrentX;
  const rawCurrentPointY = yAt(currentPointX);
  const currentPointY = Number.isFinite(rawCurrentPointY) ? rawCurrentPointY : yBase;
  const segmentCollapsed = Math.abs(endX - startX) < 0.5;
  const curvePoints = segmentCollapsed
    ? [
      { x: xMin, y: yBase },
      { x: startX, y: yBase },
      { x: startX, y: safeThdMax },
      { x: xMax, y: safeThdMax },
    ]
    : uniqueSortedNumbers([
      xMin,
      startX,
      ...Array.from({ length: 161 }, (_, idx) => startX + ((endX - startX) * idx) / 160),
      endX,
      currentPointX,
      xMax,
      ...segmentMidPoints.map((point) => point.x),
    ])
      .filter((x) => x >= xMin && x <= xMax)
      .map((x) => ({ x, y: yAt(x) }))
      .filter((point) => Number.isFinite(point.y));
  const yValues = curvePoints.map((point) => point.y).filter(Number.isFinite);
  const yGap = Math.max(Math.abs(safeThdMax - yBase), Math.abs(currentPointY - yBase), 1);
  const yMin = Math.max(0, Math.min(yBase, currentPointY, ...yValues) - yGap * 0.65);
  const yMax = Math.max(safeThdMax, currentPointY, ...yValues, 1) + yGap * 0.42;
  const chart = {
    left: 66,
    top: 20,
    right: 28,
    bottom: 38,
    width: 420,
    height: 190,
  };
  const plotW = chart.width - chart.left - chart.right;
  const plotH = chart.height - chart.top - chart.bottom;
  const xToPx = (x: number) => chart.left + (clamp(x, xMin, xMax) - xMin) / (xMax - xMin) * plotW;
  const yToPx = (y: number) => {
    const span = yMax === yMin ? 1 : yMax - yMin;
    return chart.top + (1 - (y - yMin) / span) * plotH;
  };
  const curvePath = valid ? buildSvgPath(curvePoints, xToPx, yToPx) : "";
  const baseY = yToPx(yBase);
  const maxY = yToPx(safeThdMax);
  const axisY = chart.top + plotH;
  const firstPointX = xToPx(startX);
  const endPointX = xToPx(endX);
  const currentX = xToPx(currentPointX);
  const currentY = yToPx(currentPointY);
  const currentLabelX = clamp(currentX, chart.left + 30, chart.left + plotW - 30);
  const currentLabelY = Math.max(chart.top + 24, currentY - 9);
  const boundaryXs = segmentCollapsed
    ? [{ key: "joint" as const, value: startX, x: firstPointX, y: baseY, label: formatRatioTick(startX) }]
    : [
      { key: "start" as const, value: startX, x: firstPointX, y: baseY, label: formatRatioTick(startX) },
      { key: "end" as const, value: endX, x: endPointX, y: maxY, label: formatRatioTick(endX) },
    ];
  const clientToChartValue = (clientX: number, clientY: number, svg: SVGSVGElement | null) => {
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const svgX = ((clientX - rect.left) / rect.width) * chart.width;
    const svgY = ((clientY - rect.top) / rect.height) * chart.height;
    return {
      x: xMin + ((svgX - chart.left) / plotW) * (xMax - xMin),
      y: yMin + (1 - (svgY - chart.top) / plotH) * (yMax - yMin),
    };
  };
  const updateBoundaryFromClientX = (kind: "start" | "end", clientX: number, svg: SVGSVGElement | null) => {
    const value = clientToChartValue(clientX, 0, svg);
    if (!value) return;
    if (kind === "start") {
      setDraggedStartX(clamp(value.x, xMin, endX));
    } else {
      setDraggedEndX(clamp(value.x, startX, xMax));
    }
  };
  const updateCurrentPointFromClient = (clientX: number, clientY: number, svg: SVGSVGElement | null) => {
    const value = clientToChartValue(clientX, clientY, svg);
    if (!value) return;
    const nextX = clamp(value.x, xMin, xMax);
    setDraggedCurrentPoint({
      x: nextX,
      y: yAt(nextX),
    });
  };
  const releasePointer = (event: PointerEvent<SVGCircleElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingPoint(null);
  };

  return (
    <div style={chartWrapStyle}>
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} style={chartSvgStyle} role="img" aria-label="Main Target THD chart">
        <text x={12} y={17} textAnchor="start" style={chartTitleTextStyle}>Main Target THD</text>
        <line x1={chart.left} y1={axisY} x2={chart.left} y2={chart.top + 16} style={chartAxisLineStyle} />
        <line x1={chart.left} y1={axisY} x2={chart.left + plotW + 10} y2={axisY} style={chartAxisLineStyle} />
        <path d={`M ${chart.left} ${chart.top + 10} L ${chart.left - 4} ${chart.top + 17} L ${chart.left + 4} ${chart.top + 17} Z`} style={chartArrowStyle} />
        <path d={`M ${chart.left + plotW + 15} ${axisY} L ${chart.left + plotW + 7} ${axisY - 4} L ${chart.left + plotW + 7} ${axisY + 4} Z`} style={chartArrowStyle} />
        <line x1={chart.left} y1={maxY} x2={endPointX} y2={maxY} style={chartMaxLineStyle} />
        {boundaryXs.map((item) => (
          <g key={item.value}>
            <line x1={item.x} y1={item.y} x2={item.x} y2={axisY} style={chartBoundaryLineStyle} />
            <text x={item.x} y={axisY + 14} textAnchor="middle" style={chartAxisTextStyle}>{item.label}</text>
          </g>
        ))}
        {curvePath && <path d={curvePath} style={chartCurveStyle} />}
        <line x1={chart.left} y1={currentY} x2={currentX} y2={currentY} style={chartCurrentGuideLineStyle} />
        <line x1={currentX} y1={currentY} x2={currentX} y2={axisY} style={chartCurrentGuideLineStyle} />
        <text x={currentX} y={axisY + 28} textAnchor="middle" style={chartCurrentValueTextStyle}>
          {formatRatioTick(currentPointX)}
        </text>
        <text x={currentLabelX} y={currentLabelY} textAnchor="middle" style={chartCurrentValueTextStyle}>
          {formatThresholdNumber(currentPointY)}
        </text>
        <circle cx={firstPointX} cy={baseY} r={3.8} style={chartDragPointStyle(draggingPoint === "start")} />
        <circle cx={endPointX} cy={maxY} r={3.8} style={chartDragPointStyle(draggingPoint === "end")} />
        <circle cx={currentX} cy={currentY} r={3.4} style={chartCurrentPointStyle} />
        <circle
          cx={firstPointX}
          cy={baseY}
          r={12}
          style={chartHorizontalDragHitStyle}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDraggingPoint("start");
            updateBoundaryFromClientX("start", event.clientX, event.currentTarget.ownerSVGElement);
          }}
          onPointerMove={(event) => {
            if (draggingPoint !== "start") return;
            updateBoundaryFromClientX("start", event.clientX, event.currentTarget.ownerSVGElement);
          }}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
        />
        <circle
          cx={endPointX}
          cy={maxY}
          r={12}
          style={chartHorizontalDragHitStyle}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDraggingPoint("end");
            updateBoundaryFromClientX("end", event.clientX, event.currentTarget.ownerSVGElement);
          }}
          onPointerMove={(event) => {
            if (draggingPoint !== "end") return;
            updateBoundaryFromClientX("end", event.clientX, event.currentTarget.ownerSVGElement);
          }}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
        />
        <circle
          cx={currentX}
          cy={currentY}
          r={13}
          style={chartFreeDragHitStyle}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setDraggingPoint("current");
            updateCurrentPointFromClient(event.clientX, event.clientY, event.currentTarget.ownerSVGElement);
          }}
          onPointerMove={(event) => {
            if (draggingPoint !== "current") return;
            updateCurrentPointFromClient(event.clientX, event.clientY, event.currentTarget.ownerSVGElement);
          }}
          onPointerUp={releasePointer}
          onPointerCancel={releasePointer}
        />
        <text x={chart.left - 10} y={maxY + 4} textAnchor="end" style={chartValueTextStyle}>{formatThresholdNumber(safeThdMax)}</text>
        <text x={chart.left - 10} y={baseY + 4} textAnchor="end" style={chartValueTextStyle}>{formatThresholdNumber(yBase)}</text>
        <text x={chart.left + plotW + 7} y={axisY - 7} textAnchor="end" style={chartAxisTextStyle}>corr_dr_midratio</text>
      </svg>
    </div>
  );
}

function ThresholdValueControl({
  label,
  value,
  valueTitle,
  labelButtonTitle,
  editable = false,
  onChange,
  onWheelStep,
  onLabelClick,
  onValueClick,
  showSteppers = false,
}: {
  label: string;
  value: string;
  valueTitle?: string;
  labelButtonTitle?: string;
  editable?: boolean;
  onChange?: (value: string) => void;
  onWheelStep?: (delta: number) => void;
  onLabelClick?: () => void;
  onValueClick?: () => void;
  showSteppers?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [pressedStep, setPressedStep] = useState<StepperDirection | null>(null);
  const [labelPressed, setLabelPressed] = useState(false);
  const [valuePressed, setValuePressed] = useState(false);
  const valueAreaRef = useRef<HTMLSpanElement>(null);
  const onWheelStepRef = useRef(onWheelStep);
  const stepPressTimerRef = useRef<number | null>(null);
  const labelPressTimerRef = useRef<number | null>(null);
  const valuePressTimerRef = useRef<number | null>(null);

  const pulseStep = (direction: StepperDirection) => {
    setPressedStep(direction);
    if (stepPressTimerRef.current !== null) {
      window.clearTimeout(stepPressTimerRef.current);
    }
    stepPressTimerRef.current = window.setTimeout(() => {
      setPressedStep(null);
      stepPressTimerRef.current = null;
    }, 130);
  };
  const pulseLabel = () => {
    setLabelPressed(true);
    if (labelPressTimerRef.current !== null) {
      window.clearTimeout(labelPressTimerRef.current);
    }
    labelPressTimerRef.current = window.setTimeout(() => {
      setLabelPressed(false);
      labelPressTimerRef.current = null;
    }, 160);
  };
  const pulseValue = () => {
    setValuePressed(true);
    if (valuePressTimerRef.current !== null) {
      window.clearTimeout(valuePressTimerRef.current);
    }
    valuePressTimerRef.current = window.setTimeout(() => {
      setValuePressed(false);
      valuePressTimerRef.current = null;
    }, 140);
  };

  useEffect(() => {
    onWheelStepRef.current = onWheelStep;
  }, [onWheelStep]);

  useEffect(() => {
    return () => {
      if (stepPressTimerRef.current !== null) {
        window.clearTimeout(stepPressTimerRef.current);
      }
      if (labelPressTimerRef.current !== null) {
        window.clearTimeout(labelPressTimerRef.current);
      }
      if (valuePressTimerRef.current !== null) {
        window.clearTimeout(valuePressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const valueArea = valueAreaRef.current;
    if (!editable || !valueArea) return;

    const handleWheel = (event: globalThis.WheelEvent) => {
      const stepHandler = onWheelStepRef.current;
      if (!stepHandler) return;
      event.preventDefault();
      event.stopPropagation();
      const direction: StepperDirection = event.deltaY < 0 ? "up" : "down";
      pulseStep(direction);
      stepHandler(direction === "up" ? 1 : -1);
    };

    valueArea.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => {
      valueArea.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, [editable]);

  const step = (delta: number) => {
    if (!editable || !onWheelStep) return;
    pulseStep(delta > 0 ? "up" : "down");
    onWheelStep(delta);
  };

  return (
    <div style={thresholdControlStyle}>
      {onLabelClick ? (
        <button
          type="button"
          title={labelButtonTitle}
          aria-label={labelButtonTitle ?? label}
          onClick={() => {
            pulseLabel();
            onLabelClick();
          }}
          style={thresholdControlLabelButtonStyle(labelPressed)}
        >
          {label}
        </button>
      ) : (
        <span style={thresholdControlLabelStyle}>{label}</span>
      )}
      <span
        ref={valueAreaRef}
        style={thresholdValueAreaStyle(editable, focused, valuePressed, Boolean(onValueClick))}
        title={valueTitle}
        onClick={onValueClick ? () => {
          pulseValue();
          onValueClick();
        } : undefined}
      >
        <input
          aria-label={label}
          title={valueTitle}
          value={value}
          readOnly={!editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => onChange?.(event.target.value)}
          inputMode="decimal"
          style={thresholdInputStyle}
        />
        {showSteppers && (
          <span style={stepperWrapStyle}>
            <button
              type="button"
              aria-label="increase bv"
              onMouseDown={(event) => {
                event.preventDefault();
                pulseStep("up");
              }}
              onClick={() => step(1)}
              style={stepperButtonStyle("up", pressedStep === "up")}
            >
              <span style={stepperTriangleStyle("up")} />
            </button>
            <button
              type="button"
              aria-label="decrease bv"
              onMouseDown={(event) => {
                event.preventDefault();
                pulseStep("down");
              }}
              onClick={() => step(-1)}
              style={stepperButtonStyle("down", pressedStep === "down")}
            >
              <span style={stepperTriangleStyle("down")} />
            </button>
          </span>
        )}
      </span>
    </div>
  );
}

function groupRows(fields: FieldEntry[]): ChartRow[] {
  const byLine = new Map<number, FieldEntry[]>();
  for (const field of fields) {
    const current = byLine.get(field.line) ?? [];
    current.push(field);
    byLine.set(field.line, current);
  }

  return Array.from(byLine.entries()).map(([line, rowFields]) => {
    rowFields.sort((a, b) => a.index - b.index || a.path.localeCompare(b.path));
    const first = rowFields[0];
    return {
      id: `${line}:${first.path}`,
      line,
      label: cleanLabel(first.comment) || pathTail(first.path) || `L${line}`,
      path: first.path,
      values: rowFields.map((field) => field.value),
    };
  });
}

function cleanLabel(comment: string): string {
  return comment
    .replace(/^[/\s*]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pathTail(path: string): string {
  const match = path.match(/(?:\[|\.)\d+\]?$/);
  return match?.[0] ?? path;
}

function isPathUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`) || path.startsWith(`${prefix}[`);
}

function readTomlValue(tomlData: Record<string, string>, key: string | undefined): string | null {
  if (!key) return null;
  const value = tomlData[key];
  if (value === undefined || value === null || value === "") return null;
  return Number.isFinite(parseFiniteNumber(value)) ? String(value).trim() : null;
}

function firstNumericString(values: string[] | undefined): string | null {
  const found = values?.find((value) => Number.isFinite(parseFiniteNumber(value)));
  return found === undefined ? null : found.trim();
}

function parseFiniteNumber(value: string | undefined | null): number {
  if (value === undefined || value === null) return NaN;
  const parsed = Number.parseFloat(String(value).trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}

function interpolateTableValue(
  x: number,
  xValues: string[] | undefined,
  yValues: string[] | undefined,
): number {
  if (!Number.isFinite(x) || !xValues || !yValues) return NaN;
  const count = Math.min(xValues.length, yValues.length);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const px = parseFiniteNumber(xValues[i]);
    const py = parseFiniteNumber(yValues[i]);
    if (Number.isFinite(px) && Number.isFinite(py)) {
      points.push({ x: px, y: py });
    }
  }
  if (points.length === 0) return NaN;
  points.sort((a, b) => a.x - b.x);
  if (points.length === 1 || x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1];
    const right = points[i];
    if (x <= right.x) {
      if (right.x === left.x) return left.y;
      const ratio = (x - left.x) / (right.x - left.x);
      return left.y + (right.y - left.y) * ratio;
    }
  }
  return last.y;
}

function buildMidCurvePoints(source: MidCurveSource | null): Array<{ x: number; y: number }> {
  if (!source) return [];
  const points: Array<{ x: number; y: number }> = [];
  appendCurvePairs(points, source.x1, source.y1);
  appendCurvePairs(points, source.x2, source.y2);
  const byX = new Map<number, number>();
  for (const point of points) {
    byX.set(point.x, point.y);
  }
  return Array.from(byX.entries())
    .map(([x, y]) => ({ x, y }))
    .sort((a, b) => a.x - b.x);
}

function buildSegmentedMidPoints(
  sourcePoints: Array<{ x: number; y: number }>,
  startX = 400,
  endX = 800,
): Array<{ x: number; y: number }> {
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  const span = right - left;
  const byX = new Map<number, number>();
  for (const point of sourcePoints) {
    if (point.x < 400 || point.x > 800) continue;
    const ratio = (point.x - 400) / 400;
    const mappedX = span === 0 ? left : left + ratio * span;
    byX.set(mappedX, clamp(point.y, 0, 1024));
  }
  // The final THD curve must connect Base at the left boundary and THD_MAX at the right boundary.
  byX.set(left, 0);
  byX.set(right, 1024);
  return Array.from(byX.entries())
    .map(([x, y]) => ({ x, y }))
    .sort((a, b) => a.x - b.x);
}

function appendCurvePairs(target: Array<{ x: number; y: number }>, xValues: string[], yValues: string[]) {
  const count = Math.min(xValues.length, yValues.length);
  for (let i = 0; i < count; i += 1) {
    const x = parseFiniteNumber(xValues[i]);
    const y = parseFiniteNumber(yValues[i]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      target.push({ x, y });
    }
  }
}

function midValueAtCorr(x: number, points: Array<{ x: number; y: number }>, fallback: number): number {
  const fromSource = interpolatePointValue(x, points);
  if (Number.isFinite(fromSource)) return clamp(fromSource, 0, 1024);
  return Number.isFinite(fallback) ? clamp(fallback, 0, 1024) : NaN;
}

function computeSegmentedThd(
  corrDrMidratio: number,
  baseValue: number,
  expValue: number,
  thdMaxValue: number,
  midPoints: Array<{ x: number; y: number }>,
  fallbackMid: number,
  startX = 400,
  endX = 800,
): number {
  if (!Number.isFinite(corrDrMidratio) || !Number.isFinite(baseValue) || !Number.isFinite(expValue)) return NaN;
  const left = Math.min(startX, endX);
  const right = Math.max(startX, endX);
  if (corrDrMidratio < left) return baseValue;
  if (corrDrMidratio > right) return Number.isFinite(thdMaxValue) ? thdMaxValue : NaN;
  const mid = midValueAtCorr(corrDrMidratio, midPoints, fallbackMid);
  return Number.isFinite(mid)
    ? baseValue * 2 ** ((expValue / 1000) * (mid / 1024))
    : NaN;
}

function interpolatePointValue(x: number, points: Array<{ x: number; y: number }>): number {
  if (!Number.isFinite(x) || points.length === 0) return NaN;
  if (points.length === 1 || x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1];
    const right = points[i];
    if (x <= right.x) {
      if (right.x === left.x) return left.y;
      const ratio = (x - left.x) / (right.x - left.x);
      return left.y + (right.y - left.y) * ratio;
    }
  }
  return last.y;
}

function interpolationColumnIndexes(x: number, xValues: string[] | undefined): Set<number> {
  const result = new Set<number>();
  if (!Number.isFinite(x) || !xValues) return result;
  const points = xValues
    .map((raw, index) => ({ x: parseFiniteNumber(raw), index }))
    .filter((point) => Number.isFinite(point.x))
    .sort((a, b) => a.x - b.x);
  if (points.length === 0) return result;
  const exact = points.find((point) => point.x === x);
  if (exact) {
    result.add(exact.index);
    return result;
  }
  if (points.length === 1 || x <= points[0].x) {
    result.add(points[0].index);
    return result;
  }
  const last = points[points.length - 1];
  if (x >= last.x) {
    result.add(last.index);
    return result;
  }
  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1];
    const right = points[i];
    if (x < right.x) {
      result.add(left.index);
      result.add(right.index);
      return result;
    }
  }
  result.add(last.index);
  return result;
}

function formatComputedNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function formatThresholdNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "-";
}

function formatInputNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uniqueSortedNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter(Number.isFinite))).sort((a, b) => a - b);
}

function buildSvgPath(
  points: Array<{ x: number; y: number }>,
  xToPx: (x: number) => number,
  yToPx: (y: number) => number,
): string {
  const commands: string[] = [];
  for (const point of points) {
    const px = xToPx(point.x);
    const py = yToPx(point.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    commands.push(`${commands.length === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`);
  }
  return commands.join(" ");
}

function formatRatioTick(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const pct = Math.round((value / 1024) * 100);
  return `${formatComputedNumber(value)}(${pct}%)`;
}

function formatMidReadout(value: number, mode: "value" | "percent"): string {
  if (!Number.isFinite(value)) return "-";
  if (mode === "percent") return `${Math.round((value / 1024) * 100)}%`;
  return formatComputedNumber(value);
}

const canvasStyle: CSSProperties = {
  background: "var(--colorNeutralBackground1)",
  color: "var(--colorNeutralForeground1)",
};

const tabStripWrapStyle: CSSProperties = {
  borderBottom: "1px solid var(--colorNeutralStroke2)",
};

const innerCanvasStyle: CSSProperties = {
  minWidth: 0,
  background: "transparent",
  border: "none",
  borderRadius: 0,
  padding: 0,
};

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    minWidth: 88,
    height: 30,
    padding: "0 14px",
    border: "1px solid var(--colorNeutralStroke2)",
    borderBottomColor: active ? "var(--colorNeutralBackground2)" : "var(--colorNeutralStroke2)",
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    background: active ? "var(--colorNeutralBackground2)" : "var(--colorNeutralBackground3)",
    color: active ? "var(--colorNeutralForeground1)" : "var(--colorNeutralForeground2)",
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
    transform: active ? "translateY(1px)" : "none",
  };
}

const thresholdCardStyle: CSSProperties = {
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 12,
  margin: "0 0 12px",
  padding: 0,
  background: "var(--colorNeutralBackground1)",
  overflow: "hidden",
  boxShadow: "0 10px 26px rgba(0, 0, 0, 0.10)",
};

const thresholdHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  minHeight: 42,
  padding: "0 12px",
  background: "var(--colorNeutralBackground2)",
  borderBottom: "1px solid var(--colorNeutralStroke2)",
};

const thresholdTitleStyle: CSSProperties = {
  flex: "0 0 auto",
  color: "var(--colorNeutralForeground1)",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: "18px",
};

const thresholdFormulaStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: 12,
  padding: "9px 12px",
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground1)",
  color: "var(--colorNeutralForeground2)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 12,
};

const thresholdDualControlStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 12,
  minWidth: 0,
  padding: 12,
};

const thresholdGroupStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 10,
  background: "var(--colorNeutralBackground2)",
  overflow: "hidden",
};

const thresholdGroupTitleStyle: CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  color: "var(--colorNeutralForeground2)",
  fontSize: 12,
  fontWeight: 700,
};

const bvControlRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(112px, 0.72fr) minmax(0, 0.82fr) minmax(0, 0.98fr)",
  alignItems: "stretch",
  gap: 8,
  minWidth: 0,
  overflow: "hidden",
  padding: 10,
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground1)",
};

const bvInputWrapStyle: CSSProperties = {
  justifySelf: "start",
  width: "min(100%, 148px)",
  minWidth: 0,
  height: 44,
};

const bvComputedStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  height: 44,
  minWidth: 0,
};

const bvThdMaxWrapStyle: CSSProperties = {
  height: 44,
  minWidth: 0,
};

function compactReadoutStyle(fillHeight: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flex: 1,
    height: fillHeight ? "100%" : undefined,
    minHeight: 0,
    minWidth: 0,
    padding: "0 8px",
    border: "1px solid var(--colorNeutralStroke2)",
    borderRadius: 6,
    background: "var(--colorNeutralBackground1)",
    fontFamily: "ui-monospace, Consolas, monospace",
    overflow: "hidden",
  };
}

const compactReadoutLabelStyle: CSSProperties = {
  minWidth: 0,
  color: "var(--colorNeutralForeground3)",
  fontSize: 10,
  fontWeight: 700,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const compactReadoutValueStyle: CSSProperties = {
  flex: "0 1 auto",
  minWidth: 0,
  color: "var(--colorNeutralForeground1)",
  fontSize: 11,
  fontWeight: 800,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const midControlRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1.35fr) minmax(0, 0.9fr)",
  alignItems: "stretch",
  gap: 8,
  minWidth: 0,
  overflow: "hidden",
  padding: 10,
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground1)",
};

const midPrimaryWrapStyle: CSSProperties = {
  minWidth: 0,
  height: 44,
};

const midComputedStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  height: 44,
  minWidth: 0,
};

const midRatioWrapStyle: CSSProperties = {
  height: 44,
  minWidth: 0,
};

const thresholdControlStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "max-content minmax(0, 1fr)",
  alignItems: "center",
  minWidth: 0,
  height: "100%",
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 9,
  background: "var(--colorNeutralBackground2)",
  overflow: "hidden",
};

const thresholdControlLabelStyle: CSSProperties = {
  minWidth: 0,
  padding: "0 7px",
  color: "var(--colorNeutralForeground3)",
  fontSize: 11,
  fontWeight: 700,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function thresholdControlLabelButtonStyle(pressed: boolean): CSSProperties {
  return {
    ...thresholdControlLabelStyle,
    height: "100%",
    border: "none",
    borderRight: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 70%, transparent)",
    background: pressed
      ? "color-mix(in srgb, var(--colorBrandBackground2) 78%, var(--colorNeutralBackground2))"
      : "var(--colorNeutralBackground2)",
    color: pressed ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground3)",
    cursor: "pointer",
    fontFamily: "inherit",
    transform: pressed ? "scale(0.94)" : "scale(1)",
    transition: "transform 100ms ease-out, background-color 120ms ease-out, color 120ms ease-out",
    willChange: pressed ? "transform" : "auto",
  };
}

function thresholdValueAreaStyle(editable: boolean, focused: boolean, pressed = false, clickable = false): CSSProperties {
  return {
    display: "flex",
    alignItems: "stretch",
    height: 44,
    minWidth: 0,
    background: pressed
      ? "color-mix(in srgb, var(--colorBrandBackground2) 68%, var(--colorNeutralBackground1))"
      : "var(--colorNeutralBackground1)",
    color: editable ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground1)",
    borderLeft: "1px solid var(--colorNeutralStroke2)",
    boxShadow: editable && focused ? "inset 0 -2px 0 var(--colorBrandForeground1)" : "none",
    cursor: clickable ? "pointer" : undefined,
    transform: pressed ? "scale(0.985)" : "scale(1)",
    transition: "box-shadow 120ms ease, background-color 120ms ease, transform 100ms ease-out",
    willChange: pressed ? "transform" : "auto",
  };
}

const thresholdInputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: "100%",
  border: "none",
  outline: "none",
  padding: "0 6px 0 8px",
  background: "transparent",
  color: "inherit",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 13,
  fontWeight: 800,
};

const stepperWrapStyle: CSSProperties = {
  flex: "0 0 16px",
  display: "flex",
  flexDirection: "column",
  borderLeft: "1px solid var(--colorNeutralStroke2)",
  background: "var(--colorNeutralBackground2)",
};

function stepperButtonStyle(direction: StepperDirection, pressed: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    height: 22,
    minWidth: 16,
    padding: 0,
    border: "none",
    borderBottom: direction === "up" ? "1px solid var(--colorNeutralStroke2)" : "none",
    background: pressed
      ? "color-mix(in srgb, var(--colorBrandBackground2) 74%, var(--colorNeutralBackground2))"
      : "transparent",
    color: pressed ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground3)",
    cursor: "pointer",
    transform: pressed
      ? `translateY(${direction === "up" ? "-1px" : "1px"}) scale(0.94)`
      : "translateY(0) scale(1)",
    transition: "transform 90ms ease-out, background-color 90ms ease-out, color 90ms ease-out",
    willChange: pressed ? "transform" : "auto",
  };
}

function stepperTriangleStyle(direction: "up" | "down"): CSSProperties {
  return {
    width: 0,
    height: 0,
    borderLeft: "3.5px solid transparent",
    borderRight: "3.5px solid transparent",
    borderTop: direction === "down" ? "4.5px solid currentColor" : undefined,
    borderBottom: direction === "up" ? "4.5px solid currentColor" : undefined,
  };
}

const thresholdResultStyle: CSSProperties = {
  flex: "0 0 auto",
  color: "var(--colorBrandForeground1)",
  fontSize: 13,
  fontWeight: 800,
};

function sourceButtonStyle(enabled: boolean): CSSProperties {
  return {
    flex: "0 0 auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    border: "1px solid var(--colorNeutralStroke2)",
    borderRadius: 8,
    background: enabled ? "var(--colorNeutralBackground3)" : "var(--colorNeutralBackground2)",
    color: enabled ? "var(--colorBrandForeground1)" : "var(--colorNeutralForegroundDisabled)",
    cursor: enabled ? "pointer" : "default",
  };
}

const thresholdTableWrapStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "auto",
  padding: "14px 12px",
  background: "var(--colorNeutralBackground2)",
};

const thresholdTableStyle: CSSProperties = {
  width: "min(100%, 560px)",
  minWidth: 0,
  margin: 0,
  borderCollapse: "separate",
  borderSpacing: 0,
  tableLayout: "fixed",
  overflow: "hidden",
  border: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 78%, transparent)",
  borderRadius: 10,
  background: "var(--colorNeutralBackground1)",
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 11,
  textAlign: "center",
};

const chartWrapStyle: CSSProperties = {
  padding: "10px 10px 2px",
  borderBottom: "1px solid var(--colorNeutralStroke2)",
};

const chartSvgStyle: CSSProperties = {
  display: "block",
  width: "100%",
  maxWidth: 520,
  minHeight: 190,
  margin: "0 auto",
  background: "var(--colorNeutralBackground1)",
  borderRadius: 8,
};

const chartTitleTextStyle: CSSProperties = {
  fill: "var(--colorNeutralForeground1)",
  fontSize: 12,
  fontWeight: 700,
};

const chartAxisTextStyle: CSSProperties = {
  fill: "var(--colorNeutralForeground2)",
  fontSize: 11,
};

const chartValueTextStyle: CSSProperties = {
  fill: "var(--colorNeutralForeground1)",
  fontSize: 12,
  fontWeight: 600,
};

const chartCurrentValueTextStyle: CSSProperties = {
  fill: "var(--colorBrandForeground1)",
  fontSize: 12,
  fontWeight: 800,
};

const chartAxisLineStyle: CSSProperties = {
  stroke: "var(--colorPaletteMarigoldForeground2)",
  strokeWidth: 2,
};

const chartArrowStyle: CSSProperties = {
  fill: "var(--colorPaletteMarigoldForeground2)",
};

const chartMaxLineStyle: CSSProperties = {
  stroke: "var(--colorPaletteMarigoldForeground2)",
  strokeWidth: 1,
  strokeDasharray: "2 2",
  strokeOpacity: 0.76,
};

const chartBoundaryLineStyle: CSSProperties = {
  stroke: "var(--colorPaletteMarigoldForeground2)",
  strokeWidth: 1,
  strokeDasharray: "2 2",
  strokeOpacity: 0.72,
};

const chartCurrentGuideLineStyle: CSSProperties = {
  stroke: "var(--colorBrandForeground1)",
  strokeWidth: 1,
  strokeDasharray: "3 3",
  strokeOpacity: 0.68,
};

const chartCurveStyle: CSSProperties = {
  fill: "none",
  stroke: "var(--colorPaletteMarigoldForeground2)",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

const chartCurrentPointStyle: CSSProperties = {
  fill: "var(--colorBrandForeground1)",
  stroke: "var(--colorNeutralBackground1)",
  strokeWidth: 1.4,
};

function chartDragPointStyle(active: boolean): CSSProperties {
  return {
    fill: active ? "var(--colorBrandForeground1)" : "var(--colorPaletteMarigoldForeground2)",
    stroke: "var(--colorNeutralBackground1)",
    strokeWidth: 1.5,
    transition: "fill 100ms ease-out, r 100ms ease-out",
  };
}

const chartHorizontalDragHitStyle: CSSProperties = {
  fill: "transparent",
  cursor: "ew-resize",
  touchAction: "none",
};

const chartFreeDragHitStyle: CSSProperties = {
  fill: "transparent",
  cursor: "grab",
  touchAction: "none",
};

function thresholdLabelCellStyle(label: MainTargetThresholdRow["label"]): CSSProperties {
  const header = label === "BV";
  return {
    width: 54,
    padding: "6px 7px",
    borderRight: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 72%, transparent)",
    borderBottom: label === "Exp"
      ? "none"
      : "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 72%, transparent)",
    background: header
      ? "color-mix(in srgb, var(--normal-sheet-palegreen-bg) 68%, var(--colorNeutralBackground1))"
      : "color-mix(in srgb, var(--colorNeutralForeground1) 9%, var(--colorNeutralBackground2))",
    color: header ? "var(--normal-sheet-palegreen-fg)" : "var(--colorNeutralForeground2)",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.02em",
    textTransform: "uppercase",
  };
}

function thresholdValueCellStyle(label: MainTargetThresholdRow["label"], highlighted = false): CSSProperties {
  const header = label === "BV";
  const baseBackground = header
    ? "color-mix(in srgb, var(--normal-sheet-palegreen-bg) 58%, var(--colorNeutralBackground1))"
    : "color-mix(in srgb, var(--colorNeutralForeground1) 8%, var(--colorNeutralBackground1))";
  return {
    position: "relative",
    minWidth: 0,
    padding: "6px 7px",
    borderRight: "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 58%, transparent)",
    borderBottom: label === "Exp"
      ? "none"
      : "1px solid color-mix(in srgb, var(--colorNeutralStroke2) 58%, transparent)",
    outline: highlighted ? "1.5px solid var(--colorBrandStroke1)" : "none",
    outlineOffset: -3,
    background: highlighted
      ? `linear-gradient(0deg, color-mix(in srgb, var(--colorBrandBackground2) 54%, transparent), color-mix(in srgb, var(--colorBrandBackground2) 54%, transparent)), ${baseBackground}`
      : baseBackground,
    color: header ? "var(--normal-sheet-palegreen-fg)" : "var(--colorNeutralForeground1)",
    fontSize: 11,
    fontWeight: highlighted ? 800 : header ? 700 : 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    transition: "background-color 120ms ease, outline-color 120ms ease",
  };
}

const fieldsetStyle: CSSProperties = {
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 4,
  margin: "0 0 12px",
  padding: "14px 12px 12px",
  background: "var(--colorNeutralBackground1)",
};

const legendStyle: CSSProperties = {
  padding: "0 8px",
  color: "var(--colorNeutralForeground2)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 12,
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  minHeight: 34,
};

const labelStyle: CSSProperties = {
  width: 180,
  flex: "0 0 180px",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "var(--colorNeutralForeground1)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 12,
};

const valueBoxStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minWidth: 50,
  height: 28,
  padding: "0 8px",
  border: "1px solid var(--colorNeutralStroke2)",
  borderRadius: 2,
  background: "var(--colorNeutralBackground3)",
  color: "var(--colorNeutralForeground1)",
  fontFamily: "ui-monospace, Consolas, monospace",
  fontSize: 12,
  lineHeight: "28px",
};
