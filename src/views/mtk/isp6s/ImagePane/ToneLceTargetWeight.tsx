import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import type { LceTargetCalculation } from "./toneLceTarget";
import { ToneLceChartHeader } from "./ToneLceChartHeader";

const segments = [
  { key: "lv", label: "LV", color: "var(--colorPaletteBlueForeground2)", formula: "LVProb / 1000" },
  { key: "luma", label: "Luma", color: "var(--colorPaletteGreenForeground1)", formula: "(1 − LVProb / 1000) × (1 − LumaFlatProb / 1000)" },
  { key: "flat", label: "Flat", color: "var(--colorPaletteRedForeground1)", formula: "(1 − LVProb / 1000) × LumaFlatProb / 1000" },
] as const;

const numberText = (value: number) => Number.isFinite(value) ? String(value) : "-";

/** Fixed, three-segment SVG; no image decoding, observers, chart library or persistent state. */
export function ToneLceTargetWeight({ calculation }: { calculation: LceTargetCalculation }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const formulaId = useId();
  const { weights, lumaProb, flatProb, recordedLumaFlatProb, lvProb,
    lvTarget, recordedLumaFlatTarget, lumaTarget, flatTarget } = calculation;
  const values = [
    ["SW_LCE_LVProb", lvProb, lvTarget, "SW_LCE_LVTarget"],
    ["SW_LCE_LumaFlatProb", recordedLumaFlatProb, recordedLumaFlatTarget, "SW_LCE_LumaFlatTarget"],
    ["SW_LCE_LumaProb", lumaProb, lumaTarget, "SW_LCE_LumaTarget"],
    ["SW_LCE_FlatProb", flatProb, flatTarget, "SW_LCE_FlatTarget"],
  ] as const;
  let offset = 0;
  const slices = segments.map((segment) => {
    const weight = weights?.[segment.key] ?? 0;
    const slice = { ...segment, weight, offset };
    offset += weight;
    return slice;
  });
  const description = weights ? slices.map(({ label, weight }) => `${label} ${(weight * 100).toFixed(1)}%`).join(", ")
    : t("tone_lce.invalid_weights");
  const labels = slices.map((slice) => {
    const angle = (45 + (slice.offset + slice.weight / 2) * 360) * Math.PI / 180;
    const right = Math.cos(angle) >= 0;
    return { ...slice, right, x: 210 + Math.cos(angle) * 84, y: 115 + Math.sin(angle) * 84,
      labelY: Math.max(18, Math.min(212, 115 + Math.sin(angle) * 103)) };
  });
  // Separate labels on each side, including zero-sized segments at a shared boundary.
  for (const right of [false, true]) {
    const side = labels.filter((label) => label.right === right).sort((a, b) => a.labelY - b.labelY);
    side.forEach((label, index) => { if (index > 0) label.labelY = Math.max(label.labelY, side[index - 1].labelY + 24); });
    if (side.length && side[side.length - 1].labelY > 212) {
      side[side.length - 1].labelY = 212;
      for (let index = side.length - 2; index >= 0; index--) side[index].labelY = Math.min(side[index].labelY, side[index + 1].labelY - 24);
    }
  }

  return <section className="tone-lce-chart-card" aria-label="LCE Target Weight">
    <ToneLceChartHeader title="LCE Target Weight" source={t("tone_lce.weight_source")} expanded={expanded}
      controls={formulaId} onToggle={() => setExpanded((value) => !value)} />
    <div id={formulaId} className="tone-lce-chart-formula formula-panel" hidden={!expanded}>
      <table className="w-full table-auto border-collapse text-left tabular-nums" aria-label="LCE Target Weight · EXIF">
        <tbody>{values.map(([key, value, target, targetKey]) => <tr key={key}>
          <th scope="row" className="font-normal">{key}</th>
          <td className="text-center">{numberText(value)}</td>
          <td className="text-center">{numberText(target)}</td>
          <td className="tone-lce-target-key text-right">{targetKey}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="tone-lce-chart-body">
      <svg viewBox="0 0 420 230" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`LCE Target Weight: ${description}`}
        style={{ fontFamily: "var(--fontFamilyBase, 'Segoe UI', sans-serif)" }}>
        <circle cx="210" cy="115" r="68" fill="none" stroke="var(--colorNeutralBackground3)" strokeWidth="30" />
        {weights && slices.filter(({ weight }) => weight > 0).map(({ key, label, color, weight, offset: start, formula }) => (
          <HoverTooltip key={key} svg wrap positioning="above-center" maxWidth={360}
            content={`${label}: ${(weight * 100).toFixed(1)}%\n${formula}`}>
            <circle cx="210" cy="115" r="68" fill="none" stroke={color} strokeWidth="30" pathLength="100"
              tabIndex={0} role="img" aria-label={`${label}: ${(weight * 100).toFixed(1)}%`}
              strokeDasharray={`${weight * 100} ${100 - weight * 100}`} strokeDashoffset={-start * 100} transform="rotate(45 210 115)" />
          </HoverTooltip>
        ))}
        {weights && labels.map(({ key, label, weight, right, x, y, labelY, formula }) => <HoverTooltip key={key} svg wrap positioning="above-center" maxWidth={360}
          content={`${label}: ${(weight * 100).toFixed(1)}%\n${formula}`}>
          <g tabIndex={0} role="img" aria-label={`${label}: ${(weight * 100).toFixed(1)}%`}>
          <polyline points={`${x},${y} ${right ? 310 : 110},${labelY} ${right ? 330 : 90},${labelY}`}
            fill="none" stroke="var(--colorNeutralForeground3)" strokeWidth="1" />
          <rect x={right ? 330 : 5} y={labelY - 9} width="85" height="18" rx="1"
            fill="var(--colorNeutralBackground1)" stroke="var(--colorNeutralStroke1)" />
          <text x={right ? 372.5 : 47.5} y={labelY} dominantBaseline="central" textAnchor="middle" fontSize="11" fill="var(--colorNeutralForeground1)">
            {`${label} ${(weight * 100).toFixed(1)}%`}
          </text>
          </g>
        </HoverTooltip>)}
      </svg>
      {!weights && <p role="status" className="absolute bottom-1 left-2 right-2 m-0 text-center text-[11px]" style={{ color: "var(--colorNeutralForeground2)" }}>{t("tone_lce.invalid_weights")}</p>}
    </div>
  </section>;
}
