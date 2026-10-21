import type { Isp6sSchemaRoot } from "@/ipc/cppParser";
import type { ImageTableKind } from "./imageTableClassification";

/** Missing sections retain legacy mappings; an empty section hides all extras. */
export function imageTableMapping(
  schema: Isp6sSchemaRoot,
  kind: "scene" | "portrait",
): Record<string, string> {
  return schema.image_table?.[kind] ?? schema.Image ?? {};
}

/** Column ids use TOML keys, matching the saved column order and sort controls. */
export function imageTableExtraColumns(
  schema: Isp6sSchemaRoot,
  kind?: ImageTableKind,
): [string, string][] {
  if (kind === "scene" || kind === "portrait") {
    return Object.entries(imageTableMapping(schema, kind));
  }
  const byKey = new Map<string, [string, string]>();
  for (const mapping of [imageTableMapping(schema, "portrait"), imageTableMapping(schema, "scene")]) {
    for (const [label, key] of Object.entries(mapping)) {
      if (!byKey.has(key)) byKey.set(key, [label, key]);
    }
  }
  return [...byKey.values()];
}

export function isImageTableColumnMapped(
  schema: Isp6sSchemaRoot,
  key: string,
  kind: ImageTableKind | undefined,
): boolean {
  return kind !== "scene" && kind !== "portrait"
    || Object.values(imageTableMapping(schema, kind)).includes(key);
}
