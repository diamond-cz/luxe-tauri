import { useState, type ReactNode } from "react";
import { Button, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { Dismiss20Regular, QuestionCircle20Regular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";

export interface FormulaSourceComparison {
  name: string;
  exif: { value: number; source: string };
  parameter: { value: number; source: string };
}

const numberText = (value: number) => Number.isFinite(value) ? (Math.abs(value) < 0.05 ? 0 : value).toFixed(1) : "-";

/** Click-only help shared by the fixed Target formula cards. */
export function FormulaHeader({ formulas, sources, details }: {
  formulas: string[];
  sources: FormulaSourceComparison[];
  details?: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <div className="mb-2 flex items-start gap-2 border-b px-1.5 pb-2 pt-0.5" style={{ borderColor: "var(--colorNeutralStroke2)" }}>
    <div className="formula-expression min-w-0 flex-1 text-[13px] leading-6" style={{ color: "var(--colorNeutralForeground1)" }}>
      {formulas.map((formula, index) => <div key={formula}
        className={`break-words ${index > 0 ? "mt-1" : ""}`}>{formula}</div>)}
    </div>
    <Popover open={open} onOpenChange={(_, data) => setOpen(data.open)}
      positioning={{ position: "below", align: "end", strategy: "fixed", autoSize: "height",
      flipBoundary: "window", overflowBoundary: "window", overflowBoundaryPadding: 16,
      shiftToCoverTarget: true, fallbackPositions: ["above-end", "before-top", "after-top"] }} trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <Button appearance="subtle" size="small" icon={<QuestionCircle20Regular />} aria-label={t("target_formula.compare_sources")}
          style={{ fontFamily: "var(--font-family-formula)" }} />
      </PopoverTrigger>
      <PopoverSurface className="formula-source-surface" aria-label={t("target_formula.compare_sources")}
        style={{ width: "min(900px, calc(100vw - 32px))", display: "flex", flexDirection: "column", padding: 0,
          overflow: "hidden", fontFamily: "var(--fontFamilyBase, 'Segoe UI', sans-serif)" }}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 text-sm font-semibold" style={{ borderColor: "var(--colorNeutralStroke2)" }}>
          <span>{t("target_formula.compare_sources")}</span>
          <Button appearance="subtle" size="small" icon={<Dismiss20Regular />} aria-label={t("target_formula.close")}
            onClick={() => setOpen(false)} />
        </div>
        <div className="min-h-0 overflow-auto overscroll-contain" style={{ maxHeight: "min(60dvh, 520px)", scrollbarGutter: "stable" }}>
          <table className="w-full table-fixed border-collapse text-left text-[13px] leading-5" style={{ minWidth: 600 }}>
            <colgroup>{[17, 11, 13, 11, 48].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
            <thead className="sticky top-0 z-10" style={{ background: "var(--colorNeutralBackground2)", color: "var(--colorNeutralForeground2)" }}><tr>
              {[t("target_formula.variable"), "EXIF", t("face_link_formula.parameter"), t("target_formula.difference"), t("face_link_formula.source")].map((label, index) => (
                <th key={label} className={`border-b px-3 py-2 font-medium ${index > 0 && index < 4 ? "text-right" : ""}`}
                  style={{ borderColor: "var(--colorNeutralStroke2)" }} scope="col">{label}</th>
              ))}
            </tr></thead>
            <tbody>{sources.map(({ name, exif, parameter }) => <tr key={name}>
              <th className="break-words border-b px-3 py-2 align-top font-normal" style={{ borderColor: "var(--colorNeutralStroke2)" }} scope="row">{name}</th>
              {[exif.value, parameter.value, parameter.value - exif.value].map((value, index) => <td key={index}
                className="border-b px-3 py-2 text-right align-top tabular-nums" style={{ borderColor: "var(--colorNeutralStroke2)",
                  color: index === 2 && Number.isFinite(value) && Math.abs(value) >= 0.05 ? "var(--colorBrandForeground1)" : undefined }}>
                {numberText(value)}
              </td>)}
              <td className="break-words border-b px-3 py-2 align-top text-[11px] leading-4" style={{ borderColor: "var(--colorNeutralStroke2)", color: "var(--colorNeutralForeground3)", overflowWrap: "anywhere" }}>
                {exif.source === parameter.source ? exif.source : <>
                  <div>EXIF: {exif.source.replace(/^EXIF\s*·\s*/, "")}</div>
                  <div>{t("face_link_formula.parameter")}: {parameter.source}</div>
                </>}
              </td>
            </tr>)}</tbody>
          </table>
          {details && <details className="px-4 py-3">
            <summary className="cursor-pointer text-xs font-medium" style={{ color: "var(--colorNeutralForeground2)" }}>{t("target_formula.expand_details")}</summary>
            <div className="mt-3 grid gap-3">{details}</div>
          </details>}
        </div>
      </PopoverSurface>
    </Popover>
  </div>;
}
