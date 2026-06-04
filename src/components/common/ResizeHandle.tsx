import { useState } from "react";
import { PanelResizeHandle } from "react-resizable-panels";

interface Props {
  /**
   * Panel arrangement direction.
   *  - "horizontal" (default): panels sit side-by-side -> splitter is a vertical bar.
   *  - "vertical": panels stack top/bottom -> splitter is a horizontal bar.
   */
  direction?: "horizontal" | "vertical";
  /** Transparent grab-track size in px. */
  size?: number;
  /** Extra className on the outer handle. */
  className?: string;
  /** Keep the inner guide line visible even when not hovered. */
  alwaysVisible?: boolean;
}

/**
 * Unified resize-handle for `react-resizable-panels`. Renders a transparent
 * track; on hover/drag a 2px line in the current brand color appears so users
 * can see where they can grab. Used everywhere splitters live so the look is
 * consistent across the app.
 */
export function ResizeHandle({
  direction = "horizontal",
  size = 8,
  className,
  alwaysVisible = false,
}: Props) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);

  const isVertBar = direction === "horizontal";
  const active = alwaysVisible || hover || dragging;

  return (
    <PanelResizeHandle
      className={className}
      style={{
        background: "transparent",
        cursor: isVertBar ? "col-resize" : "row-resize",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: isVertBar ? size : undefined,
        height: isVertBar ? undefined : size,
      }}
      onDragging={setDragging}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        aria-hidden
        style={{
          width: isVertBar ? 2 : "100%",
          height: isVertBar ? "100%" : 2,
          background: active ? "var(--colorBrandStroke1)" : "transparent",
          transition: "background 120ms ease",
          borderRadius: 1,
        }}
      />
    </PanelResizeHandle>
  );
}
