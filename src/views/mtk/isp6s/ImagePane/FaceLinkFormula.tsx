import { Link } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import { FormulaHeader } from "./FormulaHeader";

interface FormulaValues {
  faceTarget: number;
  weight: number;
  normalTarget: number;
  aeTarget: number;
  lowBound: number;
  highBound: number;
  rawTarget: number;
  lowLimit: number;
  highLimit: number;
  result: number;
  lowBoundSource: string;
  highBoundSource: string;
  weightSource: string;
  faceTargetSource?: string;
  normalTargetSource: string;
}

interface Props {
  exif: FormulaValues;
  parameter: FormulaValues;
  lowBoundPath: string;
  highBoundPath: string;
  onJumpToLow?: () => void;
  onJumpToHigh?: () => void;
}

// Formatting never feeds back into the shared calculation or clamp decision.
const displayNumber = (value: number) => Number.isFinite(value) ? String(Math.round(value)) : "-";
const formulaNumber = (value: number) => Number.isFinite(value) ? value.toFixed(1) : "-";

function formulaDetails(values: FormulaValues, headings: { blend: string; bounds: string; result: string; sources: string }) {
  const { faceTarget, weight, normalTarget, aeTarget, lowBound, highBound, rawTarget, lowLimit, highLimit, result } = values;
  const calculations = [
    { heading: headings.blend, lines: [
      "raw = (FLT_Target × FDSZ_RA + Normal_Target × (1024 − FDSZ_RA)) / 1024",
      `= (${formulaNumber(faceTarget)} × ${formulaNumber(weight)} + ${formulaNumber(normalTarget)} × (1024 − ${formulaNumber(weight)})) / 1024 = ${formulaNumber(rawTarget)}`,
    ] },
    { heading: headings.bounds, lines: [
      `low = ${formulaNumber(aeTarget)} × ${formulaNumber(lowBound)} / 1024 = ${formulaNumber(lowLimit)}`,
      `high = ${formulaNumber(aeTarget)} × ${formulaNumber(highBound)} / 1024 = ${formulaNumber(highLimit)}`,
    ] },
    { heading: headings.result, lines: [
      `limit(${formulaNumber(rawTarget)}, ${formulaNumber(lowLimit)}, ${formulaNumber(highLimit)}) = ${formulaNumber(result)}`,
    ] },
  ];
  const sources = [
    { name: "AE_Target", value: aeTarget, path: "EXIF · AE_TAG_AE_TARGET" },
    { name: "FDSZ_RA", value: weight, path: values.weightSource },
    { name: "Normal_Target", value: normalTarget, path: values.normalTargetSource },
    { name: "low_bound", value: lowBound, path: values.lowBoundSource },
    { name: "high_bound", value: highBound, path: values.highBoundSource },
  ];
  return <div className="grid gap-3 text-xs leading-5" style={{ color: "var(--colorNeutralForeground1)" }}>
    <div className="grid gap-2">
      {calculations.map(({ heading, lines }) => <section key={heading}
        className={heading === headings.result ? "rounded px-2 py-1.5" : undefined}
        style={heading === headings.result ? { backgroundColor: "var(--colorNeutralBackground2)" } : undefined}>
        <div className="mb-0.5 font-semibold" style={{ color: "var(--colorNeutralForeground2)" }}>{heading}</div>
        {lines.map((line) => <code key={line} className="block whitespace-normal break-words font-mono tabular-nums">{line}</code>)}
      </section>)}
    </div>
    <section className="border-t pt-2" style={{ borderColor: "var(--colorNeutralStroke2)" }}>
      <div className="mb-1 font-semibold" style={{ color: "var(--colorNeutralForeground2)" }}>{headings.sources}</div>
      <dl className="m-0 grid gap-1.5">
        {sources.map(({ name, value, path }) => <div key={name} className="grid grid-cols-[6.5rem_3.5rem_minmax(0,1fr)] items-baseline gap-x-2">
          <dt className="font-mono">{name}</dt>
          <dd className="m-0 break-all font-mono font-semibold tabular-nums">{formulaNumber(value)}</dd>
          <dd className="m-0 min-w-0 break-all text-[11px]" style={{ color: "var(--colorNeutralForeground3)" }}>{path}</dd>
        </div>)}
      </dl>
    </section>
  </div>;
}

function limitStatus(values: FormulaValues): "unavailable" | "raised" | "lowered" | "unchanged" {
  if (![values.rawTarget, values.lowLimit, values.highLimit, values.result].every(Number.isFinite)) return "unavailable";
  if (values.rawTarget < Math.min(values.lowLimit, values.highLimit)) return "raised";
  if (values.rawTarget > Math.max(values.lowLimit, values.highLimit)) return "lowered";
  return "unchanged";
}

