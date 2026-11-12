import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge, Label, Select } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import type { ImageExifDocument, ImageExifModule, ImageExifTable } from "@/types/ipc";
import { exifSourceKey, formatExifTable, orderedExifTables } from "./exifPresentation";

const DETAIL_COLUMNS = "90px minmax(180px, 1.5fr) 130px 120px 120px minmax(140px, 1fr)";

export function ExifSource({ document }: { document: ImageExifDocument }) {
  const { t } = useTranslation();
  return <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-2 py-2 text-xs"
    style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground2)" }}>
    <Badge appearance="tint" color={document.source.kind === "jpeg" ? "brand" : "informative"}
      title={document.source.path} tabIndex={0} data-tooltip-position="below-start" data-tooltip-wrap="true"
      data-tooltip-max-width={640}>
      {t(exifSourceKey(document.source))}
    </Badge>
    {document.needs_fallback && <Badge className="ml-auto" appearance="outline" color="warning">{t("image_exif.detail.partial")}</Badge>}
  </div>;
}

export function ExifDetail({ modules }: { modules: ImageExifModule[] }) {
  const { t } = useTranslation();
  const headers = ["module", "header", "status", "version", "signature", "parsed"];
  return <div className="min-h-0 flex-1 overflow-auto" data-isp6s-details-scroll="true">
    <table className="w-full border-collapse text-left text-xs" style={{ minWidth: 800 }} aria-label={t("image_exif.detail.table")}>
      <thead className="sticky top-0 z-10" style={{ background: "var(--colorNeutralBackground3)" }}>
        <tr className="grid" style={{ gridTemplateColumns: DETAIL_COLUMNS }}>
          {headers.map((header) => <th key={header} className="px-2 py-2 font-semibold">{t(`image_exif.detail.${header}`)}</th>)}
        </tr>
      </thead>
      <tbody>
        {modules.map((module, index) => <tr key={`${index}:${module.module}`} className="grid items-center border-b"
          style={{ gridTemplateColumns: DETAIL_COLUMNS, borderColor: "var(--colorNeutralStroke2)",
            background: index % 2 ? "var(--colorNeutralBackground2)" : "var(--colorNeutralBackground1)" }}>
          <td className="px-2 py-2 font-mono">{module.module}</td>
          <td className="break-all px-2 py-2 font-mono">{module.header ?? "—"}</td>
          <td className="px-2 py-2"><Badge size="small" appearance="tint"
            color={module.status === "matched" ? "success" : module.status === "unrecorded" ? "subtle" : "warning"}>
            {t(`image_exif.match.${module.status}`)}
          </Badge></td>
          <td className="px-2 py-2 font-mono">{module.version ?? "—"}</td>
          <td className="px-2 py-2 font-mono">{module.signature ?? "—"}</td>
          <td className="px-2 py-2">{module.parse_status === "decoded"
            ? t("image_exif.detail.field_count", { count: module.decoded_fields })
            : t(`image_exif.parse.${module.parse_status}`)}</td>
        </tr>)}
      </tbody>
    </table>
    {modules.length === 0 && <p className="p-3 text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>{t("image_exif.no_match")}</p>}
  </div>;
}

export function ExifAeTables({ tables, pattern }: { tables: ImageExifTable[]; pattern: RegExp | null }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState("");
  const id = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const available = useMemo(() => orderedExifTables(tables), [tables]);
  const selection = available.some((table) => table.name === selected) ? selected : "";
  const visible = available.filter((table) => (!selection || selection === table.name) && (!pattern || pattern.test(table.name)));
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scroll = (event: WheelEvent) => {
      if (!event.shiftKey || event.deltaY === 0 || viewport.scrollWidth <= viewport.clientWidth) return;
      const before = viewport.scrollLeft;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
      viewport.scrollLeft += event.deltaY * scale;
      if (viewport.scrollLeft !== before) event.preventDefault();
    };
    viewport.addEventListener("wheel", scroll, { passive: false });
    return () => viewport.removeEventListener("wheel", scroll);
  }, []);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-2 text-xs"
      style={{ borderColor: "var(--colorNeutralStroke2)" }}>
      <Label htmlFor={id}>{t("image_exif.ae_table.block")}</Label>
      <Select id={id} size="small" value={selection}
        onChange={(event) => setSelected(event.target.value)}>
        <option value="">{t("image_exif.ae_table.all")}</option>
        {available.map((table) => <option key={table.name} value={table.name}>{table.name}</option>)}
      </Select>
      <span className="ml-auto" style={{ color: "var(--colorNeutralForeground3)" }}>{t("image_exif.ae_table.scroll_hint")}</span>
    </div>
    <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto p-3" data-isp6s-details-scroll="true" tabIndex={0}
      role="region" aria-label={t("image_exif.ae_table.region")}>
      {visible.length ? visible.map((table) => <section key={table.name} className="mb-5 w-max min-w-full">
        <h4 className="mb-1 font-mono text-xs font-semibold" style={{ color: "var(--colorBrandForeground1)" }}>{`<<${table.name}>>`}</h4>
        <pre className="select-text font-mono text-xs leading-5" style={{ color: "var(--colorNeutralForeground1)" }}>{formatExifTable(table)}</pre>
      </section>) : <p className="text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>
        {t(available.length ? "image_exif.no_match" : "image_exif.ae_table.empty")}
      </p>}
    </div>
  </div>;
}
