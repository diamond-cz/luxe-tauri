import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Panel, PanelGroup } from "react-resizable-panels";
import type { ImageEntry } from "@/ipc/imageScan";
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";
import { ResizeHandle } from "@/components/common/ResizeHandle";

interface Props {
  entry:    ImageEntry | undefined;
  schema:   Isp6sSchemaRoot;
  tomlData: Record<string, string>;
}

/**
 * `image_split` mode: three horizontal sections from left to right:
 * histogram + image preview + preview info table.
 */
export function ImageSplitMode({ entry, schema, tomlData }: Props) {
  const histRef = useRef<HTMLCanvasElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) { setUrl(null); return; }
    setUrl(convertFileSrc(entry.jpg_path));
  }, [entry?.jpg_path]);

  useEffect(() => {
    if (!url || !histRef.current) return;
    const canvas = histRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const off = document.createElement("canvas");
      off.width = 192;
      off.height = 192;
      const offCtx = off.getContext("2d");
      if (!offCtx) return;
      offCtx.drawImage(img, 0, 0, off.width, off.height);
      const data = offCtx.getImageData(0, 0, off.width, off.height).data;
      const r = new Uint32Array(256);
      const g = new Uint32Array(256);
      const b = new Uint32Array(256);
      for (let i = 0; i < data.length; i += 4) {
        r[data[i]]++;
        g[data[i + 1]]++;
        b[data[i + 2]]++;
      }
      drawHist(canvas, r, g, b);
    };
    img.src = url;
  }, [url]);

  const items = schema.preview_info?.items ?? [];

  return (
    <PanelGroup direction="horizontal" autoSaveId="isp6s-image-split" className="h-full w-full">
      <Panel defaultSize={24} minSize={18}>
        <div className="flex h-full w-full items-center justify-center p-3">
          <canvas
            ref={histRef}
            width={320}
            height={220}
            style={{ width: "100%", height: "100%", display: "block" }}
          />
        </div>
      </Panel>

      <ResizeHandle direction="horizontal" size={8} />

      <Panel defaultSize={38} minSize={24}>
        <div className="flex h-full w-full items-center justify-center overflow-hidden p-3">
          {url
            ? <img src={url} alt={entry?.name ?? ""}
                   className="max-h-full max-w-full object-contain" draggable={false} />
            : <span className="text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>请先选择图片文件</span>}
        </div>
      </Panel>

      <ResizeHandle direction="horizontal" size={8} />

      <Panel defaultSize={38} minSize={24}>
        <div className="h-full w-full overflow-auto p-3">
          <table className="w-full text-xs"
                 style={{ fontFamily: "ui-monospace, monospace" }}>
            <tbody>
              {(items as Array<{ label: string; toml_key: string }>).map((it, i) => (
                <tr key={`${it.label}-${i}`}
                    style={{ borderBottom: "1px solid var(--colorNeutralStroke3)" }}>
                  <td className="px-3 py-1.5 align-top font-semibold"
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
      </Panel>
    </PanelGroup>
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
    [g, "rgba(80, 200, 80, 0.78)"],
    [b, "rgba(80, 130, 230, 0.78)"],
  ] as const) {
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * (W - 1);
      const h = (arr[i] / max) * (H - 4);
      const y = H - h;
      if (i === 0) ctx.moveTo(x, H);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(W - 1, H);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}