/** Read-only summary; all numbers are supplied by the shared calculator. */
export function FaceLinkFormula({ exif, parameter, lowBoundPath, highBoundPath, onJumpToLow, onJumpToHigh }: Props) {
  const { t } = useTranslation();
  const headings = {
    blend: t("face_link_formula.detail_blend"), bounds: t("face_link_formula.detail_bounds"),
    result: t("face_link_formula.detail_result"), sources: t("face_link_formula.detail_sources"),
  };
  const rows = [{ key: "exif", label: "EXIF", values: exif },
    { key: "parameter", label: t("face_link_formula.parameter"), values: parameter }];
  const sourceRows = [
    { name: "FLT_Target", key: "faceTarget", sourceKey: "faceTargetSource" },
    { name: "FDSZ_RA", key: "weight", sourceKey: "weightSource" },
    { name: "Normal_Target", key: "normalTarget", sourceKey: "normalTargetSource" },
    { name: "low_bound", key: "lowBound", sourceKey: "lowBoundSource" },
    { name: "high_bound", key: "highBound", sourceKey: "highBoundSource" },
  ] as const;
  return <div className="formula-panel w-full min-w-0 text-xs" style={{ color: "var(--colorNeutralForeground2)" }}>
    <FormulaHeader formulas={[
      "raw = (FLT_Target × FDSZ_RA + Normal_Target × (1024 − FDSZ_RA)) / 1024",
      "low/high = AE_Target × low_bound/high_bound / 1024; final = limit(raw, low, high)",
    ]} sources={[
      { name: "AE_Target", exif: { value: exif.aeTarget, source: "EXIF · AE_TAG_AE_TARGET" }, parameter: { value: parameter.aeTarget, source: "EXIF · AE_TAG_AE_TARGET" } },
      ...sourceRows.map(({ name, key, sourceKey }) => ({ name,
        exif: { value: exif[key], source: exif[sourceKey] ?? "FLT_Target" },
        parameter: { value: parameter[key], source: parameter[sourceKey] ?? "FLT_Target" },
      })),
      ...([
        { name: "raw", key: "rawTarget", source: "(FLT_Target × FDSZ_RA + Normal_Target × (1024 − FDSZ_RA)) / 1024" },
        { name: "low", key: "lowLimit", source: "AE_Target × low_bound / 1024" },
        { name: "high", key: "highLimit", source: "AE_Target × high_bound / 1024" },
        { name: "final", key: "result", source: "limit(raw, low, high)" },
      ] as const).map(({ name, key, source }) => ({ name, exif: { value: exif[key], source }, parameter: { value: parameter[key], source } })),
    ]} details={rows.map(({ key, label, values }) => <section key={key}>
      <div className="mb-2 text-xs font-semibold">{label}</div>{formulaDetails(values, headings)}
    </section>)} />
    <table className="w-full table-fixed border-collapse text-left" aria-label={t("face_link_formula.summary")}>
      <colgroup><col style={{ width: "14%" }} /><col style={{ width: "16%" }} /><col style={{ width: "26%" }} /><col style={{ width: "22%" }} /><col style={{ width: "22%" }} /></colgroup>
      <thead><tr style={{ color: "var(--colorNeutralForeground3)" }}>
        {["source", "weighted", "boundaries", "range", "result"].map((key) => <th key={key} scope="col" className="break-words px-1.5 pb-1 font-normal">{t(`face_link_formula.${key}`)}</th>)}
      </tr></thead>
      <tbody>{rows.map(({ key: sourceKey, label, values }) => <tr key={sourceKey} className="border-t" style={{ borderColor: "var(--colorNeutralStroke2)" }}>
          <th scope="row" className="break-words px-1.5 py-1.5 font-medium">{label}</th>
          <td className="break-words px-1.5 py-1.5 tabular-nums">{displayNumber(values.rawTarget)}</td>
          <td className="px-1.5 py-1.5">
            <div role="group" aria-label={t(sourceKey === "exif" ? "face_link_formula.exif_bounds" : "face_link_formula.parameters")}
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {[
                { key: "low", path: lowBoundPath, value: values.lowBound, jump: onJumpToLow },
                { key: "high", path: highBoundPath, value: values.highBound, jump: onJumpToHigh },
              ].map(({ key, path, value, jump }) => {
                const bound = t(`face_link_formula.${key}`);
                return <span key={key} className="inline-flex items-baseline gap-1">
                  <span className="text-[11px]" style={{ color: "var(--colorNeutralForeground3)" }}>{bound}</span>
                  {sourceKey === "exif" ? <span className="font-medium tabular-nums">{displayNumber(value)}</span>
                    : <Link as="button" disabled={!jump || !Number.isFinite(value)} onClick={Number.isFinite(value) ? jump : undefined}
                      style={{ fontSize: "inherit", fontFamily: "inherit" }} className="tabular-nums"
                      aria-label={t("face_link_formula.jump", { bound, path, value: formulaNumber(value) })}>
                      {displayNumber(value)}
                    </Link>}
                </span>;
              })}
            </div>
          </td>
          <td className="break-words px-1.5 py-1.5 tabular-nums">{
            Number.isFinite(values.lowLimit) && Number.isFinite(values.highLimit)
              ? `[${displayNumber(Math.min(values.lowLimit, values.highLimit))}, ${displayNumber(Math.max(values.lowLimit, values.highLimit))}]` : "-"
          }</td>
          <td className="px-1.5 py-1.5">
            <strong className="tabular-nums" style={{ color: "var(--colorNeutralForeground1)" }}>{displayNumber(values.result)}</strong>
            <span className="ml-2 inline-block text-[11px]" style={{ color: "var(--colorNeutralForeground3)" }}>{t(`face_link_formula.${limitStatus(values)}`)}</span>
          </td>
        </tr>)}</tbody>
    </table>
  </div>;
}
