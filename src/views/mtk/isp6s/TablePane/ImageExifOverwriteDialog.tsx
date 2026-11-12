import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";

/** DP is an explicit authoritative replacement, not the additive JPEG action. */
export function ImageExifOverwriteDialog({ imageDir, imageCount, onCancel, onConfirm }: {
  imageDir: string | null;
  imageCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return <Dialog open={imageDir !== null} onOpenChange={(_, data) => { if (!data.open) onCancel(); }}>
    <DialogSurface>
      <DialogBody>
        <DialogTitle>{t("image_exif.overwrite.title")}</DialogTitle>
        <DialogContent>
          <p>{t("image_exif.overwrite.confirm", { count: imageCount })}</p>
          <p className="my-3 break-all rounded border p-2 text-xs" style={{ borderColor: "var(--colorNeutralStroke2)",
            background: "var(--colorNeutralBackground2)" }}>{imageDir}</p>
          <p>{t("image_exif.overwrite.warning")}</p>
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancel}>{t("image_exif.overwrite.cancel")}</Button>
          <Button appearance="primary" disabled={!imageDir || !imageCount} onClick={onConfirm}>{t("image_exif.overwrite.run")}</Button>
        </DialogActions>
      </DialogBody>
    </DialogSurface>
  </Dialog>;
}
