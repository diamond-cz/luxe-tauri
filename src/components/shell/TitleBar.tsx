import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Pin24Regular,
  Pin24Filled,
  Subtract16Regular,
  Square16Regular,
  SquareMultiple16Regular,
  Dismiss16Regular,
  ArrowCircleUp24Regular,
} from "@fluentui/react-icons";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fetchPoetry } from "@/ipc/shell";
import { usePoetryStore } from "@/stores/poetryStore";
import { useUpdateStore } from "@/stores/updateStore";

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
interface TitleBarProps {
  sideNavVisible: boolean;
  onToggleSideNav: () => void;
}

export function TitleBar({ sideNavVisible, onToggleSideNav }: TitleBarProps) {
  const navigate = useNavigate();
  const poetry = usePoetryStore((s) => s.line);

  const [pinned,    setPinned]    = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [refreshingPoetry, setRefreshingPoetry] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    win.isMaximized().then((value) => {
      if (!disposed) setMaximized(value);
    }).catch(() => {});
    win.onResized(() => {
      win.isMaximized().then((value) => {
        if (!disposed) setMaximized(value);
      }).catch(() => {});
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    }).catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
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
        <BlinkingEyesButton onClick={onToggleSideNav} sideNavVisible={sideNavVisible} />
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
        <AvailableUpdateButton />
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

function AvailableUpdateButton() {
  const navigate = useNavigate();
  const status = useUpdateStore((state) => state.status);
  const version = useUpdateStore((state) => state.latestVersion);
  const notes = useUpdateStore((state) => state.notes);
  const downloaded = useUpdateStore((state) => state.downloadedBytes);
  const total = useUpdateStore((state) => state.totalBytes);
  const update = useUpdateStore((state) => state.update);
  const visible = Boolean(version && update && ["available", "downloading", "installing"].includes(status));
  const noteLines = (notes ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:#{1,6}\s*|[-*]\s*)/, "").trim())
    .filter((line) => line && !/^v?\d+\.\d+\.\d+$/.test(line))
    .slice(0, 4);
  if (!visible) return null;

  const busy = status !== "available";
  const label = status === "downloading"
    ? `下载中 ${total ? `${Math.min(100, Math.floor(downloaded / total * 100))}%` : `${(downloaded / 1048576).toFixed(1)} MB`}`
    : status === "installing" ? "正在安装" : "立即更新";

  return (
    <div className="group relative flex h-full items-stretch">
      <button
        type="button"
        aria-label={`发现新版本 v${version}`}
        aria-haspopup="true"
        onClick={() => navigate("/home")}
        className="flex h-full w-11 items-center justify-center transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
        style={{ color: "var(--colorPaletteGreenForeground1)" }}
      >
        <ArrowCircleUp24Regular className="h-5 w-5" />
      </button>
      <div
        className="invisible absolute right-1 top-full z-50 w-[min(21rem,calc(100vw-1rem))] pt-2 opacity-0 transition duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
      >
        <div
          className="overflow-hidden rounded-xl border shadow-xl"
          style={{ background: "var(--colorNeutralBackground1)", borderColor: "var(--colorNeutralStroke2)" }}
        >
          <div className="px-4 pt-4 text-sm font-semibold" style={{ color: "var(--colorNeutralForeground1)" }}>
            发现新版本 v{version}
          </div>
          {noteLines.length > 0 && (
            <ul className="mx-4 mt-3 max-h-36 space-y-2 overflow-y-auto border-t pt-3" style={{ borderColor: "var(--colorNeutralStroke2)" }}>
              {noteLines.map((line, index) => (
                <li key={`${index}-${line}`} className="flex gap-2 text-xs leading-5" style={{ color: "var(--colorNeutralForeground2)" }}>
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--colorBrandBackground)" }} />
                  <span className="line-clamp-2">{line}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex justify-end px-4 pb-4">
            <button
              type="button"
              title={label}
              disabled={busy}
              onClick={() => navigate("/home")}
              className="rounded px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-default disabled:opacity-60"
              style={{ background: "var(--colorBrandBackground)" }}
            >
              前往更新
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BlinkingEyesButton({ onClick, sideNavVisible }: { onClick: () => void; sideNavVisible: boolean }) {
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

        const x = clamp(((event.clientX - centerX) / centerX) * 4, -4, 4);
        const y = clamp(((event.clientY - centerY) / centerY) * 3.5, -3.5, 3.5);
        setLookOffset((current) =>
          Math.abs(current.x - x) < 0.2 && Math.abs(current.y - y) < 0.2
            ? current
            : { x, y },
        );
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
      aria-label={sideNavVisible ? "隐藏侧边栏" : "显示侧边栏"}
      title={sideNavVisible ? "隐藏侧边栏" : "显示侧边栏"}
      aria-pressed={sideNavVisible}
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
