import { useCallback, useEffect, useState } from "react";
import {
  Pin24Regular,
  Pin24Filled,
  Subtract16Regular,
  Square16Regular,
  SquareMultiple16Regular,
  Dismiss16Regular,
} from "@fluentui/react-icons";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  const poetry = usePoetryStore((s) => s.line);

  const [pinned,    setPinned]    = useState(false);
  const [maximized, setMaximized] = useState(false);

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
        <span aria-hidden style={{ fontSize: 14 }}>👀</span>
        <span
          className="truncate text-xs"
          style={{ color: "var(--colorNeutralForeground2)" }}
          title={poetry}
        >
          {poetry}
        </span>
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

interface CtrlBtnProps {
  title:    string;
  onClick:  () => void;
  children: React.ReactNode;
  variant?: "default" | "danger";
  active?:  boolean;
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