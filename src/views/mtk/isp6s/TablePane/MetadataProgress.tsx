import { ProgressBar } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import type { ExifParseProgress } from "@/ipc/imageScan";

/** Indeterminate only while queued; all numeric progress comes from real work. */
export function MetadataProgress({ progress }: { progress: ExifParseProgress | null }) {
  const { t } = useTranslation();
  const fraction = progress && progress.total > 0 ? Math.min(1, Math.max(0, progress.completed / progress.total)) : undefined;
  const label = progress ? t("image_exif.progress", { ...progress, stage: t(`image_exif.stage.${progress.stage}`) })
    : t("image_exif.reading");
  return <div className="flex min-h-7 shrink-0 items-center gap-3 px-2 text-xs" role="status"
    style={{ color: "var(--colorNeutralForeground2)", background: "var(--colorNeutralBackground2)" }}>
    <span className="shrink-0">{label}</span>
    <ProgressBar className="min-w-0 flex-1" value={fraction} aria-label={label} />
  </div>;
}
