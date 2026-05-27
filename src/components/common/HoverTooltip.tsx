import { useState, type ReactNode, type RefObject } from "react";

interface Props {
  /** Tooltip body text. */
  content:        string;
  /** Wrapped element — must be a single React node. */
  children:       ReactNode;
  /** When supplied, the tooltip is shown only if the element referenced
   *  is being truncated (scrollWidth > clientWidth). Without it, the
   *  tooltip is shown unconditionally on hover. */
  truncatableRef?: RefObject<HTMLElement>;
  /** Anchor position. "below-center" aligns the tooltip's horizontal mid
   *  to the wrapper's mid (suits buttons); "below-start" aligns its left
   *  edge to the wrapper's left edge (suits paths). */
  positioning?:   "below-center" | "below-start";
  /** Allow wrapping for long content (e.g. paths). When false, content
   *  is kept on one line via `white-space: nowrap`. */
  wrap?:          boolean;
  /** Optional max width in px when `wrap` is true. */
  maxWidth?:      number;
  /** When true, wraps with an inline-flex span (suits buttons inside a
   *  flex row); when false (default), uses a block div (suits text in a
   *  column flex). */
  inline?:        boolean;
}

/**
 * Lightweight hover tooltip that follows the app's CSS theme variables.
 * Replaces fluentui's Tooltip in cases where its portal renderer misbehaves.
 *
 * The wrapper element is `relative`; the tooltip is `absolute` so it doesn't
 * shift layout. `pointer-events-none` keeps the tooltip from intercepting
 * mouse events meant for sibling controls.
 */
export function HoverTooltip({
  content, children, truncatableRef,
  positioning = "below-center", wrap = false, maxWidth, inline = false,
}: Props) {
  const [show, setShow] = useState(false);

  const onEnter = () => {
    if (truncatableRef) {
      const el = truncatableRef.current;
      if (el && el.scrollWidth > el.clientWidth) setShow(true);
    } else {
      setShow(true);
    }
  };
  const onLeave = () => setShow(false);

  const posClass = positioning === "below-start"
    ? "left-0 top-full"
    : "left-1/2 top-full -translate-x-1/2";

  const tip = show && content ? (
    <span
      className={`pointer-events-none absolute z-50 mt-1 rounded-md border px-2 py-1 text-xs ${posClass}`}
      style={{
        background:  "var(--colorNeutralBackground1)",
        borderColor: "var(--colorNeutralStroke2)",
        color:       "var(--colorNeutralForeground1)",
        boxShadow:   "0 4px 12px rgba(0,0,0,0.3)",
        whiteSpace:  wrap ? "normal" : "nowrap",
        wordBreak:   wrap ? "break-all" : undefined,
        maxWidth:    maxWidth ?? undefined,
      }}
    >
      {content}
    </span>
  ) : null;

  if (inline) {
    return (
      <span className="relative inline-flex"
            onMouseEnter={onEnter} onMouseLeave={onLeave}>
        {children}
        {tip}
      </span>
    );
  }
  return (
    <div className="relative"
         onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {children}
      {tip}
    </div>
  );
}
