import type { Isp6sSchemaRoot } from "@/ipc/cppParser";

export type ColumnSettingsSchema = Pick<Isp6sSchemaRoot, "Image" | "image_table" | "preview_info">;
type Bootstrap = { mode: "isp6s" | "tone"; theme: string; schema: ColumnSettingsSchema; createdAt: number };

const BOOTSTRAP_KEY = "luxe:isp6s:column-settings-bootstrap";

export function prepareColumnSettingsBootstrap(mode: Bootstrap["mode"], schema: Isp6sSchemaRoot, theme: string) {
  const snapshot: Bootstrap = {
    mode,
    theme,
    schema: { Image: schema.Image, image_table: schema.image_table, preview_info: schema.preview_info },
    createdAt: Date.now(),
  };
  try { localStorage.setItem(BOOTSTRAP_KEY, JSON.stringify(snapshot)); } catch { /* The child falls back to IPC. */ }
}

export function consumeColumnSettingsBootstrap(mode: Bootstrap["mode"]): Bootstrap | null {
  try {
    const saved = localStorage.getItem(BOOTSTRAP_KEY);
    localStorage.removeItem(BOOTSTRAP_KEY);
    if (!saved) return null;
    const value: unknown = JSON.parse(saved);
    if (!value || typeof value !== "object") return null;
    const bootstrap = value as Partial<Bootstrap>;
    return bootstrap.mode === mode && typeof bootstrap.theme === "string"
      && typeof bootstrap.createdAt === "number" && Date.now() - bootstrap.createdAt < 30_000
      && bootstrap.schema && typeof bootstrap.schema.Image === "object"
      ? bootstrap as Bootstrap : null;
  } catch {
    return null;
  }
}
