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

type HistogramData = {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
};

type HistogramPalette = {
  background: string;
  border: string;
  grid: string;
  label: string;
  red: string;
  redStroke: string;
  green: string;
  greenStroke: string;
  blue: string;
  blueStroke: string;
  composite: GlobalCompositeOperation;
};

const HISTOGRAM_EXACT_MAX_PIXELS = 16 * 1024 * 1024;
const HISTOGRAM_MAX_SAMPLE_EDGE = 1024;
const HISTOGRAM_MAX_SAMPLE_PIXELS = 1024 * 768;
const HISTOGRAM_TICKS = [0, 51, 102, 153, 204, 255] as const;

/**
 * `image_split` mode: three horizontal sections from left to right:
 * histogram + image preview + preview info table.
 */
export function ImageSplitMode({ entry, schema, tomlData }: Props) {
  const histRef = useRef<HTMLCanvasElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [histogram, setHistogram] = useState<HistogramData | null>(null);

  useEffect(() => {
    if (!entry) { setUrl(null); return; }
    setUrl(convertFileSrc(entry.jpg_path));
  }, [entry?.jpg_path]);

  useEffect(() => {
    let cancelled = false;
    setHistogram(null);
    if (!url) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const sample = getHistogramSampleSize(img);
      const off = document.createElement("canvas");
      off.width = sample.width;
      off.height = sample.height;
      const offCtx = off.getContext("2d");
      if (!offCtx) return;
      // Use exact pixels for normal captures; only downsample very large images.
      offCtx.imageSmoothingEnabled = sample.scale === 1 ? true : false;
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
      if (!cancelled) setHistogram({ r, g, b });
    };
    img.onerror = () => {
      if (!cancelled) setHistogram(null);
    };
    img.src = url;

    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    const canvas = histRef.current;
    if (!canvas) return;
    if (!histogram) {
      clearHist(canvas);
      return;
    }

    const draw = () => drawHist(canvas, histogram.r, histogram.g, histogram.b);
    draw();

    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    const themeObserver = new MutationObserver(draw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, [histogram]);

  const items = schema.preview_info?.items ?? [];

  return (
    <PanelGroup direction="horizontal" autoSaveId="isp6s-image-split" className="h-full w-full">
      <Panel defaultSize={24} minSize={18}>
        <div className="flex h-full w-full items-center justify-center p-3">
          <canvas
            ref={histRef}
            width={320}
            height={220}
            style={{ width: "100%", height: "100%", display: "block", background: "transparent" }}
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
  const surface = prepareHistogramCanvas(canvas);
  if (!surface) return;
  const { ctx, width, height } = surface;
  const palette = getHistogramPalette();

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);

  const plot = {
    left: 16,
    top: 10,
    right: Math.max(28, width - 6),
    bottom: Math.max(28, height - 18),
  };
  const plotWidth = Math.max(1, plot.right - plot.left);
  const plotHeight = Math.max(1, plot.bottom - plot.top);
  const model = buildHistogramModel(r, g, b);

  ctx.globalCompositeOperation = palette.composite;
  drawHistogramChannel(ctx, model.b, palette.blue, palette.blueStroke, plot, plotWidth, plotHeight, model.value);
  drawHistogramChannel(ctx, model.g, palette.green, palette.greenStroke, plot, plotWidth, plotHeight, model.value);
  drawHistogramChannel(ctx, model.r, palette.red, palette.redStroke, plot, plotWidth, plotHeight, model.value);
  ctx.globalCompositeOperation = "source-over";

  drawHistogramGrid(ctx, palette, plot, plotWidth, plotHeight);
  drawHistogramLabels(ctx, palette, plot, plotWidth, height);
}

function clearHist(canvas: HTMLCanvasElement) {
  const surface = prepareHistogramCanvas(canvas);
  if (!surface) return;
  const palette = getHistogramPalette();
  surface.ctx.clearRect(0, 0, surface.width, surface.height);
  surface.ctx.fillStyle = palette.background;
  surface.ctx.fillRect(0, 0, surface.width, surface.height);
}

function prepareHistogramCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(260, Math.floor(rect.width || canvas.clientWidth || canvas.width));
  const height = Math.max(160, Math.floor(rect.height || canvas.clientHeight || canvas.height));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const nextWidth = Math.floor(width * dpr);
  const nextHeight = Math.floor(height * dpr);
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function getHistogramSampleSize(img: HTMLImageElement) {
  const width = Math.max(1, img.naturalWidth || img.width);
  const height = Math.max(1, img.naturalHeight || img.height);
  if (width * height <= HISTOGRAM_EXACT_MAX_PIXELS) {
    return { width, height, scale: 1 };
  }
  const edgeScale = Math.min(1, HISTOGRAM_MAX_SAMPLE_EDGE / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(HISTOGRAM_MAX_SAMPLE_PIXELS / (width * height)));
  const scale = Math.min(edgeScale, pixelScale);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function buildHistogramModel(r: Uint32Array, g: Uint32Array, b: Uint32Array) {
  const channels = {
    r: toHistogramFloatChannel(r),
    g: toHistogramFloatChannel(g),
    b: toHistogramFloatChannel(b),
  };
  let max = 1;
  for (const channel of [channels.r, channels.g, channels.b]) {
    for (const value of channel) {
      if (value > max) max = value;
    }
  }
  return {
    ...channels,
    value: (raw: number) => raw / max,
  };
}

function toHistogramFloatChannel(channel: Uint32Array) {
  const out = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    out[i] = channel[i];
  }
  return out;
}

function drawHistogramChannel(
  ctx: CanvasRenderingContext2D,
  channel: Float32Array,
  fill: string,
  stroke: string,
  plot: { left: number; top: number; right: number; bottom: number },
  plotWidth: number,
  plotHeight: number,
  scaleValue: (raw: number) => number,
) {
  ctx.beginPath();
  ctx.moveTo(plot.left, plot.bottom);
  for (let i = 0; i < 256; i++) {
    const x = plot.left + (i / 255) * plotWidth;
    const y = plot.bottom - scaleValue(channel[i]) * plotHeight;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(plot.right, plot.bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < 256; i++) {
    const x = plot.left + (i / 255) * plotWidth;
    const y = plot.bottom - scaleValue(channel[i]) * plotHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.1;
  ctx.stroke();
}

function drawHistogramGrid(
  ctx: CanvasRenderingContext2D,
  palette: HistogramPalette,
  plot: { left: number; top: number; right: number; bottom: number },
  plotWidth: number,
  plotHeight: number,
) {
  ctx.save();
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  ctx.setLineDash([1, 2]);
  for (let i = 1; i < 4; i++) {
    const y = plot.top + (plotHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
  }
  for (const tick of HISTOGRAM_TICKS.slice(1, -1)) {
    const x = plot.left + (tick / 255) * plotWidth;
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.bottom);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1.2;
  ctx.strokeRect(plot.left, plot.top, plotWidth, plotHeight);
  ctx.restore();
}

function drawHistogramLabels(
  ctx: CanvasRenderingContext2D,
  palette: HistogramPalette,
  plot: { left: number; top: number; right: number; bottom: number },
  plotWidth: number,
  height: number,
) {
  ctx.fillStyle = palette.label;
  ctx.font = "10px 'Segoe UI', sans-serif";
  ctx.textBaseline = "bottom";
  for (const tick of HISTOGRAM_TICKS) {
    const x = plot.left + (tick / 255) * plotWidth;
    ctx.textAlign = tick === 0 ? "left" : tick === 255 ? "right" : "center";
    ctx.fillText(String(tick), x, height - 2);
  }
}

function getHistogramPalette(): HistogramPalette {
  const dark = document.documentElement.classList.contains("dark");
  if (dark) {
    return {
      background: "#17151E",
      border: "rgba(245, 242, 255, 0.78)",
      grid: "rgba(245, 242, 255, 0.28)",
      label: "rgba(245, 242, 255, 0.82)",
      red: "rgba(255, 79, 92, 0.58)",
      redStroke: "rgba(255, 106, 116, 0.95)",
      green: "rgba(68, 214, 92, 0.52)",
      greenStroke: "rgba(93, 236, 116, 0.92)",
      blue: "rgba(78, 99, 255, 0.64)",
      blueStroke: "rgba(116, 137, 255, 0.95)",
      composite: "screen",
    };
  }
  return {
    background: "#FFFFFF",
    border: "rgba(0, 0, 0, 0.88)",
    grid: "rgba(0, 0, 0, 0.42)",
    label: "rgba(0, 0, 0, 0.9)",
    red: "rgba(245, 67, 76, 0.58)",
    redStroke: "rgba(232, 49, 59, 0.95)",
    green: "rgba(46, 174, 70, 0.52)",
    greenStroke: "rgba(32, 149, 52, 0.95)",
    blue: "rgba(51, 70, 224, 0.66)",
    blueStroke: "rgba(34, 54, 205, 0.95)",
    composite: "multiply",
  };
}
