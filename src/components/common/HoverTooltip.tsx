import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

type TooltipPositioning = "below-center" | "below-start" | "above-center" | "right-center";
type TooltipPlacement = "below" | "above" | "right";

interface Props {
  content: string;
  children: ReactNode;
  truncatableRef?: RefObject<HTMLElement>;
  positioning?: TooltipPositioning;
  wrap?: boolean;
  maxWidth?: number;
  inline?: boolean;
}

interface TooltipCoords {
  left: number;
  top: number;
  arrowLeft?: number;
  arrowTop?: number;
  placement: TooltipPlacement;
}

interface TooltipTheme {
  background: string;
  borderColor: string;
  color: string;
  boxShadow: string;
}

const TOOLTIP_VIEWPORT_PADDING = 8;
const TOOLTIP_OFFSET = 8;
const TOOLTIP_ARROW_OUTER_SIZE = 7;
const TOOLTIP_ARROW_INNER_SIZE = 6;
const GLOBAL_TITLE_ATTR = "data-luxe-tooltip-title";

export function HoverTooltip({
  content,
  children,
  truncatableRef,
  positioning = "below-center",
  wrap = false,
  maxWidth,
  inline = false,
}: Props) {
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState<TooltipCoords | null>(null);
  const [theme, setTheme] = useState<TooltipTheme>(fallbackTooltipTheme());
  const wrapperRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const effectiveMaxWidth = effectiveTooltipMaxWidth(maxWidth);

  const setWrapperNode = (node: HTMLElement | null) => {
    wrapperRef.current = node;
  };

  const updatePosition = useCallback(() => {
    const anchor = wrapperRef.current;
    if (!anchor) return;
    const next = measureTooltip(anchor, tooltipRef.current, positioning, effectiveMaxWidth);
    setCoords((current) => sameTooltipCoords(current, next) ? current : next);
  }, [effectiveMaxWidth, positioning]);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback((relatedTarget: EventTarget | null) => {
    const next = relatedTarget instanceof Node ? relatedTarget : null;
    if (next && (wrapperRef.current?.contains(next) || tooltipRef.current?.contains(next))) return;
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      setShow(false);
      setCoords(null);
      closeTimerRef.current = null;
    }, 80);
  }, [clearCloseTimer]);

  const onEnter = () => {
    clearCloseTimer();
    if (!content) return;
    if (truncatableRef) {
      const el = truncatableRef.current;
      if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    }
    if (wrapperRef.current) setTheme(readTooltipTheme(wrapperRef.current));
    setShow(true);
    window.requestAnimationFrame(updatePosition);
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
  }, [show, updatePosition]);

  useLayoutEffect(() => {
    if (!show || !coords || !tooltipRef.current) return;
    updatePosition();
  }, [show, coords, updatePosition]);

  useLayoutEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  const tip = show && content && coords ? (
    <TooltipPortal
      refNode={tooltipRef}
      content={content}
      coords={coords}
      theme={theme}
      wrap={wrap}
      maxWidth={effectiveMaxWidth}
      onMouseEnter={onEnter}
      onMouseLeave={(event) => scheduleClose(event.relatedTarget)}
    />
  ) : null;

  const Wrapper = inline ? "span" : "div";
  const wrapperClassName = inline ? "inline-flex" : undefined;

  return (
    <Wrapper
      ref={setWrapperNode}
      className={wrapperClassName}
      data-tooltip-disabled="true"
      onMouseEnter={onEnter}
      onMouseLeave={(event) => scheduleClose(event.relatedTarget)}
    >
      {children}
      {tip}
    </Wrapper>
  );
}

