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
    ["SW_LCE_LumaProb", lumaProb], ["SW_LCE_FlatProb", flatProb],
    ["SW_LCE_LumaFlatProb", recordedLumaFlatProb], ["SW_LCE_LVProb", lvProb],
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

  return <section className="min-w-0 rounded-lg border" aria-label="LCE Target Weight"
    style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground1)" }}>
    <div className="border-b px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--colorNeutralStroke2)" }}>LCE Target Weight</div>
    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 p-3">
      <svg viewBox="0 0 180 180" role="img" aria-label={`LCE Target Weight: ${description}`}
        className="h-44 w-44 shrink-0">
        <circle cx="90" cy="90" r="64" fill="none" stroke="var(--colorNeutralBackground3)" strokeWidth="24" />
        {weights && slices.filter(({ weight }) => weight > 0).map(({ key, label, color, weight, offset: start }) => (
          <circle key={key} cx="90" cy="90" r="64" fill="none" stroke={color} strokeWidth="24" pathLength="100"
            strokeDasharray={`${weight * 100} ${100 - weight * 100}`} strokeDashoffset={-start * 100} transform="rotate(-90 90 90)">
            <title>{`${label}: ${(weight * 100).toFixed(1)}%`}</title>
          </circle>
        ))}
        <text x="90" y="87" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--colorNeutralForeground1)">EXIF</text>
        <text x="90" y="106" textAnchor="middle" fontSize="11" fill="var(--colorNeutralForeground3)">{weights ? "100%" : "-"}</text>
      </svg>
      <div className="min-w-0 flex-1 basis-56 text-xs">
        <div className="mb-3 grid grid-cols-3 gap-2">
          {slices.map(({ key, label, color, weight, formula }) => <div key={key} title={formula}>
            <div className="mb-1 flex items-center gap-1.5" style={{ color: "var(--colorNeutralForeground2)" }}>
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />{label}
            </div>
            <strong className="font-mono text-sm tabular-nums" style={{ color: "var(--colorNeutralForeground1)" }}>{weights ? `${(weight * 100).toFixed(1)}%` : "-"}</strong>
          </div>)}
        </div>
        <p className="mb-2 mt-0 text-[11px] leading-4" style={{ color: "var(--colorNeutralForeground3)" }}>{t("tone_lce.weight_source")}</p>
        {!weights && <p role="status" className="mb-2 text-[11px]" style={{ color: "var(--colorNeutralForeground2)" }}>{t("tone_lce.invalid_weights")}</p>}
        <dl className="m-0 grid gap-1">
          {values.map(([key, value]) => <div key={key} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
            <dt className="min-w-0 break-all font-mono text-[11px]" style={{ color: "var(--colorNeutralForeground2)" }}>{key}</dt>
            <dd className="m-0 font-mono tabular-nums" style={{ color: "var(--colorNeutralForeground1)" }}>{numberText(value)}</dd>
          </div>)}
        </dl>
      </div>
    </div>
  </section>;
}
