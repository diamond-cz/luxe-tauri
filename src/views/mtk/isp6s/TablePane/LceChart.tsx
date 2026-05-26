import { useEffect, useRef } from "react";

interface Props {
  /** Eight `SW_LCE_P{n}` values. */
  pSeries: number[];
  /** Eight `SW_LCE_O{n}` values. */
  oSeries: number[];
}

const LABELS = ["0", "1", "50", "250", "500", "750", "950", "999"] as const;
const W_PAD  = 32;
const H_PAD  = 22;

/**
 * Mirrors hiz `_LCEChartView`: line chart of LCE_P vs LCE_O across 8 fixed
 * label buckets. We draw with raw canvas (no chart lib) since this is the
 * only chart the visualizer needs.
 */
export function LceChart({ pSeries, oSeries }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    draw(canvas, pSeries, oSeries);
  }, [pSeries, oSeries]);

  /* Re-draw on container resize. */
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      canvas.width  = Math.max(50, Math.floor(r.width));
      canvas.height = Math.max(80, Math.floor(r.height));
      draw(canvas, pSeries, oSeries);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [pSeries, oSeries]);

  return (
    <div className="h-full w-full">
      <canvas ref={ref}
              style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

function draw(canvas: HTMLCanvasElement, p: number[], o: number[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const all = [...p, ...o].filter(Number.isFinite);
  const max = all.length ? Math.max(...all, 1) : 1;
  const min = all.length ? Math.min(...all, 0) : 0;

  const cw = W - W_PAD * 2;
  const ch = H - H_PAD * 2;
  if (cw <= 0 || ch <= 0) return;

  // y grid + axis labels.
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth   = 1;
  ctx.font        = "10px ui-monospace, monospace";
  ctx.fillStyle   = "rgba(180,180,200,0.8)";
  for (let i = 0; i <= 4; i++) {
    const y = H_PAD + (ch * i) / 4;
    ctx.beginPath();
    ctx.moveTo(W_PAD,       y);
    ctx.lineTo(W - W_PAD,   y);
    ctx.stroke();
    const v = max - ((max - min) * i) / 4;
    ctx.fillText(v.toFixed(0).padStart(4), 2, y + 3);
  }

  // x labels.
  const n = LABELS.length;
  for (let i = 0; i < n; i++) {
    const x = W_PAD + (cw * i) / (n - 1);
    ctx.fillText(LABELS[i], x - 8, H - 4);
  }

  const series = (data: number[], color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.fillStyle   = color;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = data[i];
      if (!Number.isFinite(v)) continue;
      const x = W_PAD + (cw * i) / (n - 1);
      const y = H_PAD + ch - ((v - min) / (max - min || 1)) * ch;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else            ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      const v = data[i];
      if (!Number.isFinite(v)) continue;
      const x = W_PAD + (cw * i) / (n - 1);
      const y = H_PAD + ch - ((v - min) / (max - min || 1)) * ch;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  series(p, "#9558C1"); // LCE_P  (brand purple)
  series(o, "#2D7BF4"); // LCE_O  (blue)

  // legend.
  ctx.fillStyle = "#9558C1";
  ctx.fillRect(W_PAD + 8,  H_PAD - 14, 10, 3);
  ctx.fillStyle = "rgba(220,220,235,0.85)";
  ctx.fillText("LCE_P", W_PAD + 22, H_PAD - 9);
  ctx.fillStyle = "#2D7BF4";
  ctx.fillRect(W_PAD + 70, H_PAD - 14, 10, 3);
  ctx.fillStyle = "rgba(220,220,235,0.85)";
  ctx.fillText("LCE_O", W_PAD + 84, H_PAD - 9);
}
