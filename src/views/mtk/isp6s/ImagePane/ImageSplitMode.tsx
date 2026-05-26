import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ImageEntry } from "@/ipc/imageScan";
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";

interface Props {
  entry:    ImageEntry | undefined;
  schema:   Isp6sSchemaRoot;
  tomlData: Record<string, string>;
}

/**
 * `image_split` mode — three-section stack:
 *   ① RGB histogram (canvas)
 *   ② image preview
 *   ③ info table from `[[preview_info.items]]`
 *
 * For M5d we ship a minimal but functional histogram (drawn directly from the
 * jpg's decoded canvas data) and the info table; sectioned splitter ratios
 * come in a later pass.
 */
export function ImageSplitMode({ entry, schema, tomlData }: Props) {
  const histRef = useRef<HTMLCanvasElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) { setUrl(null); return; }
    setUrl(convertFileSrc(entry.jpg_path));
  }, [entry?.jpg_path]);

  /* Draw histogram once the image loads. */
  useEffect(() => {
    if (!url || !histRef.current) return;
    const canvas = histRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Down-sample to ~192×192 for speed.
      const off = document.createElement("canvas");
      off.width = 192; off.height = 192;
      const offCtx = off.getContext("2d");
      if (!offCtx) return;
      offCtx.drawImage(img, 0, 0, off.width, off.height);
      const data = offCtx.getImageData(0, 0, off.width, off.height).data;
      const r = new Uint32Array(256);
      const g = new Uint32Array(256);
      const b = new Uint32Array(256);
      for (let i = 0; i < data.length; i += 4) {
        r[data[i]]++; g[data[i + 1]]++; b[data[i + 2]]++;
      }
      drawHist(canvas, r, g, b);
    };
    img.src = url;
  }, [url]);

  const items = schema.preview_info?.items ?? [];

  return (
    <div className="flex h-full w-full flex-col">
      {/* histogram */}
      <div className="shrink-0 px-3 py-2"
           style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
        <canvas ref={histRef} width={420} height={92}
                style={{ width: "100%", maxWidth: 420, height: 92, display: "block" }} />
      </div>

      {/* image preview */}
      <div className="min-h-0 flex-1 overflow-hidden flex items-center justify-center"
           style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
        {url
          ? <img src={url} alt={entry?.name ?? ""}
                 className="max-h-full max-w-full object-contain" draggable={false} />
          : <span className="text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>请先选择图片文件夹</span>}
      </div>

      {/* preview_info table */}
      <div className="max-h-[200px] shrink-0 overflow-auto">
        <table className="w-full text-xs"
               style={{ fontFamily: "ui-monospace, monospace" }}>
          <tbody>
            {(items as Array<{ label: string; toml_key: string }>).map((it, i) => (
              <tr key={`${it.label}-${i}`}
                  style={{ borderBottom: "1px solid var(--colorNeutralStroke3)" }}>
                <td className="px-3 py-1.5 font-semibold"
                    style={{ color: "var(--colorNeutralForeground2)", width: 120 }}>
                  {it.label}
                </td>
                <td className="px-3 py-1.5"
                    style={{ color: "var(--colorNeutralForeground1)" }}>
                  {tomlData[it.toml_key] ?? "—"}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td className="p-3 text-center text-xs"
                      style={{ color: "var(--colorNeutralForeground3)" }} colSpan={2}>
                Isp6s.toml 未配置 [[preview_info.items]]
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function drawHist(
  canvas: HTMLCanvasElement,
  r: Uint32Array, g: Uint32Array, b: Uint32Array,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  let max = 1;
  for (let i = 0; i < 256; i++) {
    if (r[i] > max) max = r[i];
    if (g[i] > max) max = g[i];
    if (b[i] > max) max = b[i];
  }
  ctx.globalCompositeOperation = "lighter";
  for (const [arr, color] of [
    [r, "rgba(232, 80, 80, 0.78)"],
    [g, "rgba( 80, 200, 80, 0.78)"],
    [b, "rgba( 80, 130, 230, 0.78)"],
  ] as const) {
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * (W - 1);
      const h = (arr[i] / max) * (H - 4);
      const y = H - h;
      if (i === 0) ctx.moveTo(x, H); else ctx.lineTo(x, y);
    }
    ctx.lineTo(W - 1, H);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}
