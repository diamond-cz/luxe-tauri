import { useTranslation } from "react-i18next";
import { FormulaHeader, type FormulaSourceComparison } from "./FormulaHeader";

interface DetailStep {
  title: string;
  formula: string;
  substitution: string;
  result: number;
}

interface SummaryRow {
  key: "exif" | "parameter";
  values: number[];
  steps: DetailStep[];
}

interface NormalFormulaValues {
  mtHsTarget: number;
  finalTarget: number;
  nsTarget: number;
  nsProb: number;
  exifMtHsExpression: string;
  exifFinalExpression: string;
  sourceValues: Array<{ name: string; value: number; source: string }>;
}

const summaryNumber = (value: number) => Number.isFinite(value) ? String(Math.round(value)) : "-";
const detailNumber = (value: number) => Number.isFinite(value) ? value.toFixed(1) : "-";
// Only numeric substitution expressions pass here, never symbolic names or source paths.
const detailExpression = (expression: string) => expression.replace(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?/gi,
  (value) => detailNumber(Number(value)));

/** Read-only two-source summary. Supplied results remain owned by the existing calculators. */
function DerivedTargetFormula({ title, columns, rows, formulas, sources }: {
  title: string; columns: string[]; rows: SummaryRow[]; formulas: string[]; sources: FormulaSourceComparison[];
}) {
  const { t } = useTranslation();
  const details = rows.map(({ key, steps }) => <div key={key} className="grid gap-2 text-xs leading-5">
    <div className="font-semibold">{title} · {key === "exif" ? "EXIF" : t("face_link_formula.parameter")}</div>
    {steps.map((step, index) => <section key={index}>
      <div style={{ color: "var(--colorNeutralForeground3)" }}>{step.title}</div>
      <code className="block whitespace-normal break-words">{step.substitution} = <strong>{detailNumber(step.result)}</strong></code>
    </section>)}
  </div>);
  return <div className="formula-panel w-full min-w-0 text-xs" style={{ color: "var(--colorNeutralForeground2)" }}>
    <FormulaHeader formulas={formulas} sources={sources} details={details} />
    <table className="w-full table-fixed border-collapse text-left" aria-label={t("target_formula.summary", { target: title })}>
      <colgroup>{[16, 22, 20, 20, 22].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
      <thead><tr style={{ color: "var(--colorNeutralForeground3)" }}>
        {[t("face_link_formula.source"), ...columns, t("face_link_formula.result")].map((column) => (
          <th key={column} scope="col" className="break-words px-1.5 pb-1 font-normal">{column}</th>
        ))}
      </tr></thead>
      <tbody>{rows.map(({ key, values }) => <tr key={key} className="border-t" style={{ borderColor: "var(--colorNeutralStroke2)" }}>
          <th scope="row" className="break-words px-1.5 py-1.5 font-medium">{key === "exif" ? "EXIF" : t("face_link_formula.parameter")}</th>
          {values.map((value, index) => <td key={index} className="break-words px-1.5 py-1.5 tabular-nums">
            {index === values.length - 1
              ? <strong style={{ color: "var(--colorNeutralForeground1)" }}>{summaryNumber(value)}</strong>
              : summaryNumber(value)}
          </td>)}
        </tr>)}</tbody>
    </table>
  </div>;
}

export function FaceTargetFormula({ title, cwv, fdy, exifThreshold, parameterThreshold, exifResult, parameterResult, targetKey, thresholdTitle, cwvSourceKey }: {
  title: string;
  cwv: number;
  fdy: number;
  exifThreshold: number;
  parameterThreshold: number;
  exifResult: number;
  parameterResult: number;
  targetKey: string;
  thresholdTitle: string;
  cwvSourceKey?: string;
}) {
  const { t } = useTranslation();
  const rows: SummaryRow[] = [
    { key: "exif", values: [cwv, exifThreshold, fdy, exifResult], steps: [{
      title: t("target_formula.calculation"), formula: `CWV × (${targetKey} / FDY)`,
      substitution: `${detailNumber(cwv)} × (${detailNumber(exifThreshold)} / ${detailNumber(fdy)})`, result: exifResult,
    }] },
    { key: "parameter", values: [cwv, parameterThreshold, fdy, parameterResult], steps: [{
      title: t("target_formula.calculation"), formula: `CWV × (${thresholdTitle} / FDY)`,
      substitution: `${detailNumber(cwv)} × (${detailNumber(parameterThreshold)} / ${detailNumber(fdy)})`, result: parameterResult,
    }] },
  ];
  const shared = (name: string, value: number, source: string): FormulaSourceComparison => ({ name, exif: { value, source }, parameter: { value, source } });
  return <DerivedTargetFormula title={title} columns={["CWV", thresholdTitle, "FDY"]} rows={rows}
    formulas={[`CWV × (${thresholdTitle} / FDY)`]} sources={[
      shared("CWV", cwv, `EXIF · ${cwvSourceKey ?? "CWV"}`),
      { name: thresholdTitle, exif: { value: exifThreshold, source: `EXIF · ${targetKey}` },
        parameter: { value: parameterThreshold, source: t("target_formula.threshold_source", { threshold: thresholdTitle }) } },
      shared("FDY", fdy, `EXIF · AE_TAG_${thresholdTitle === "FLT_TH" ? "FLT" : "FBT"}_FDY`),
    ]} />;
}

export function BackSceneTargetFormula({ exifTarget, parameterTarget, exifWeight, parameterWeight, normalTarget, exifResult, parameterResult, normalTargetSource }: {
  exifTarget: number;
  parameterTarget: number;
  exifWeight: number;
  parameterWeight: number;
  normalTarget: number;
  exifResult: number;
  parameterResult: number;
  normalTargetSource: string;
}) {
  const { t } = useTranslation();
  const formula = "Back Scene Target = (FBT_Target × FaceProb + Normal_Target × (1024 − FaceProb)) / 1024";
  const step = (target: number, weight: number, result: number): DetailStep => ({
    title: t("target_formula.calculation"), formula,
    substitution: `(${detailNumber(target)} × ${detailNumber(weight)} + ${detailNumber(normalTarget)} × (1024 − ${detailNumber(weight)})) / 1024`,
    result,
  });
  return <DerivedTargetFormula title="Back Scene Target" columns={["FBT_Target", "FaceProb", "Normal_Target"]}
    formulas={[formula]} rows={[
      { key: "exif", values: [exifTarget, exifWeight, normalTarget, exifResult], steps: [step(exifTarget, exifWeight, exifResult)] },
      { key: "parameter", values: [parameterTarget, parameterWeight, normalTarget, parameterResult], steps: [step(parameterTarget, parameterWeight, parameterResult)] },
    ]} sources={[
      { name: "FBT_Target", exif: { value: exifTarget, source: "CWV(EXIF) × AE_TAG_FBT_TARGET(EXIF) / AE_TAG_FBT_FDY(EXIF)" },
        parameter: { value: parameterTarget, source: "CWV(EXIF) × FBT_TH(AE.cpp) / AE_TAG_FBT_FDY(EXIF)" } },
      { name: "FaceProb", exif: { value: exifWeight, source: "EXIF · AE_TAG_FACE_PROB" },
        parameter: { value: parameterWeight, source: t("target_formula.parameter_source", { name: "FaceProb" }) } },
      { name: "Normal_Target", exif: { value: normalTarget, source: normalTargetSource },
        parameter: { value: normalTarget, source: normalTargetSource } },
    ]} />;
}

export function NormalTargetFormula({ exif, parameter }: { exif: NormalFormulaValues; parameter: NormalFormulaValues }) {
  const { t } = useTranslation();
  const rows: SummaryRow[] = (["exif", "parameter"] as const).map((key) => {
    const values = key === "exif" ? exif : parameter;
    return { key, values: [values.mtHsTarget, values.nsProb, values.nsTarget, values.finalTarget], steps: [
      { title: t("target_formula.mt_hs"), formula: "Cal_mt+hs_tar = (MainT_Tar × MainT_Wt + Σ(HS_Tar × HS_Wt)) / (MainT_Wt + ΣHS_Wt)",
        substitution: detailExpression(values.exifMtHsExpression), result: values.mtHsTarget },
      { title: t("target_formula.ns_blend"), formula: "Cal_final_tar = Cal_mt+hs_tar × (1024 − NS_Prob) / 1024 + NS_Tar × NS_Prob / 1024",
        substitution: detailExpression(values.exifFinalExpression), result: values.finalTarget },
    ] };
  });
  const sourceNames = [...new Set([...exif.sourceValues, ...parameter.sourceValues].map((entry) => entry.name))];
  const sources = sourceNames.map((name): FormulaSourceComparison => {
    const exifValue = exif.sourceValues.find((entry) => entry.name === name);
    const parameterValue = parameter.sourceValues.find((entry) => entry.name === name);
    return { name, exif: exifValue ?? { value: NaN, source: "-" },
      parameter: { value: parameterValue?.value ?? NaN, source: parameterValue ? t("target_formula.parameter_source", { name }) : "-" } };
  });
  return <DerivedTargetFormula title="Normal Target" columns={["MainT + HS", "NS_Prob", "NS_Target"]} rows={rows}
    formulas={rows[0].steps.map((step) => step.formula)}
    sources={sources} />;
}
