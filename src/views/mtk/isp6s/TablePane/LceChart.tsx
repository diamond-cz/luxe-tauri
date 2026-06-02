import { useMemo, useState } from "react";

interface Props {
  pSeries: number[];
  oSeries: number[];
}

const LABELS = ["0", "1", "50", "250", "500", "750", "950", "999"] as const;
const VIEWBOX = { width: 920, height: 500 };
const PAD = { left: 22, right: 22, top: 18, bottom: 26 };
const TOP_LABEL_H = 24;
const LEGEND_H = 0;
const X_LABEL_H = 26;
const CHART = {
  x: PAD.left,
  y: PAD.top + TOP_LABEL_H + LEGEND_H,
  width: VIEWBOX.width - PAD.left - PAD.right,
  height: VIEWBOX.height - PAD.top - PAD.bottom - TOP_LABEL_H - LEGEND_H - X_LABEL_H,
};

type ThemeMode = "light" | "dark";

type Point = {
  x: number;
  y: number;
  value: number;
  label: string;
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

export function LceChart({ pSeries, oSeries }: Props) {
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const mode: ThemeMode = document.documentElement.classList.contains("light") ? "light" : "dark";
  const palette = getPalette(mode);
  const model = useMemo(
    () => buildModel(pSeries, oSeries, hoveredLabel),
    [pSeries, oSeries, hoveredLabel],
  );

  return (
    <div className="h-full w-full p-2">
      <svg
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        className="block h-full w-full"
        preserveAspectRatio="none"
        shapeRendering="geometricPrecision"
        onMouseLeave={() => setHoveredLabel(null)}
      >
        <rect x="0" y="0" width={VIEWBOX.width} height={VIEWBOX.height} rx="14" fill={palette.surface} />

        {model.topDiffs.map((item) => (
          <text
            key={item.label}
            x={item.x}
            y={PAD.top + 10}
            textAnchor="middle"
            fontSize="18"
            fontWeight="700"
            fill={palette.topDiff}
            style={{ fontFamily: FONT_FAMILY }}
          >
            {item.text}
          </text>
        ))}

        <g transform={`translate(${CHART.x + 12} ${CHART.y + 20})`}>
          <Legend label="SW_LCE_P" color={palette.pLine} text={palette.text} />
          <g transform="translate(0 18)">
            <Legend label="SW_LCE_O" color={palette.oLine} text={palette.text} />
          </g>
        </g>

        <rect
          x={CHART.x}
          y={CHART.y}
          width={CHART.width}
          height={CHART.height}
          fill="none"
          stroke={palette.border}
          strokeWidth="1.2"
        />

        {model.hGrid.map((line, index) => (
          <line
            key={index}
            x1={CHART.x}
            x2={CHART.x + CHART.width}
            y1={line}
            y2={line}
            stroke={index === model.hGrid.length - 1 ? palette.axis : palette.grid}
            strokeDasharray={index === model.hGrid.length - 1 ? undefined : "2 4"}
            strokeWidth={index === model.hGrid.length - 1 ? 1.1 : 0.8}
          />
        ))}

        {model.xTicks.map((tick) => (
          <line
            key={`tick-${tick.label}`}
            x1={tick.x}
            x2={tick.x}
            y1={CHART.y}
            y2={CHART.y + CHART.height}
            stroke="transparent"
            strokeWidth="28"
            onMouseEnter={() => setHoveredLabel(tick.label)}
            onMouseMove={() => setHoveredLabel(tick.label)}
          />
        ))}

        {model.hover && (
          <line
            x1={model.hover.x}
            x2={model.hover.x}
            y1={CHART.y}
            y2={CHART.y + CHART.height}
            stroke={palette.axis}
            strokeDasharray="4 4"
            strokeWidth="1"
          />
        )}

        <polyline
          fill="none"
          stroke={palette.pLine}
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={polyline(model.pPoints)}
        />
        <polyline
          fill="none"
          stroke={palette.oLine}
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={polyline(model.oPoints)}
        />

        {model.pPoints.map((point) => (
          <rect
            key={`p-${point.label}`}
            x={point.x - 2.6}
            y={point.y - 2.6}
            width="5.2"
            height="5.2"
            fill={palette.pLine}
          />
        ))}
        {model.oPoints.map((point) => (
          <rect
            key={`o-${point.label}`}
            x={point.x - 2.6}
            y={point.y - 2.6}
            width="5.2"
            height="5.2"
            fill={palette.oLine}
          />
        ))}

        {model.xTicks.map((tick) => (
          <text
            key={tick.label}
            x={tick.x}
            y={CHART.y + CHART.height + 18}
            textAnchor="middle"
            fontSize="18"
            fill={palette.subtleText}
            style={{ fontFamily: FONT_FAMILY }}
          >
            {tick.label}
          </text>
        ))}

        {model.hover?.o && model.hover?.p && (
          <TooltipTag
            x={Math.max(model.hover.o.x, model.hover.p.x) + 12}
            y={Math.min(model.hover.o.y, model.hover.p.y) - 16}
            color={palette.oLine}
            background={palette.tooltipBg}
            textColor={palette.tooltipText}
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

function Legend({ label, color, text }: { label: string; color: string; text: string }) {
  return (
    <g>
      <line x1="0" x2="22" y1="8" y2="8" stroke={color} strokeWidth="2" />
      <rect x="8.5" y="5.5" width="5" height="5" fill={color} />
      <text
        x="30"
        y="14"
        fontSize="18"
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
  lines,
}: {
  x: number;
  y: number;
  color: string;
  background: string;
  textColor: string;
  lines: string[];
}) {
  const width = Math.max(170, ...lines.map((line) => line.length * 10));
  const height = 16 + lines.length * 22;
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
      />
      {lines.map((line, index) => (
        <text
          key={line}
          x={x + 8}
          y={y + 22 + index * 22}
          fontSize="18"
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

const FONT_FAMILY = `'Segoe UI', 'Microsoft YaHei UI', 'PingFang SC', sans-serif`;

function buildModel(pSeries: number[], oSeries: number[], hoveredLabel: string | null) {
  const all = [...pSeries, ...oSeries].filter(Number.isFinite);
  const max = all.length ? Math.max(...all) : 1;
  const min = all.length ? Math.min(...all) : 0;
  const range = Math.max(1, max - min);
  const padding = Math.max(24, range * 0.1);
  const domainMin = Math.max(0, min - padding);
  const domainMax = max + padding;

  const xFor = (index: number) => CHART.x + (CHART.width * index) / (LABELS.length - 1);
  const yFor = (value: number) =>
    CHART.y + CHART.height - ((value - domainMin) / (domainMax - domainMin || 1)) * CHART.height;

  const pPoints: Point[] = LABELS
    .map((label, index) => ({ label, value: pSeries[index], x: xFor(index) }))
    .filter((point) => Number.isFinite(point.value))
    .map((point) => ({ ...point, y: yFor(point.value) }));

  const oPoints: Point[] = LABELS
    .map((label, index) => ({ label, value: oSeries[index], x: xFor(index) }))
    .filter((point) => Number.isFinite(point.value))
    .map((point) => ({ ...point, y: yFor(point.value) }));

  const xTicks = LABELS.map((label, index) => ({ label, x: xFor(index) }));
  const hGrid = Array.from({ length: 5 }, (_, index) => CHART.y + (CHART.height * index) / 4);
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
