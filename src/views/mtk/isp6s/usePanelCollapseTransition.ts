import { useCallback, useEffect, useRef, useState, type CSSProperties, type TransitionEvent } from "react";

export type PanelMotion = "idle" | "collapsing" | "expanding";
export type PanelMotionDirection = "left" | "right" | "bottom";

export function panelMotionStyle(motion: PanelMotion, direction: PanelMotionDirection): CSSProperties {
  const isExpanding = motion === "expanding";
  const isCollapsing = motion === "collapsing";
  const sign = direction === "left" ? -1 : 1;
  const offset = isExpanding ? 14 : isCollapsing ? 8 : 0;
  const axis = direction === "bottom" ? "Y" : "X";
  const translation = offset === 0 ? "0px" : `${(direction === "bottom" ? 1 : sign) * offset}px`;
  const scale = isExpanding ? 0.985 : isCollapsing ? 0.99 : 1;
  return {
    opacity: isExpanding ? 0.82 : isCollapsing ? 0.9 : 1,
    transform: `translate${axis}(${translation}) scale(${scale})`,
    transformOrigin: direction === "left" ? "left center" : direction === "right" ? "right center" : "center bottom",
    transition: "transform 280ms cubic-bezier(0.2, 0, 0, 1), opacity 220ms ease-out",
    willChange: "transform, opacity",
  };
}

export function usePanelCollapseTransition() {
  const [transitioning, setTransitioning] = useState(false);
  const [motion, setMotion] = useState<PanelMotion>("idle");
  const activeRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const fallbackRef = useRef<number | null>(null);

  const clearPending = useCallback(() => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current);
    frameRef.current = null;
    fallbackRef.current = null;
  }, []);

  const finish = useCallback(() => {
    if (!activeRef.current) return;
    clearPending();
    activeRef.current = false;
    setTransitioning(false);
    setMotion("idle");
  }, [clearPending]);

  useEffect(() => () => {
    clearPending();
    activeRef.current = false;
  }, [clearPending]);

  const run = useCallback((direction: Exclude<PanelMotion, "idle">, action: () => void) => {
    if (activeRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      action();
      return;
    }
    activeRef.current = true;
    setTransitioning(true);
    setMotion(direction);
    // Let the transition class paint before the panel's flex-grow changes.
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        action();
        if (direction === "expanding") {
          // The content starts at the restore edge, then settles into its full card position.
          window.requestAnimationFrame(() => setMotion("idle"));
        }
        fallbackRef.current = window.setTimeout(finish, 360);
      });
    });
  }, [finish]);

  const collapse = useCallback((action: () => void) => run("collapsing", action), [run]);
  const expand = useCallback((action: () => void) => run("expanding", action), [run]);

  const onTransitionEnd = useCallback((event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.propertyName === "flex-grow") finish();
  }, [finish]);

  return { transitioning, motion, collapse, expand, onTransitionEnd };
}
