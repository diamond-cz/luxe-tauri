import { useEffect, useState } from "react";

export type ToastKind = "success" | "error" | "info";

interface Props {
  kind:     ToastKind;
  title:    string;
  detail?:  string;
  /** Auto-dismiss delay in ms. Default 3000. Set to 0 to disable. */
  duration?: number;
  onClose:  () => void;
}

/**
 * Lightweight self-dismissing toast. Floats at the top-right of the viewport
 * and fades out after `duration` ms. We render our own rather than wiring up
 * `@fluentui/react-toast` because there's no global Toaster mount point in
 * this app and we only need one tiny variant.
 */
export function Toast({ kind, title, detail, duration = 3000, onClose }: Props) {
  const [open, setOpen] = useState(false);

  /* Slide-in on mount. */
  useEffect(() => {
    const t = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(t);
  }, []);

  /* Auto-dismiss. */
  useEffect(() => {
    if (duration <= 0) return;
    const t = setTimeout(() => {
      setOpen(false);
      // Wait for fade-out to finish before unmounting upstream.
      setTimeout(onClose, 200);
    }, duration);
    return () => clearTimeout(t);
  }, [duration, onClose]);

  const palette = {
    success: {
      bg:     "var(--colorPaletteGreenBackground2)",
      border: "var(--colorPaletteGreenBorder2)",
      fg:     "var(--colorPaletteGreenForeground1)",
    },
    error: {
      bg:     "var(--colorPaletteRedBackground2)",
      border: "var(--colorPaletteRedBorder2)",
      fg:     "var(--colorPaletteRedForeground1)",
    },
    info: {
      bg:     "var(--colorNeutralBackground3)",
      border: "var(--colorNeutralStroke1)",
      fg:     "var(--colorNeutralForeground1)",
    },
  }[kind];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position:  "fixed",
        top:       72,
        right:     24,
        zIndex:    1000,
        minWidth:  280,
        maxWidth:  420,
        padding:   "10px 14px",
        background:  palette.bg,
        border:      "1px solid " + palette.border,
        borderRadius: 8,
        boxShadow:   "0 8px 24px rgba(0,0,0,0.2)",
        color:       palette.fg,
        transform:   open ? "translateX(0)" : "translateX(120%)",
        opacity:     open ? 1 : 0,
        transition:  "transform 200ms ease, opacity 200ms ease",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      <div className="text-sm font-semibold">{title}</div>
      {detail && (
        <div className="mt-0.5 text-xs" style={{ opacity: 0.85 }}>
          {detail}
        </div>
      )}
    </div>
  );
}
