import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

interface Props {
  /** Tooltip body text. */
  content:        string;
  /** Wrapped element — must be a single React node. */
  children:       ReactNode;
  /** When supplied, the tooltip is shown only if the element referenced
   *  is being truncated (scrollWidth > clientWidth). Without it, the
   *  tooltip is shown unconditionally on hover. */
  truncatableRef?: RefObject<HTMLElement>;
  /** Anchor position. */
  positioning?:   "below-center" | "below-start" | "right-center";
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
 * The tooltip is portalled and fixed-positioned so it is not clipped by
 * scroll containers, resizable panels, or card overflow rules.
 */
export function HoverTooltip({
  content, children, truncatableRef,
  positioning = "below-center", wrap = false, maxWidth, inline = false,
}: Props) {
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const [themeStyle, setThemeStyle] = useState<CSSProperties>({});
  const wrapperRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const setWrapperNode = (node: HTMLElement | null) => {
    wrapperRef.current = node;
  };

  const viewportPadding = 8;
  const effectiveMaxWidth = Math.min(maxWidth ?? 360, window.innerWidth - viewportPadding * 2);

  const updatePosition = () => {
    const anchor = wrapperRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    const tipRect = tooltipRef.current?.getBoundingClientRect();
    const tipWidth = tipRect?.width ?? 0;
    const tipHeight = tipRect?.height ?? 0;
    const clampLeft = (left: number) =>
      Math.max(viewportPadding, Math.min(left, window.innerWidth - (tipWidth || effectiveMaxWidth) - viewportPadding));
    const clampTop = (top: number) =>
      Math.max(viewportPadding, Math.min(top, window.innerHeight - (tipHeight || 0) - viewportPadding));
    const commit = (next: { left: number; top: number }) => {
      setCoords((prev) => {
        if (prev && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.top - next.top) < 0.5) {
          return prev;
        }
        return next;
      });
    };

    if (positioning === "below-start") {
      commit({
        left: clampLeft(rect.left),
        top:  clampTop(rect.bottom + 6),
      });
      return;
    }
    if (positioning === "right-center") {
      commit({
        left: clampLeft(rect.right + 8),
        top:  clampTop(rect.top + rect.height / 2 - tipHeight / 2),
      });
      return;
    }
    commit({
      left: clampLeft(rect.left + rect.width / 2 - tipWidth / 2),
      top:  clampTop(rect.bottom + 6),
    });
  };

  const onEnter = () => {
    if (!content) return;
    if (truncatableRef) {
      const el = truncatableRef.current;
      if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    }
    const anchor = wrapperRef.current;
    if (anchor) {
      const styles = getComputedStyle(anchor);
      const isLight = document.documentElement.classList.contains("light");
      setThemeStyle({
        background:  styles.getPropertyValue("--colorNeutralBackground1").trim(),
        borderColor: styles.getPropertyValue("--colorNeutralStroke2").trim(),
        color:       styles.getPropertyValue("--colorNeutralForeground1").trim(),
        boxShadow:   isLight
          ? "0 8px 24px rgba(0,0,0,0.16)"
          : "0 8px 24px rgba(0,0,0,0.42)",
      });
    }
    setShow(true);
    requestAnimationFrame(updatePosition);
  };
  const onLeave = () => {
    setShow(false);
    setCoords(null);
  };

  useLayoutEffect(() => {
    if (!show) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, positioning, maxWidth]);

  useLayoutEffect(() => {
    if (!show || !coords || !tooltipRef.current) return;
    updatePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, coords]);

  const tip = show && content && coords ? createPortal(
    <span
      ref={tooltipRef}
      className="pointer-events-none fixed z-[9999] rounded-md border px-2 py-1 text-xs leading-5"
      style={{
        ...themeStyle,
        left:        coords.left,
        top:         coords.top,
        whiteSpace:  wrap ? "normal" : "nowrap",
        wordBreak:   wrap ? "break-all" : undefined,
        maxWidth:    effectiveMaxWidth,
      }}
    >
      {content}
    </span>,
    document.body,
  ) : null;

  if (inline) {
    return (
      <span ref={setWrapperNode}
            className="inline-flex"
            onMouseEnter={onEnter} onMouseLeave={onLeave}>
        {children}
        {tip}
      </span>
    );
  }
  return (
    <div ref={setWrapperNode}
         onMouseEnter={onEnter} onMouseLeave={onLeave}>
      {children}
      {tip}
    </div>
  );
}
