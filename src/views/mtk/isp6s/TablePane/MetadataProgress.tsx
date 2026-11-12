import { ProgressBar } from "@fluentui/react-components";
import { DocumentData20Regular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import type { ExifParseProgress } from "@/ipc/imageScan";

/** Only completed image work is determinate; external DP exposes no percentage. */
export function MetadataProgress({ progress }: { progress: ExifParseProgress | null }) {
  const { t } = useTranslation();
  const stage = progress?.stage ?? "QUEUED";
  const counted = progress != null && progress.total > 0
    && stage !== "QUEUED" && stage !== "DP" && stage !== "REFRESH";
  const completed = progress ? Math.min(progress.total, Math.max(0, progress.completed)) : 0;
  const fraction = counted ? completed / progress.total : undefined;
  const label = t(`image_exif.stage.${stage}`);
  const counter = counted ? t("image_exif.progress_count", { completed, total: progress.total })
    : t("image_exif.progress_active");
  const accessibleLabel = counted ? t("image_exif.progress", { stage: label, completed, total: progress.total }) : label;
  return <div className="mx-3 my-2 flex shrink-0 items-center gap-3 rounded-lg border px-3 py-2"
    role="status" aria-live="polite" aria-atomic="true"
    style={{ color: "var(--colorNeutralForeground2)", background: "var(--colorNeutralBackground1)", borderColor: "var(--colorNeutralStroke2)" }}>
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" aria-hidden="true"
      style={{ color: "var(--colorBrandForeground1)", background: "var(--colorBrandBackground2)" }}>
      <DocumentData20Regular />
    </span>
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex min-w-0 items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-medium">{label}</span>
        <span className="shrink-0 tabular-nums" style={{ color: "var(--colorNeutralForeground3)" }}>{counter}</span>
      </div>
      <ProgressBar thickness="medium" value={fraction} aria-label={accessibleLabel} />
      {stage === "DP" && <div className="mt-1 text-[11px] leading-4" style={{ color: "var(--colorNeutralForeground3)" }}>
        {t("image_exif.progress_dp_hint")}
      </div>}
    </div>
  </div>;
}
