import type { ImageExifDocument, ImageExifModule, ImageExifTable, ImageTomlSection } from "@/types/ipc";

export const EXIF_MODULE_ORDER = [
  "AE", "AE_Table", "AF", "AWB", "Sensor", "Shading", "Strobe", "ISP",
  "MFNR", "N3D", "SWNR", "BMDN", "Common", "String", "Detail",
] as const;

export interface ExifTab {
  name: string;
  fields: ImageTomlSection["fields"];
}

const SECTION_MODULES: Record<string, string> = {
  AE_DISPLAY: "AE", SENSOR: "Sensor", SHADING: "Shading", STROBE: "Strobe",
  MF: "MFNR", CMN: "Common", COMMON: "Common", RESVA: "SWNR", RESVB: "BMDN", STRING: "String",
};

function sectionModule(name: string): string {
  const root = name.split(/[.\[]/, 1)[0];
  const upper = root.toUpperCase();
  return SECTION_MODULES[upper] ?? (upper.startsWith("ISP_") ? "ISP" : root);
}

/** Keep module tabs stable while filtering; put the compact AE summary inside AE. */
export function buildExifTabs(document: ImageExifDocument): ExifTab[] {
  const grouped = new Map<string, ExifTab>();
  const ensure = (name: string) => {
    let tab = grouped.get(name);
    if (!tab) { tab = { name, fields: [] }; grouped.set(name, tab); }
    return tab;
  };
  for (const section of document.sections) {
    if (section.name.startsWith("__luxe_exif") || section.name === "AE_Table" || section.name === "Detail") continue;
    if (section.fields.length === 0) continue;
    const name = sectionModule(section.name);
    const tab = ensure(name);
    for (const field of section.fields) {
      tab.fields.push({ ...field, key: section.name === name ? field.key : `${section.name}.${field.key}` });
    }
  }
  // Diagnostic-only matches (version_only/unsupported/empty) belong in Detail,
  // not in navigation: a matching .h is not evidence of readable module data.
  if (document.ae_tables.some(validExifTable)) ensure("AE_Table");
  ensure("Detail");
  const rank = (name: string) => {
    const index = (EXIF_MODULE_ORDER as readonly string[]).indexOf(name);
    return index < 0 ? EXIF_MODULE_ORDER.length - 1.5 : index;
  };
  return [...grouped.values()].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
}

export function exifSourceKey(source: ImageExifDocument["source"]): string {
  if (source.kind === "jpeg") return "image_exif.source.jpeg";
  if (source.content_mode === "metadata_only") return "image_exif.source.metadata_only";
  if (source.parser === "debug_parser") return "image_exif.source.debug_parser";
  if (source.parser === "native") return source.content_mode === "native_merge"
    ? "image_exif.source.native_merged" : "image_exif.source.native_toml";
  return "image_exif.source.unknown_toml";
}

export function matchesExifField(key: string, pattern: RegExp | null): boolean {
  // Grouping DP sections must not break saved expressions anchored to a tag.
  return !pattern || pattern.test(key) || pattern.test(key.slice(key.lastIndexOf(".") + 1));
}

export function matchesExifModule(module: ImageExifModule, pattern: RegExp | null): boolean {
  return !pattern || [module.module, module.header, module.status, module.version, module.signature,
    module.identity_source, module.parse_status, String(module.decoded_fields)].some((value) => value && pattern.test(value));
}

/** Invalid or oversized shapes must never render as a plausible statistics block. */
export function validExifTable(table: ImageExifTable): boolean {
  return Number.isInteger(table.rows) && Number.isInteger(table.columns)
    && table.rows > 0 && table.columns > 0 && table.rows <= 512 && table.columns <= 512
    && table.rows * table.columns <= 65_536 && table.values.length === table.rows * table.columns
    && table.values.every(Number.isFinite);
}

const STATISTICS_ORDER = [
  "5x5", "5x5_LE", "5x5_SE", "5x5_Y", "5x5_R", "5x5_G", "5x5_B", "5x5_OverCnt",
  "15x15_LE", "15x15_SE", "15x15 Y", "15x15 R", "15x15 G", "15x15 B", "15x15 OverCnt",
  "15x15_Y", "15x15_R", "15x15_G", "15x15_B", "15x15_OverCnt",
  "8_6_LE_Y", "8_6_LE_R", "8_6_LE_G", "8_6_LE_B",
  "Central_Y", "Full_Y", "Full_RGB", "LE_RGB_MAX", "LE_Y", "SE_Y", "HIST 0", "HIST 1", "HIST 2", "HIST 3",
];

/** TOML key ordering must not move a 15x15 block ahead of its 5x5 summary. */
export function orderedExifTables(tables: ImageExifTable[]): ImageExifTable[] {
  const rank = (name: string) => {
    const index = STATISTICS_ORDER.indexOf(name);
    return index < 0 ? STATISTICS_ORDER.length : index;
  };
  return tables.filter(validExifTable).sort((left, right) => rank(left.name) - rank(right.name) || left.name.localeCompare(right.name));
}

export function formatExifTable(table: ImageExifTable): string {
  if (!validExifTable(table)) return "";
  const width = table.values.reduce((width, value) => Math.max(width, String(value).length), 5);
  const lines = [];
  for (let row = 0; row < table.rows; row += 1) {
    lines.push(table.values.slice(row * table.columns, (row + 1) * table.columns)
      .map((value) => String(value).padStart(width, " ")).join(" "));
  }
  return lines.join("\n");
}
