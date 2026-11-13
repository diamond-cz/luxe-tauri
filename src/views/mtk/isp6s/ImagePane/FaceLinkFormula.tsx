import { Link } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";

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

function formulaDetails(values: FormulaValues, headings: { blend: string; bounds: string; result: string; sources: string }): string {
  const { faceTarget, weight, normalTarget, aeTarget, lowBound, highBound, rawTarget, lowLimit, highLimit, result } = values;
  const sourceLine = (name: string, value: number, path: string) =>
    `${name.padEnd(14)} ${formulaNumber(value).padStart(8)}  |  ${path}`;
  return [
    headings.blend,
    "raw = (FLT_Target * FDSZ_RA + Normal_Target * (1024.0 - FDSZ_RA)) / 1024.0",
    `    = (${formulaNumber(faceTarget)} * ${formulaNumber(weight)} + ${formulaNumber(normalTarget)} * (1024.0 - ${formulaNumber(weight)})) / 1024.0`,
    `    = ${formulaNumber(rawTarget)}`,
    "",
    headings.bounds,
    `low  = ${formulaNumber(aeTarget)} * ${formulaNumber(lowBound)} / 1024.0 = ${formulaNumber(lowLimit)}`,
    `high = ${formulaNumber(aeTarget)} * ${formulaNumber(highBound)} / 1024.0 = ${formulaNumber(highLimit)}`,
    "",
    headings.result,
    `limit(${formulaNumber(rawTarget)}, ${formulaNumber(lowLimit)}, ${formulaNumber(highLimit)}) = ${formulaNumber(result)}`,
    "",
    headings.sources,
    sourceLine("AE_Target", aeTarget, "EXIF · AE_TAG_AE_TARGET"),
    sourceLine("FDSZ_RA", weight, values.weightSource),
    sourceLine("Normal_Target", normalTarget, values.normalTargetSource),
    sourceLine("low_bound", lowBound, values.lowBoundSource),
    sourceLine("high_bound", highBound, values.highBoundSource),
  ].join("\n");
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
  return <div className="w-full min-w-0 text-xs" style={{ color: "var(--colorNeutralForeground2)", fontFamily: "var(--fontFamilyBase, 'Segoe UI', sans-serif)" }}>
    <p className="mb-2 mt-0 text-[11px]" style={{ color: "var(--colorNeutralForeground3)" }}>{t("face_link_formula.flow")}</p>
    <table className="w-full table-fixed border-collapse text-left" aria-label={t("face_link_formula.summary")}>
      <colgroup><col style={{ width: "17%" }} /><col style={{ width: "22%" }} /><col style={{ width: "36%" }} /><col style={{ width: "25%" }} /></colgroup>
      <thead><tr style={{ color: "var(--colorNeutralForeground3)" }}>
        {["source", "weighted", "range", "result"].map((key) => <th key={key} scope="col" className="break-words px-1.5 pb-1 font-normal">{t(`face_link_formula.${key}`)}</th>)}
      </tr></thead>
      <tbody>{rows.map(({ key, label, values }) => <tr key={key} tabIndex={0}
        title={formulaDetails(values, headings)} data-tooltip-position="below-start" data-tooltip-wrap="true" data-tooltip-max-width={720} data-tooltip-monospace="true"
        className="border-t" style={{ borderColor: "var(--colorNeutralStroke2)" }}>
        <th scope="row" className="break-words px-1.5 py-1.5 font-medium">{label}</th>
        <td className="break-words px-1.5 py-1.5 tabular-nums">{displayNumber(values.rawTarget)}</td>
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
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--colorNeutralForeground3)" }}>
      <span>{t("face_link_formula.parameters")}</span>
      {[
        { key: "low", path: lowBoundPath, value: parameter.lowBound, jump: onJumpToLow },
        { key: "high", path: highBoundPath, value: parameter.highBound, jump: onJumpToHigh },
      ].map(({ key, path, value, jump }) => <Link key={key} as="button" disabled={!jump} onClick={jump} style={{ fontSize: "inherit" }}
        title={t("face_link_formula.jump", { bound: t(`face_link_formula.${key}`), path, value: formulaNumber(value) })}
        aria-label={t("face_link_formula.jump", { bound: t(`face_link_formula.${key}`), path, value: formulaNumber(value) })}
        data-tooltip-position="below-start" data-tooltip-wrap="true" data-tooltip-max-width={480} data-tooltip-monospace="true">
        {t(`face_link_formula.${key}`)} <code>{path}</code>
      </Link>)}
    </div>
  </div>;
}
