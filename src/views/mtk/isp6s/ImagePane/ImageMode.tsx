import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ImageEntry } from "@/ipc/imageScan";

interface Props {
  entry: ImageEntry | undefined;
}

/**
 * Image preview mode — just renders the current jpg via Tauri's
 * `convertFileSrc` asset protocol. Auto-fits to container, preserves aspect.
 */
export function ImageMode({ entry }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) { setUrl(null); setErr(null); return; }
    try {
      setUrl(convertFileSrc(entry.jpg_path));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [entry?.jpg_path]);

  if (!entry) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--colorNeutralForeground3)" }}>
        请先选择图片文件夹
      </div>
    );
  }
  if (err) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--colorPaletteRedForeground1)" }}>
        加载图片失败：{err}
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
