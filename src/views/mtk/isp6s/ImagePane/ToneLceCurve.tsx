import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import { buildLceCurve, LCE_CURVE_MAX } from "./toneLceCurveModel";
import { ToneLceChartHeader } from "./ToneLceChartHeader";

const formatValue = (value: number) => Number.isFinite(value) ? String(Number(value.toFixed(2))) : "-";
const ticks = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500];

export function ToneLceCurve({ tomlData }: { tomlData: Record<string, string> }) {
  const { t } = useTranslation();
  const curve = buildLceCurve(tomlData);
  const [hover, setHover] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(true);
  const formulaId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState({ width: 620, height: 380 });
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const update = () => {
      const width = Math.round(svg.clientWidth);
      const height = Math.round(svg.clientHeight);
      if (width <= 0 || height <= 0) return;
      setViewport((previous) => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const observer = new ResizeObserver(update);
    observer.observe(svg);
    update();
    return () => observer.disconnect();
  }, []);
  const plot = { left: 42, top: 23, width: Math.max(1, viewport.width - 66), height: Math.max(1, viewport.height - 56) };
  const xAt = (value: number) => plot.left + value / LCE_CURVE_MAX * plot.width;
  const yAt = (value: number) => plot.top + (1 - value / LCE_CURVE_MAX) * plot.height;
  const visibleTicks = viewport.width < 360 ? ticks.filter((value) => value % 1000 === 0) : ticks;
  const active = hover === null ? null : curve.nodes[hover];
  return <section className="tone-lce-chart-card" aria-label="LCE Curve">
    <ToneLceChartHeader title="LCE Curve" expanded={expanded} controls={formulaId} onToggle={() => setExpanded((value) => !value)} />
    <div id={formulaId} className="tone-lce-chart-formula formula-panel" hidden={!expanded}>
      <div className="formula-expression">Gain = O − P</div>
      <table className="w-full table-fixed border-collapse text-center tabular-nums" aria-label={t("tone_lce.curve_nodes")}>
        <thead><tr>
          <th className="font-normal" scope="col">EXIF</th>
          {curve.nodes.map((node) => <th key={node.index} scope="col" className="font-normal">{node.index}</th>)}
        </tr></thead>
        <tbody>{(["p", "o", "gain"] as const).map((key) => <tr key={key}>
          <th className="font-normal" scope="row" title={key === "gain" ? "O − P" : undefined}>{key === "gain" ? "Gain" : key.toUpperCase()}</th>
          {curve.nodes.map((node) => <td key={node.index}
            title={key === "p" ? node.pKey : key === "o" ? node.oKey : `${node.oKey} − ${node.pKey}`}>{formatValue(node[key])}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="tone-lce-chart-body">
    <svg ref={svgRef} viewBox={`0 0 ${viewport.width} ${viewport.height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={t("tone_lce.curve_axes")}
      style={{ fontFamily: "var(--fontFamilyBase, 'Segoe UI', sans-serif)" }}
      onMouseLeave={() => setHover(null)}>
      {visibleTicks.map((value) => <g key={value}>
        <line x1={xAt(value)} y1={plot.top} x2={xAt(value)} y2={plot.top + plot.height} stroke="var(--colorNeutralStroke2)" />
        <line x1={plot.left} y1={yAt(value)} x2={plot.left + plot.width} y2={yAt(value)} stroke="var(--colorNeutralStroke2)" />
        <text x={xAt(value)} y={plot.top + plot.height + 17} fontSize="10" textAnchor="middle" fill="var(--colorNeutralForeground3)">{value}</text>
        <text x={plot.left - 7} y={yAt(value) + 3} fontSize="10" textAnchor="end" fill="var(--colorNeutralForeground3)">{value}</text>
      </g>)}
      <rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} fill="none" stroke="var(--colorNeutralStroke1)" />
      <line x1={xAt(0)} y1={yAt(0)} x2={xAt(3699)} y2={yAt(3699)} stroke="var(--colorNeutralForeground3)" strokeDasharray="5 3" />
      {curve.bounds.filter((bound) => Number.isFinite(bound.log) && bound.log >= 0 && bound.log <= LCE_CURVE_MAX).map((bound) => (
        <line key={bound.key} x1={xAt(bound.log)} x2={xAt(bound.log)} y1={plot.top} y2={plot.top + plot.height}
          stroke="var(--colorPaletteDarkOrangeForeground1)"><title>{`${bound.key}: ${bound.linear} → ${bound.log}`}</title></line>
      ))}
      {curve.segments.filter((segment) => segment.length > 1).map((segment, index) => <polyline key={index}
        points={segment.map((node) => `${xAt(node.p)},${yAt(node.o)}`).join(" ")} fill="none" stroke="var(--colorPaletteBlueForeground2)" strokeWidth="1.7" />)}
      {curve.nodes.filter((node) => node.valid).map((node) => <HoverTooltip key={node.index} svg wrap positioning="above-center" maxWidth={360}
        content={`${node.pKey}: ${formatValue(node.p)}\n${node.oKey}: ${formatValue(node.o)}\nGain (O − P): ${formatValue(node.gain)}`}>
        <circle cx={xAt(node.p)} cy={yAt(node.o)} r={hover === node.index ? 5 : 3}
        tabIndex={0} role="img" aria-label={`P: ${node.p}, O: ${node.o}, O − P: ${node.gain}`}
        fill="var(--colorPaletteBlueForeground2)" onMouseEnter={() => setHover(node.index)} onMouseLeave={() => setHover(null)}
        onFocus={() => setHover(node.index)} onBlur={() => setHover(null)} />
      </HoverTooltip>)}
      {active?.valid && <g pointerEvents="none">
        <line x1={xAt(active.p)} x2={xAt(active.p)} y1={plot.top} y2={plot.top + plot.height} stroke="var(--colorBrandStroke1)" strokeDasharray="3 3" />
      </g>}
      <text x={plot.left + plot.width + 11} y={plot.top + plot.height + 4} textAnchor="middle" fontSize="12" fill="var(--colorNeutralForeground2)">P</text>
      <text x={plot.left} y={plot.top - 9} textAnchor="middle" fontSize="12" fill="var(--colorNeutralForeground2)">O</text>
      <g transform={`translate(${plot.left + 8} ${plot.top + 8})`} aria-label={t("tone_lce.curve_legend")}>
        <rect width="154" height="65" rx="3" fill="var(--colorNeutralBackground1)" fillOpacity="0.94" stroke="var(--colorNeutralStroke2)" />
        {[
          { label: "EXIF (P, O)", color: "var(--colorPaletteBlueForeground2)" },
          { label: "O = P", color: "var(--colorNeutralForeground3)", dash: "4 3" },
          { label: t("tone_lce.curve_face_bounds"), color: "var(--colorPaletteDarkOrangeForeground1)" },
        ].map(({ label, color, dash }, index) => <g key={label} transform={`translate(8 ${14 + index * 19})`}>
          <line x1="0" x2="19" y1="0" y2="0" stroke={color} strokeWidth="1.8" strokeDasharray={dash} />
          <text x="26" y="3" fontSize="11" fill="var(--colorNeutralForeground2)">{label}</text>
        </g>)}
      </g>
      {!curve.available && <text x={viewport.width / 2} y={viewport.height / 2} textAnchor="middle" fontSize="12" fill="var(--colorNeutralForeground2)">{t("tone_lce.curve_unavailable")}</text>}
    </svg>
    </div>
  </section>;
}
