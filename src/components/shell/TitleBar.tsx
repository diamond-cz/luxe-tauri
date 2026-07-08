import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Pin24Regular,
  Pin24Filled,
  Subtract16Regular,
  Square16Regular,
  SquareMultiple16Regular,
  Dismiss16Regular,
} from "@fluentui/react-icons";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fetchPoetry } from "@/ipc/shell";
import { usePoetryStore } from "@/stores/poetryStore";

/**
 * Frameless title bar — replaces the OS-drawn title bar (`decorations: false`).
 *
 * Left: 👀 + 今日诗词 (subscribed to poetryStore; fed by EVT_POETRY_UPDATED)
 * Right: 置顶 / 最小化 / 最大化↔还原 / 关闭
 *
 * Buttons are wrapped inside a non-drag container so click events don't
 * accidentally start a window move. Double-clicking the drag region toggles
 * maximize (matches native title bar behaviour).
 */
export function TitleBar() {
  const navigate = useNavigate();
  const poetry = usePoetryStore((s) => s.line);

  const [pinned,    setPinned]    = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [refreshingPoetry, setRefreshingPoetry] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    win.isMaximized().then(setMaximized).catch(() => {});
    win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  const togglePin = useCallback(async () => {
    const win = getCurrentWindow();
    const next = !pinned;
    setPinned(next);
    try {
      await win.setAlwaysOnTop(next);
    } catch (err) {
      console.warn("setAlwaysOnTop failed", err);
      setPinned(!next);
    }
  }, [pinned]);

  const onMin   = () => getCurrentWindow().minimize().catch(() => {});
  const onMax   = () => getCurrentWindow().toggleMaximize().catch(() => {});
  const onClose = () => getCurrentWindow().close().catch(() => {});
  const goShortcutSettings = useCallback(() => {
    navigate("/settings?tab=shortcut");
  }, [navigate]);
  const goAboutSettings = useCallback(() => {
    navigate("/settings?tab=about");
  }, [navigate]);
  const onRefreshPoetry = useCallback(async () => {
    if (refreshingPoetry) return;
    setRefreshingPoetry(true);
    try {
      await fetchPoetry();
    } catch (err) {
      console.warn("fetchPoetry failed", err);
    } finally {
      setRefreshingPoetry(false);
    }
  }, [refreshingPoetry]);

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={onMax}
      className="flex h-9 w-full shrink-0 items-center select-none"
      style={{
        background:  "var(--colorNeutralBackground1)",
        borderBottom:"1px solid var(--colorNeutralStroke2)",
      }}
    >
      {/* Poetry — left-aligned, single line, ellipsis, draggable */}
      <div
        data-tauri-drag-region
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-3"
      >
        <BlinkingEyesButton onClick={goAboutSettings} />
        <button
          type="button"
          aria-label="进入快捷键设置"
          onClick={goShortcutSettings}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void onRefreshPoetry();
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className="min-w-0 truncate rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-black/5"
          style={{ color: "var(--colorNeutralForeground2)" }}
        >
          {poetry}
        </button>
      </div>

      <div className="flex h-full items-stretch">
        <CtrlButton
          title={pinned ? "取消置顶" : "置顶窗口"}
          onClick={togglePin}
          active={pinned}
        >
          {pinned ? <Pin24Filled className="h-4 w-4" /> : <Pin24Regular className="h-4 w-4" />}
        </CtrlButton>
        <CtrlButton title="最小化" onClick={onMin}>
          <Subtract16Regular />
        </CtrlButton>
        <CtrlButton title={maximized ? "还原" : "最大化"} onClick={onMax}>
          {maximized ? <SquareMultiple16Regular /> : <Square16Regular />}
        </CtrlButton>
        <CtrlButton title="关闭" onClick={onClose} variant="danger">
          <Dismiss16Regular />
        </CtrlButton>
      </div>
    </div>
  );
}

function BlinkingEyesButton({ onClick }: { onClick: () => void }) {
  const [blinking, setBlinking] = useState(false);
  const [lookOffset, setLookOffset] = useState({ x: 0, y: 0 });
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const blink = useCallback(() => {
    setBlinking(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setBlinking(false);
      timerRef.current = null;
    }, 150);
  }, []);

  useEffect(() => {
    intervalRef.current = window.setInterval(blink, 4800);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
  }, [blink]);

  useEffect(() => {
    let frame = 0;

    const updateLookOffset = (event: PointerEvent) => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        if (centerX <= 0 || centerY <= 0) return;

        setLookOffset({
          x: clamp(((event.clientX - centerX) / centerX) * 4, -4, 4),
          y: clamp(((event.clientY - centerY) / centerY) * 3.5, -3.5, 3.5),
        });
        frame = 0;
      });
    };

    window.addEventListener("pointermove", updateLookOffset, { passive: true });
    return () => {
      window.removeEventListener("pointermove", updateLookOffset);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <button
      type="button"
      aria-label="进入关于页面"
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        blink();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className="relative flex h-6 w-7 shrink-0 items-center justify-center overflow-hidden rounded transition-colors hover:bg-black/5"
      style={{ color: "var(--colorNeutralForeground1)" }}
    >
      <span style={eyePairStyle(lookOffset)}>
        <span style={eyeStyle(blinking)}>
          <span style={pupilStyle(blinking)} />
        </span>
        <span style={eyeStyle(blinking)}>
          <span style={pupilStyle(blinking)} />
        </span>
      </span>
    </button>
  );
}

interface CtrlBtnProps {
  title:    string;
  onClick:  () => void;
  children: React.ReactNode;
  variant?: "default" | "danger";
  active?:  boolean;
}

function eyePairStyle(offset: { x: number; y: number }): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    transform: `translate(${offset.x}px, ${offset.y}px)`,
    transition: "transform 120ms ease-out",
  };
}

function eyeStyle(blinking: boolean): React.CSSProperties {
  return {
    position: "relative",
    width: 9,
    height: blinking ? 2 : 12,
    boxSizing: "border-box",
    border: "1.8px solid currentColor",
    borderRadius: "999px",
    background: "var(--colorNeutralBackground1)",
    overflow: "hidden",
    transition: "height 90ms ease-out, transform 90ms ease-out",
    transform: blinking ? "translateY(1px)" : "translateY(0)",
  };
}

function pupilStyle(blinking: boolean): React.CSSProperties {
  return {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 3,
    height: 3,
    borderRadius: "999px",
    background: "currentColor",
    opacity: blinking ? 0 : 1,
    transform: "translate(-50%, -50%)",
    transition: "opacity 60ms ease-out",
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function CtrlButton({ title, onClick, children, variant = "default", active }: CtrlBtnProps) {
  const dangerHover = variant === "danger";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-full w-11 items-center justify-center transition-colors"
      style={{
        color: active
          ? "var(--colorBrandForeground1)"
          : "var(--colorNeutralForeground2)",
        background: active
          ? "var(--colorBrandBackground2)"
          : "transparent",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = dangerHover
          ? "#e81123"
          : "var(--colorNeutralBackground3)";
        (e.currentTarget as HTMLButtonElement).style.color = dangerHover
          ? "#ffffff"
          : "var(--colorNeutralForeground1)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = active
          ? "var(--colorBrandBackground2)"
          : "transparent";
        (e.currentTarget as HTMLButtonElement).style.color = active
          ? "var(--colorBrandForeground1)"
          : "var(--colorNeutralForeground2)";
      }}
    >
      {children}
    </button>
  );
}
