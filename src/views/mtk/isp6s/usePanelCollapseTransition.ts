import { useCallback, useEffect, useRef, useState, type TransitionEvent } from "react";

export function usePanelCollapseTransition() {
  const [collapsing, setCollapsing] = useState(false);
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
    setCollapsing(false);
  }, [clearPending]);

  useEffect(() => () => {
    clearPending();
    activeRef.current = false;
  }, [clearPending]);

  const collapse = useCallback((action: () => void) => {
    if (activeRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      action();
      return;
    }
    activeRef.current = true;
    setCollapsing(true);
    // Let the transition class paint before the panel's flex-grow changes.
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        action();
        fallbackRef.current = window.setTimeout(finish, 280);
      });
    });
  }, [finish]);

  const onTransitionEnd = useCallback((event: TransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.propertyName === "flex-grow") finish();
  }, [finish]);

  return { collapsing, collapse, onTransitionEnd };
}