export function GlobalTitleTooltip() {
  const [state, setState] = useState<{
    anchor: HTMLElement;
    content: string;
    positioning: TooltipPositioning;
    wrap: boolean;
    maxWidth?: number;
    theme: TooltipTheme;
  } | null>(null);
  const [coords, setCoords] = useState<TooltipCoords | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const activeAnchorRef = useRef<HTMLElement | null>(null);
  const stateRef = useRef<typeof state>(null);
  const coordsRef = useRef<typeof coords>(null);
  const adjustedRenderedTooltipRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);

  stateRef.current = state;
  coordsRef.current = coords;

  const restoreActiveAnchorTitle = useCallback(() => {
    const anchor = activeAnchorRef.current;
    if (anchor?.isConnected) restoreNativeTitle(anchor);
    activeAnchorRef.current = null;
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const closeTooltip = useCallback(() => {
    closeTimerRef.current = null;
    if (!activeAnchorRef.current && stateRef.current === null && coordsRef.current === null) return;
    activeAnchorRef.current = null;
    stateRef.current = null;
    coordsRef.current = null;
    adjustedRenderedTooltipRef.current = false;
    setState((current) => current === null ? current : null);
    setCoords((current) => current === null ? current : null);
  }, []);

  const scheduleCloseTooltip = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(closeTooltip, 0);
  }, [clearCloseTimer, closeTooltip]);

  const updatePosition = useCallback(() => {
    const current = stateRef.current;
    if (!current?.anchor?.isConnected) return;
    const next = measureTooltip(
      current.anchor,
      tooltipRef.current,
      current.positioning,
      effectiveTooltipMaxWidth(current.maxWidth),
    );
    setCoords((current) => sameTooltipCoords(current, next) ? current : next);
  }, []);

  useEffect(() => {
    const openFromTarget = (target: EventTarget | null) => {
      const anchor = findTitleAnchor(target);
      if (!anchor) {
        return;
      }

      const content = moveNativeTitleToData(anchor);
      if (!content) {
        return;
      }

      clearCloseTimer();
      activeAnchorRef.current = anchor;
      const positioning = readGlobalTooltipPositioning(anchor);
      const wrap = anchor.getAttribute("data-tooltip-wrap") === "true";
      const maxWidth = readGlobalTooltipMaxWidth(anchor);
      setState((current) => {
        if (
          current?.anchor === anchor &&
          current.content === content &&
          current.positioning === positioning &&
          current.wrap === wrap &&
          current.maxWidth === maxWidth
        ) {
          return current;
        }
        adjustedRenderedTooltipRef.current = false;
        return {
          anchor,
          content,
          positioning,
          wrap,
          maxWidth,
          theme: readTooltipTheme(anchor),
        };
      });
    };

    const onPointerOver = (event: PointerEvent) => {
      openFromTarget(event.target);
    };
    const onPointerOut = (event: PointerEvent) => {
      const active = activeAnchorRef.current;
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (active && next && active.contains(next)) return;
      scheduleCloseTooltip();
    };
    const onFocusIn = (event: FocusEvent) => {
      openFromTarget(event.target);
    };
    const onFocusOut = () => {
      scheduleCloseTooltip();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeTooltip();
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("keydown", onKeyDown, true);
      clearCloseTimer();
      restoreActiveAnchorTitle();
    };
  }, [clearCloseTimer, closeTooltip, restoreActiveAnchorTitle, scheduleCloseTooltip]);

  useEffect(() => {
    if (!state) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [state, updatePosition]);

  useEffect(() => {
    if (!state || !coords || !tooltipRef.current || adjustedRenderedTooltipRef.current) return;
    adjustedRenderedTooltipRef.current = true;
    updatePosition();
  }, [state, coords, updatePosition]);

  if (!state || !coords) return null;
  return (
    <TooltipPortal
      refNode={tooltipRef}
      content={state.content}
      coords={coords}
      theme={state.theme}
      wrap={state.wrap}
      maxWidth={effectiveTooltipMaxWidth(state.maxWidth)}
      pointerEvents="none"
    />
  );
}

