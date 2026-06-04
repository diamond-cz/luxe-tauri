import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  pSeries: number[];
  oSeries: number[];
}

const LABELS = ["0", "1", "50", "250", "500", "750", "950", "999"] as const;
const MIN_WIDTH = 520;
const MIN_HEIGHT = 320;

type ThemeMode = "light" | "dark";

type Point = {
  x: number;
  y: number;
  value: number;
  label: string;
};

type Layout = {
  width: number;
  height: number;
  pad: { left: number; right: number; top: number; bottom: number };
  topLabelHeight: number;
  xLabelHeight: number;
  legendX: number;
  legendY: number;
  chart: { x: number; y: number; width: number; height: number };
  topFontSize: number;
  axisFontSize: number;
  legendFontSize: number;
  tooltipFontSize: number;
  pointSize: number;
};

type Palette = {
  surface: string;
  border: string;
  grid: string;
  axis: string;
  text: string;
  subtleText: string;
  topDiff: string;
  pLine: string;
  oLine: string;
  tooltipBg: string;
  tooltipText: string;
};

type Model = {
  pPoints: Point[];
  oPoints: Point[];
  xTicks: { label: string; x: number }[];
  hGrid: number[];
  topDiffs: { label: string; x: number; text: string }[];
  hover: {
    label: string;
    x: number;
    p: Point | undefined;
    o: Point | undefined;
  } | null;
};

