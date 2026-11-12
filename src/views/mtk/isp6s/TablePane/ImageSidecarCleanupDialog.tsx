import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";

export function ImageSidecarCleanupDialog({ files, imageCount, deleting, onCancel, onConfirm }: {
  files: string[] | null;
  imageCount: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return <Dialog open={files !== null} onOpenChange={(_, data) => { if (!data.open && !deleting) onCancel(); }}>
    <DialogSurface>
      <DialogBody>
        <DialogTitle>{t("image_exif.cleanup.title")}</DialogTitle>
        <DialogContent>
          <p>{t("image_exif.cleanup.confirm", { count: files?.length ?? 0, images: imageCount })}</p>
          <pre className="my-3 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded border p-2 text-xs"
            style={{ borderColor: "var(--colorNeutralStroke2)", background: "var(--colorNeutralBackground2)" }}>{files?.join("\n")}</pre>
          <p>{t("image_exif.cleanup.warning")}</p>
        </DialogContent>
        <DialogActions>
          <Button disabled={deleting} onClick={onCancel}>{t("image_exif.cleanup.cancel")}</Button>
          <Button appearance="primary" disabled={deleting || !files?.length} onClick={onConfirm}>
            {t(deleting ? "image_exif.cleanup.deleting" : "image_exif.cleanup.delete")}
          </Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