function TooltipPortal({
  refNode,
  content,
  coords,
  theme,
  wrap,
  maxWidth,
  pointerEvents,
  onMouseEnter,
  onMouseLeave,
}: {
  refNode: RefObject<HTMLSpanElement>;
  content: string;
  coords: TooltipCoords;
  theme: TooltipTheme;
  wrap: boolean;
  maxWidth: number;
  pointerEvents?: CSSProperties["pointerEvents"];
  onMouseEnter?: () => void;
  onMouseLeave?: React.MouseEventHandler<HTMLSpanElement>;
}) {
  const arrow = tooltipArrowStyles(coords, theme);
  return createPortal(
    <span
      ref={refNode}
      className="fixed z-[9999] rounded-md border px-2 py-1 text-[11px] leading-4"
      style={{
        ...tooltipSurfaceStyle(theme),
        left: coords.left,
        top: coords.top,
        whiteSpace: wrap ? "pre-wrap" : "nowrap",
        wordBreak: wrap ? "break-word" : undefined,
        maxWidth,
        pointerEvents,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span style={arrow.outer} />
      <span style={arrow.inner} />
      {content}
    </span>,
    document.body,
  );
}

function measureTooltip(
  anchor: HTMLElement,
  tooltip: HTMLElement | null,
  positioning: TooltipPositioning,
  maxWidth: number,
): TooltipCoords {
  const rect = anchor.getBoundingClientRect();
  const tipRect = tooltip?.getBoundingClientRect();
  const tipWidth = tipRect?.width || maxWidth;
  const tipHeight = tipRect?.height || 28;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const clampLeft = (left: number) =>
    Math.max(TOOLTIP_VIEWPORT_PADDING, Math.min(left, viewportWidth - tipWidth - TOOLTIP_VIEWPORT_PADDING));
  const clampTop = (top: number) =>
    Math.max(TOOLTIP_VIEWPORT_PADDING, Math.min(top, viewportHeight - tipHeight - TOOLTIP_VIEWPORT_PADDING));
  const anchorCenterX = rect.left + rect.width / 2;
  const anchorCenterY = rect.top + rect.height / 2;

  if (positioning === "right-center") {
    const left = clampLeft(rect.right + TOOLTIP_OFFSET);
    const top = clampTop(anchorCenterY - tipHeight / 2);
    return {
      left,
      top,
      arrowTop: clampNumber(anchorCenterY - top, 10, tipHeight - 10),
      placement: "right",
    };
  }

  if (positioning === "below-start") {
    const left = clampLeft(rect.left);
    const top = clampTop(rect.bottom + TOOLTIP_OFFSET);
    return {
      left,
      top,
      arrowLeft: clampNumber(Math.min(anchorCenterX, rect.left + 18) - left, 12, tipWidth - 12),
      placement: "below",
    };
  }

  if (positioning === "above-center") {
    const left = clampLeft(anchorCenterX - tipWidth / 2);
    const top = clampTop(rect.top - tipHeight - TOOLTIP_OFFSET);
    return {
      left,
      top,
      arrowLeft: clampNumber(anchorCenterX - left, 12, tipWidth - 12),
      placement: "above",
    };
  }

  const left = clampLeft(anchorCenterX - tipWidth / 2);
  const top = clampTop(rect.bottom + TOOLTIP_OFFSET);
  return {
    left,
    top,
    arrowLeft: clampNumber(anchorCenterX - left, 12, tipWidth - 12),
    placement: "below",
  };
}

function sameTooltipCoords(current: TooltipCoords | null, next: TooltipCoords): boolean {
  if (!current) return false;
  return current.placement === next.placement &&
    nearlyEqual(current.left, next.left) &&
    nearlyEqual(current.top, next.top) &&
    nearlyEqual(current.arrowLeft, next.arrowLeft) &&
    nearlyEqual(current.arrowTop, next.arrowTop);
}

function nearlyEqual(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Math.abs(a - b) < 0.5;
}

function tooltipSurfaceStyle(theme: TooltipTheme): CSSProperties {
  return {
    background: theme.background,
    borderColor: theme.borderColor,
    color: theme.color,
    boxShadow: theme.boxShadow,
    backdropFilter: "blur(10px)",
    borderRadius: 7,
  };
}

function tooltipArrowStyles(coords: TooltipCoords, theme: TooltipTheme): { outer: CSSProperties; inner: CSSProperties } {
  if (coords.placement === "right") {
    const outerTop = (coords.arrowTop ?? 14) - TOOLTIP_ARROW_OUTER_SIZE;
    const innerTop = (coords.arrowTop ?? 14) - TOOLTIP_ARROW_INNER_SIZE;
    return {
      outer: {
        ...tooltipTriangleBaseStyle,
        left: -TOOLTIP_ARROW_OUTER_SIZE,
        top: outerTop,
        borderTop: `${TOOLTIP_ARROW_OUTER_SIZE}px solid transparent`,
        borderBottom: `${TOOLTIP_ARROW_OUTER_SIZE}px solid transparent`,
        borderRight: `${TOOLTIP_ARROW_OUTER_SIZE}px solid ${theme.borderColor}`,
      },
      inner: {
        ...tooltipTriangleBaseStyle,
        left: -TOOLTIP_ARROW_INNER_SIZE + 1,
        top: innerTop,
        borderTop: `${TOOLTIP_ARROW_INNER_SIZE}px solid transparent`,
        borderBottom: `${TOOLTIP_ARROW_INNER_SIZE}px solid transparent`,
        borderRight: `${TOOLTIP_ARROW_INNER_SIZE}px solid ${theme.background}`,
      },
    };
  }

  if (coords.placement === "above") {
    const outerLeft = (coords.arrowLeft ?? 16) - TOOLTIP_ARROW_OUTER_SIZE;
    const innerLeft = (coords.arrowLeft ?? 16) - TOOLTIP_ARROW_INNER_SIZE;
    return {
      outer: {
        ...tooltipTriangleBaseStyle,
        left: outerLeft,
        bottom: -TOOLTIP_ARROW_OUTER_SIZE,
        borderLeft: `${TOOLTIP_ARROW_OUTER_SIZE}px solid transparent`,
        borderRight: `${TOOLTIP_ARROW_OUTER_SIZE}px solid transparent`,
        borderTop: `${TOOLTIP_ARROW_OUTER_SIZE}px solid ${theme.borderColor}`,
      },
      inner: {
        ...tooltipTriangleBaseStyle,
        left: innerLeft,
        bottom: -TOOLTIP_ARROW_INNER_SIZE + 1,
        borderLeft: `${TOOLTIP_ARROW_INNER_SIZE}px solid transparent`,
        borderRight: `${TOOLTIP_ARROW_INNER_SIZE}px solid transparent`,
        borderTop: `${TOOLTIP_ARROW_INNER_SIZE}px solid ${theme.background}`,
      },
    };
  }

  const outerLeft = (coords.arrowLeft ?? 16) - TOOLTIP_ARROW_OUTER_SIZE;
  const innerLeft = (coords.arrowLeft ?? 16) - TOOLTIP_ARROW_INNER_SIZE;
  return {
    outer: {
      ...tooltipTriangleBaseStyle,
      left: outerLeft,
      top: -TOOLTIP_ARROW_OUTER_SIZE,
      borderLeft: `${TOOLTIP_ARROW_OUTER_SIZE}px solid transparent`,
      borderRight: `${TOOLTIP_ARROW_OUTER_SIZE}px solid transparent`,
      borderBottom: `${TOOLTIP_ARROW_OUTER_SIZE}px solid ${theme.borderColor}`,
    },
    inner: {
      ...tooltipTriangleBaseStyle,
      left: innerLeft,
      top: -TOOLTIP_ARROW_INNER_SIZE + 1,
      borderLeft: `${TOOLTIP_ARROW_INNER_SIZE}px solid transparent`,
      borderRight: `${TOOLTIP_ARROW_INNER_SIZE}px solid transparent`,
      borderBottom: `${TOOLTIP_ARROW_INNER_SIZE}px solid ${theme.background}`,
    },
  };
}

const tooltipTriangleBaseStyle: CSSProperties = {
  position: "absolute",
  width: 0,
  height: 0,
  pointerEvents: "none",
};

function readTooltipTheme(anchor: HTMLElement): TooltipTheme {
  const styles = getComputedStyle(anchor);
  const isLight = document.documentElement.classList.contains("light");
  const neutralBackground1 = cssVar(styles, "--colorNeutralBackground1");
  const neutralBackground2 = cssVar(styles, "--colorNeutralBackground2");
  const neutralForeground1 = cssVar(styles, "--colorNeutralForeground1");
  const neutralForeground2 = cssVar(styles, "--colorNeutralForeground2");
  const stroke1 = cssVar(styles, "--colorNeutralStroke1");
  const stroke2 = cssVar(styles, "--colorNeutralStroke2");

  return {
    background: isLight
      ? neutralBackground1 || "#ffffff"
      : neutralBackground2 || neutralBackground1 || "#1f1f1f",
    borderColor: isLight
      ? stroke1 || stroke2 || "rgba(0,0,0,0.14)"
      : stroke2 || stroke1 || "rgba(255,255,255,0.18)",
    color: neutralForeground1 || neutralForeground2 || (isLight ? "#242424" : "#f5f5f5"),
    boxShadow: isLight
      ? "0 10px 26px rgba(30, 18, 56, 0.16), 0 2px 8px rgba(30, 18, 56, 0.08)"
      : "0 12px 30px rgba(0,0,0,0.50), 0 2px 8px rgba(0,0,0,0.35)",
  };
}

function fallbackTooltipTheme(): TooltipTheme {
  const isLight = document.documentElement.classList.contains("light");
  return {
    background: isLight ? "#ffffff" : "#1f1f1f",
    borderColor: isLight ? "rgba(30,18,56,0.16)" : "rgba(255,255,255,0.18)",
    color: isLight ? "#242424" : "#f5f5f5",
    boxShadow: isLight
      ? "0 10px 26px rgba(30, 18, 56, 0.16), 0 2px 8px rgba(30, 18, 56, 0.08)"
      : "0 12px 30px rgba(0,0,0,0.50), 0 2px 8px rgba(0,0,0,0.35)",
  };
}

function cssVar(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim();
}

function effectiveTooltipMaxWidth(maxWidth?: number): number {
  return Math.min(maxWidth ?? 360, window.innerWidth - TOOLTIP_VIEWPORT_PADDING * 2);
}

function clampNumber(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function findTitleAnchor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest(`[title], [${GLOBAL_TITLE_ATTR}]`);
  if (!(anchor instanceof HTMLElement)) return null;
  if (anchor.closest("[data-tooltip-disabled='true']")) return null;
  return anchor;
}

function moveNativeTitleToData(anchor: HTMLElement): string {
  const title = anchor.getAttribute("title");
  if (title) {
    anchor.setAttribute(GLOBAL_TITLE_ATTR, title);
    anchor.removeAttribute("title");
    return title;
  }
  return anchor.getAttribute(GLOBAL_TITLE_ATTR) ?? "";
}

function restoreNativeTitle(anchor: HTMLElement) {
  const title = anchor.getAttribute(GLOBAL_TITLE_ATTR);
  if (!title) return;
  anchor.setAttribute("title", title);
  anchor.removeAttribute(GLOBAL_TITLE_ATTR);
}

function readGlobalTooltipPositioning(anchor: HTMLElement): TooltipPositioning {
  const value = anchor.getAttribute("data-tooltip-position");
  if (value === "below-start" || value === "above-center" || value === "right-center" || value === "below-center") return value;
  return "below-center";
}

function readGlobalTooltipMaxWidth(anchor: HTMLElement): number | undefined {
  const value = Number(anchor.getAttribute("data-tooltip-max-width"));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