export function LceChart({ pSeries, oSeries }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: MIN_WIDTH, height: MIN_HEIGHT });
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const mode: ThemeMode = document.documentElement.classList.contains("light") ? "light" : "dark";
  const palette = getPalette(mode);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = Math.max(MIN_WIDTH, Math.floor(entry.contentRect.width));
      const height = Math.max(MIN_HEIGHT, Math.floor(entry.contentRect.height));
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => buildLayout(size.width, size.height), [size.width, size.height]);
  const model = useMemo(
    () => buildModel(pSeries, oSeries, hoveredLabel, layout),
    [pSeries, oSeries, hoveredLabel, layout],
  );

  return (
    <div ref={rootRef} className="h-full w-full p-2">
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="block h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        shapeRendering="geometricPrecision"
        onMouseLeave={() => setHoveredLabel(null)}
      >
        <rect x="0" y="0" width={layout.width} height={layout.height} rx="14" fill={palette.surface} />

        {model.topDiffs.map((item) => (
          <text
            key={item.label}
            x={item.x}
            y={layout.pad.top + layout.topFontSize}
            textAnchor="middle"
            fontSize={layout.topFontSize}
            fontWeight="700"
            fill={palette.topDiff}
            style={{ fontFamily: FONT_FAMILY }}
          >
            {item.text}
          </text>
        ))}

        <g transform={`translate(${layout.legendX} ${layout.legendY})`}>
          <Legend label="SW_LCE_P" color={palette.pLine} text={palette.text} fontSize={layout.legendFontSize} />
          <g transform={`translate(0 ${layout.legendFontSize + 10})`}>
            <Legend label="SW_LCE_O" color={palette.oLine} text={palette.text} fontSize={layout.legendFontSize} />
          </g>
        </g>

        <rect
          x={layout.chart.x}
          y={layout.chart.y}
          width={layout.chart.width}
          height={layout.chart.height}
          fill="none"
          stroke={palette.border}
          strokeWidth="1.2"
        />

        {model.hGrid.map((line, index) => (
          <line
            key={index}
            x1={layout.chart.x}
            x2={layout.chart.x + layout.chart.width}
            y1={line}
            y2={line}
            stroke={index === model.hGrid.length - 1 ? palette.axis : palette.grid}
            strokeDasharray={index === model.hGrid.length - 1 ? undefined : "2 4"}
            strokeWidth={index === model.hGrid.length - 1 ? 1.1 : 0.8}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {model.xTicks.map((tick) => (
          <line
            key={`tick-${tick.label}`}
            x1={tick.x}
            x2={tick.x}
            y1={layout.chart.y}
            y2={layout.chart.y + layout.chart.height}
            stroke="transparent"
            strokeWidth={Math.max(18, layout.pointSize * 6)}
            onMouseEnter={() => setHoveredLabel(tick.label)}
            onMouseMove={() => setHoveredLabel(tick.label)}
          />
        ))}

        {model.hover && (
          <line
            x1={model.hover.x}
            x2={model.hover.x}
            y1={layout.chart.y}
            y2={layout.chart.y + layout.chart.height}
            stroke={palette.axis}
            strokeDasharray="4 4"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}

        <polyline
          fill="none"
          stroke={palette.pLine}
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          points={polyline(model.pPoints)}
        />
        <polyline
          fill="none"
          stroke={palette.oLine}
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          points={polyline(model.oPoints)}
        />

        {model.pPoints.map((point) => (
          <rect
            key={`p-${point.label}`}
            x={point.x - layout.pointSize / 2}
            y={point.y - layout.pointSize / 2}
            width={layout.pointSize}
            height={layout.pointSize}
            fill={palette.pLine}
          />
        ))}
        {model.oPoints.map((point) => (
          <rect
            key={`o-${point.label}`}
            x={point.x - layout.pointSize / 2}
            y={point.y - layout.pointSize / 2}
            width={layout.pointSize}
            height={layout.pointSize}
            fill={palette.oLine}
          />
        ))}

        {model.xTicks.map((tick) => (
          <text
            key={tick.label}
            x={tick.x}
            y={layout.chart.y + layout.chart.height + layout.axisFontSize + 6}
            textAnchor="middle"
            fontSize={layout.axisFontSize}
            fill={palette.subtleText}
            style={{ fontFamily: FONT_FAMILY }}
          >
            {tick.label}
          </text>
        ))}

        {model.hover?.o && model.hover?.p && (
          <TooltipTag
            x={Math.min(layout.width - 188, Math.max(model.hover.o.x, model.hover.p.x) + 12)}
            y={Math.max(layout.chart.y + 8, Math.min(model.hover.o.y, model.hover.p.y) - (layout.tooltipFontSize * 3 + 18))}
            color={palette.oLine}
            background={palette.tooltipBg}
            textColor={palette.tooltipText}
            fontSize={layout.tooltipFontSize}
            lines={[
              `LCE_O: ${Math.round(model.hover.o.value)}`,
              `LCE_P: ${Math.round(model.hover.p.value)}`,
            ]}
          />
        )}
      </svg>
    </div>
  );
}

function Legend({
  label,
  color,
  text,
  fontSize,
}: {
  label: string;
  color: string;
  text: string;
  fontSize: number;
}) {
  return (
    <g>
      <line x1="0" x2="22" y1="8" y2="8" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <rect x="8.5" y="5.5" width="5" height="5" fill={color} />
      <text
        x="30"
        y={Math.round(fontSize * 0.85)}
        fontSize={fontSize}
        fontWeight="600"
        fill={text}
        style={{ fontFamily: FONT_FAMILY }}
      >
        {label}
      </text>
    </g>
  );
}

function TooltipTag({
  x,
  y,
  color,
  background,
  textColor,
  fontSize,
  lines,
}: {
  x: number;
  y: number;
  color: string;
  background: string;
  textColor: string;
  fontSize: number;
  lines: string[];
}) {
  const width = Math.max(150, ...lines.map((line) => line.length * (fontSize * 0.7)));
  const height = 14 + lines.length * (fontSize + 8);
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx="4"
        fill={background}
        stroke={color}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      {lines.map((line, index) => (
        <text
          key={line}
          x={x + 8}
          y={y + 18 + index * (fontSize + 8)}
          fontSize={fontSize}
          fontWeight="600"
          fill={textColor}
          style={{ fontFamily: FONT_FAMILY }}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

const FONT_FAMILY = `'Segoe UI Variable Text', 'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', sans-serif`;

function buildLayout(width: number, height: number): Layout {
  const safeWidth = Math.max(MIN_WIDTH, width);
  const safeHeight = Math.max(MIN_HEIGHT, height);
  const topFontSize = clamp(Math.round(safeWidth / 52), 14, 18);
  const axisFontSize = clamp(Math.round(safeWidth / 50), 14, 18);
  const legendFontSize = clamp(Math.round(safeWidth / 52), 14, 18);
  const tooltipFontSize = clamp(Math.round(safeWidth / 56), 14, 18);
  const pointSize = clamp(Math.round(safeWidth / 175), 5, 7);
  const pad = {
    left: clamp(Math.round(safeWidth / 42), 18, 26),
    right: clamp(Math.round(safeWidth / 42), 18, 26),
    top: clamp(Math.round(safeHeight / 22), 16, 24),
    bottom: clamp(Math.round(safeHeight / 18), 24, 34),
  };
  const topLabelHeight = topFontSize + 10;
  const xLabelHeight = axisFontSize + 12;
  const chart = {
    x: pad.left,
    y: pad.top + topLabelHeight,
    width: safeWidth - pad.left - pad.right,
    height: safeHeight - pad.top - pad.bottom - topLabelHeight - xLabelHeight,
  };

  return {
    width: safeWidth,
    height: safeHeight,
    pad,
    topLabelHeight,
    xLabelHeight,
    legendX: chart.x + 12,
    legendY: chart.y + 18,
    chart,
    topFontSize,
    axisFontSize,
    legendFontSize,
    tooltipFontSize,
    pointSize,
  };
}

function buildModel(
  pSeries: number[],
  oSeries: number[],
  hoveredLabel: string | null,
  layout: Layout,
): Model {
  const all = [...pSeries, ...oSeries].filter(Number.isFinite);
  const max = all.length ? Math.max(...all) : 1;
  const min = all.length ? Math.min(...all) : 0;
  const range = Math.max(1, max - min);
  const padding = Math.max(24, range * 0.1);
  const domainMin = Math.max(0, min - padding);
  const domainMax = max + padding;

  const xFor = (index: number) => layout.chart.x + (layout.chart.width * index) / (LABELS.length - 1);
  const yFor = (value: number) =>
    layout.chart.y + layout.chart.height - ((value - domainMin) / (domainMax - domainMin || 1)) * layout.chart.height;

  const pPoints: Point[] = LABELS
    .map((label, index) => ({ label, value: pSeries[index], x: xFor(index) }))
    .filter((point) => Number.isFinite(point.value))
    .map((point) => ({ ...point, y: yFor(point.value) }));

  const oPoints: Point[] = LABELS
    .map((label, index) => ({ label, value: oSeries[index], x: xFor(index) }))
    .filter((point) => Number.isFinite(point.value))
    .map((point) => ({ ...point, y: yFor(point.value) }));

  const xTicks = LABELS.map((label, index) => ({ label, x: xFor(index) }));
  const hGrid = Array.from({ length: 5 }, (_, index) => layout.chart.y + (layout.chart.height * index) / 4);
  const topDiffs = LABELS.map((label, index) => {
    const p = pSeries[index];
    const o = oSeries[index];
    const diff = Number.isFinite(p) && Number.isFinite(o) ? Math.round(o - p) : 0;
    return { label, x: xFor(index), text: String(diff) };
  });

  const activeIndex = hoveredLabel ? LABELS.indexOf(hoveredLabel as typeof LABELS[number]) : -1;
  const hover = activeIndex >= 0
    ? {
        label: LABELS[activeIndex],
        x: xFor(activeIndex),
        p: pPoints.find((point) => point.label === LABELS[activeIndex]),
        o: oPoints.find((point) => point.label === LABELS[activeIndex]),
      }
    : null;

  return { pPoints, oPoints, xTicks, hGrid, topDiffs, hover };
}

function polyline(points: Point[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function getPalette(mode: ThemeMode): Palette {
  if (mode === "light") {
    return {
      surface: "#F6F3FA",
      border: "#8A8497",
      grid: "rgba(88, 77, 104, 0.14)",
      axis: "rgba(88, 77, 104, 0.42)",
      text: "#2E2738",
      subtleText: "#5A5068",
      topDiff: "#A67A00",
      pLine: "#2D7BF4",
      oLine: "#F58A2A",
      tooltipBg: "#FFF7EB",
      tooltipText: "#2E2738",
    };
  }
  return {
    surface: "#231F2A",
    border: "#B9B0C7",
    grid: "rgba(185,176,199,0.18)",
    axis: "rgba(255,255,255,0.28)",
    text: "#F2F3F7",
    subtleText: "#B8C9FF",
    topDiff: "#FFD85C",
    pLine: "#56A0FF",
    oLine: "#FF9B41",
    tooltipBg: "#2C2623",
    tooltipText: "#F6F1EA",
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
