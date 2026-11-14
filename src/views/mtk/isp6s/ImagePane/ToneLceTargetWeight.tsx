import { useTranslation } from "react-i18next";
import type { LceTargetCalculation } from "./toneLceTarget";

const segments = [
  { key: "lv", label: "LV", color: "var(--colorPaletteBlueForeground2)", formula: "LVProb / 1000" },
  { key: "luma", label: "Luma", color: "var(--colorPaletteGreenForeground1)", formula: "(1 − LVProb / 1000) × (1 − LumaFlatProb / 1000)" },
  { key: "flat", label: "Flat", color: "var(--colorPaletteRedForeground1)", formula: "(1 − LVProb / 1000) × LumaFlatProb / 1000" },
] as const;

const numberText = (value: number) => Number.isFinite(value) ? String(value) : "-";

/** Fixed, three-segment SVG; no image decoding, observers, chart library or persistent state. */
export function ToneLceTargetWeight({ calculation }: { calculation: LceTargetCalculation }) {
  const { t } = useTranslation();
  const { weights, lumaProb, flatProb, recordedLumaFlatProb, lvProb } = calculation;
  const values = [
    ["SW_LCE_LVProb", lvProb], ["SW_LCE_LumaFlatProb", recordedLumaFlatProb],
    ["SW_LCE_LumaProb", lumaProb], ["SW_LCE_FlatProb", flatProb],
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
    <div className="tone-lce-chart-header font-semibold" title={t("tone_lce.weight_source")}
      style={{ borderColor: "var(--colorNeutralStroke2)" }}>LCE Target Weight</div>
    <div className="tone-lce-chart-body">
      <svg viewBox="0 0 420 230" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`LCE Target Weight: ${description}`}
        style={{ fontFamily: "var(--fontFamilyBase, 'Segoe UI', sans-serif)" }}>
        <circle cx="210" cy="115" r="68" fill="none" stroke="var(--colorNeutralBackground3)" strokeWidth="30" />
        {weights && slices.filter(({ weight }) => weight > 0).map(({ key, label, color, weight, offset: start }) => (
          <circle key={key} cx="210" cy="115" r="68" fill="none" stroke={color} strokeWidth="30" pathLength="100"
            strokeDasharray={`${weight * 100} ${100 - weight * 100}`} strokeDashoffset={-start * 100} transform="rotate(45 210 115)">
            <title>{`${label}: ${(weight * 100).toFixed(1)}%`}</title>
          </circle>
        ))}
        {weights && labels.map(({ key, label, weight, right, x, y, labelY, formula }) => <g key={key}>
          <title>{formula}</title>
          <polyline points={`${x},${y} ${right ? 310 : 110},${labelY} ${right ? 330 : 90},${labelY}`}
            fill="none" stroke="var(--colorNeutralForeground3)" strokeWidth="1" />
          <rect x={right ? 330 : 5} y={labelY - 9} width="85" height="18" rx="1"
            fill="var(--colorNeutralBackground1)" stroke="var(--colorNeutralStroke1)" />
          <text x={right ? 372.5 : 47.5} y={labelY} dominantBaseline="central" textAnchor="middle" fontSize="11" fill="var(--colorNeutralForeground1)">
            {`${label} ${(weight * 100).toFixed(1)}%`}
          </text>
        </g>)}
      </svg>
      {!weights && <p role="status" className="absolute bottom-1 left-2 right-2 m-0 text-center text-[11px]" style={{ color: "var(--colorNeutralForeground2)" }}>{t("tone_lce.invalid_weights")}</p>}
    </div>
    <div className="tone-lce-chart-footer">
      <table className="w-full table-fixed border-collapse text-left tabular-nums" aria-label="LCE Target Weight · EXIF">
        <colgroup><col style={{ width: "76%" }} /><col style={{ width: "24%" }} /></colgroup>
        <tbody>{values.map(([key, value]) => <tr key={key}>
          <th scope="row" className="break-all border px-2 font-normal" style={{ borderColor: "var(--colorNeutralStroke2)", color: "var(--colorNeutralForeground2)" }}>{key}</th>
          <td className="border px-2 text-right" style={{ borderColor: "var(--colorNeutralStroke2)", color: "var(--colorNeutralForeground1)" }}>{numberText(value)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
