import type { ImageEntry } from "@/ipc/imageScan";
import { useImagePreview } from "@/hooks/useImagePreviewUrl";

interface Props {
  entry: ImageEntry | undefined;
}

/**
 * Renders a bounded preview while preserving the image aspect ratio.
 */
export function ImageMode({ entry }: Props) {
  const { url, error } = useImagePreview(entry?.jpg_path);

  if (!entry) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--colorNeutralForeground3)" }}>
        请先选择图片文件夹
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--colorPaletteRedForeground1)" }}>
        加载图片失败
      </div>
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden">
      {url && (
        <img
          src={url}
          alt={entry.name}
          className="max-h-full max-w-full object-contain"
          style={{ display: "block" }}
          draggable={false}
        />
      )}
    </div>
  );
}
