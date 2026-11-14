import { useState } from "react";
import { useTranslation } from "react-i18next";
import { buildLceCurve, LCE_CURVE_MAX } from "./toneLceCurveModel";

const formatValue = (value: number) => Number.isFinite(value) ? String(Number(value.toFixed(2))) : "-";
const ticks = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500];
const plot = { left: 42, top: 23, width: 554, height: 324 };
const xAt = (value: number) => plot.left + value / LCE_CURVE_MAX * plot.width;
const yAt = (value: number) => plot.top + (1 - value / LCE_CURVE_MAX) * plot.height;

export function ToneLceCurve({ tomlData }: { tomlData: Record<string, string> }) {
  const { t } = useTranslation();
  const curve = buildLceCurve(tomlData);
  const [hover, setHover] = useState<number | null>(null);
  const active = hover === null ? null : curve.nodes[hover];
  return <section className="tone-lce-chart-card" aria-label="LCE Curve">
    <div className="tone-lce-chart-header">
      <strong>LCE Curve</strong>
    </div>
    <div className="tone-lce-chart-body">
    <svg viewBox="0 0 620 380" preserveAspectRatio="xMidYMid meet" role="img" aria-label={t("tone_lce.curve_axes")}
      style={{ fontFamily: "var(--fontFamilyBase, 'Segoe UI', sans-serif)" }}
      onMouseLeave={() => setHover(null)}>
      {ticks.map((value) => <g key={value}>
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
      {curve.nodes.filter((node) => node.valid).map((node) => <circle key={node.index} cx={xAt(node.p)} cy={yAt(node.o)} r={hover === node.index ? 5 : 3}
        tabIndex={0} role="img" aria-label={`P: ${node.p}, O: ${node.o}, O − P: ${node.gain}`}
        fill="var(--colorPaletteBlueForeground2)" onMouseEnter={() => setHover(node.index)} onFocus={() => setHover(node.index)} onBlur={() => setHover(null)}>
        <title>{`${node.pKey}: ${node.p}; ${node.oKey}: ${node.o}; O − P: ${node.gain}`}</title>
      </circle>)}
      {active?.valid && <g pointerEvents="none">
        <line x1={xAt(active.p)} x2={xAt(active.p)} y1={plot.top} y2={plot.top + plot.height} stroke="var(--colorBrandStroke1)" strokeDasharray="3 3" />
        <rect x={Math.min(xAt(active.p) + 8, plot.left + plot.width - 162)} y={Math.max(plot.top + 4, yAt(active.o) - 36)}
          width="154" height="28" rx="3" fill="var(--colorNeutralBackground1)" stroke="var(--colorNeutralStroke1)" />
        <text x={Math.min(xAt(active.p) + 15, plot.left + plot.width - 155)} y={Math.max(plot.top + 21, yAt(active.o) - 19)}
          fontSize="11" fill="var(--colorNeutralForeground1)">{`P ${active.p} · O ${active.o}`}</text>
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
      {!curve.available && <text x="300" y="140" textAnchor="middle" fontSize="12" fill="var(--colorNeutralForeground2)">{t("tone_lce.curve_unavailable")}</text>}
    </svg>
    </div>
    <div className="tone-lce-chart-footer">
      <table className="w-full table-fixed border-collapse text-center tabular-nums" style={{ minWidth: 380 }} aria-label={t("tone_lce.curve_nodes")}>
        <thead><tr style={{ background: "var(--colorNeutralBackground2)" }}>
          <th className="border px-1 font-normal" style={{ borderColor: "var(--colorNeutralStroke2)" }} scope="col">EXIF</th>
          {curve.nodes.map((node) => <th key={node.index} scope="col" className="border px-1 font-normal" style={{ borderColor: "var(--colorNeutralStroke2)" }}>{node.index}</th>)}
        </tr></thead>
        <tbody>{(["p", "o", "gain"] as const).map((key) => <tr key={key}>
          <th className="border px-1 font-medium" style={{ borderColor: "var(--colorNeutralStroke2)" }} scope="row" title={key === "gain" ? "O − P" : undefined}>{key === "gain" ? "Gain" : key.toUpperCase()}</th>
          {curve.nodes.map((node) => <td key={node.index} className="border px-1" style={{ borderColor: "var(--colorNeutralStroke2)" }}
            title={key === "p" ? node.pKey : key === "o" ? node.oKey : `${node.oKey} − ${node.pKey}`}>{formatValue(node[key])}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
