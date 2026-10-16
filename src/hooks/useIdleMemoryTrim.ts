import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { trimMemory } from "@/ipc/memory";

export function useIdleMemoryTrim() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);

  useEffect(() => {
    let timer: number | undefined;
    const clear = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clear();
      if (document.visibilityState === "visible") {
        timer = window.setTimeout(() => {
          timer = undefined;
          void trimMemory().catch((error) => console.debug("memory trim failed", error));
        }, 8000);
      }
    };
    const onVisibility = () => {
      clear();
      if (document.visibilityState === "hidden") {
        void trimMemory(true).catch((error) => console.debug("memory trim failed", error));
      } else {
        schedule();
      }
    };
    const scrollOptions = { capture: true, passive: true } as const;
    document.addEventListener("scroll", schedule, scrollOptions);
    window.addEventListener("pointerup", schedule);
    window.addEventListener("pointermove", schedule, { passive: true });
    window.addEventListener("keydown", schedule);
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      clear();
      document.removeEventListener("scroll", schedule, scrollOptions);
      window.removeEventListener("pointerup", schedule);
      window.removeEventListener("pointermove", schedule);
      window.removeEventListener("keydown", schedule);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = pathname;
    if (previous.startsWith("/mtk") && !pathname.startsWith("/mtk")) {
      void trimMemory(true).catch((error) => console.debug("memory trim failed", error));
    }
  }, [pathname]);
}
