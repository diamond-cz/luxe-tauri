import { useEffect, useRef, useState } from "react";
import { DocumentText24Regular } from "@fluentui/react-icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { HoverTooltip } from "@/components/common/HoverTooltip";

interface Props {
  cppFileHint: string;
  cppPath: string | null;
  onCppPathChange: (path: string) => void;
}

const CPP_EXTS = ["cpp", "c", "h", "hpp", "cxx", "cc"];

type Slot = "cpp" | null;

export function MtkPickerBar(props: Props) {
  const cppRef = useRef<HTMLDivElement | null>(null);
  const cppPrimaryRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<Slot>(null);
  const [hoverValid, setHoverValid] = useState<"ok" | "bad" | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === "enter") {
          const slot = hitTest(payload.position);
          setHover(slot);
          setHoverValid(slot ? classify(slot, payload.paths) : null);
          return;
        }
        if (payload.type === "over") {
          setHover(hitTest(payload.position));
          return;
        }
        if (payload.type === "leave") {
          setHover(null);
          setHoverValid(null);
          return;
        }
        if (payload.type === "drop") {
          const slot = hitTest(payload.position);
          setHover(null);
          setHoverValid(null);
          if (!slot || payload.paths.length === 0) return;
          const path = payload.paths.find((p) => matchExt(p, CPP_EXTS));
          if (path) props.onCppPathChange(path);
        }
      });
    })();
    return () => { unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.onCppPathChange]);

  function hitTest(p: { x: number; y: number }): Slot {
    const el = cppRef.current;
    if (!el) return null;
    const dpr = window.devicePixelRatio || 1;
    const x = p.x / dpr;
    const y = p.y / dpr;
    const r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? "cpp" : null;
  }

  const pickCpp = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "Source", extensions: CPP_EXTS }],
    });
    if (typeof picked === "string") props.onCppPathChange(picked);
  };

  return (
    <div className="h-16 w-full">
      <Slot
        innerRef={cppRef}
        primaryRef={cppPrimaryRef}
        active={hover === "cpp"}
        valid={hover === "cpp" ? hoverValid : null}
        icon={<DocumentText24Regular />}
        primary="参数文件卡片"
        secondary={
          props.cppPath
            ? props.cppPath
            : `期望 ${props.cppFileHint} · 点击此处浏览，或拖入 .cpp / .c / .h 文件`
        }
        onPick={pickCpp}
      />
    </div>
  );
}

interface SlotProps {
  innerRef: React.RefObject<HTMLDivElement>;
  active: boolean;
  valid: "ok" | "bad" | null;
  disabled?: boolean;
  icon: React.ReactNode;
  primary: string;
  secondary: string;
  primaryRef?: React.RefObject<HTMLDivElement>;
  onPick: () => void;
}

function Slot({
  innerRef, active, valid, disabled, icon, primary, secondary, primaryRef, onPick,
}: SlotProps) {
  const borderColor =
    !active ? "var(--colorNeutralStroke2)" :
    valid === "ok" ? "var(--colorPaletteGreenBorder2)" :
    valid === "bad" ? "var(--colorPaletteRedBorder2)" :
                      "var(--colorBrandStroke1)";
  const bg =
    !active ? "var(--colorNeutralBackground2)" :
    valid === "ok" ? "var(--colorPaletteGreenBackground1)" :
    valid === "bad" ? "var(--colorPaletteRedBackground1)" :
                      "var(--colorNeutralBackground2)";

  return (
    <div
      ref={innerRef}
      className="flex h-full w-full items-center gap-3 rounded-lg border p-2 transition-colors"
      style={{
        background: bg,
        borderColor,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
        style={{
          background: "var(--colorNeutralBackground3)",
          color: "var(--colorNeutralForeground2)",
        }}
      >
        {icon}
      </div>
      <button
        type="button"
        className="min-w-0 flex-1 rounded-md px-2 py-1 text-left transition-colors"
        style={{
          color: "inherit",
          background: "transparent",
        }}
        title={secondary}
        onClick={onPick}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = "var(--colorSubtleBackgroundHover)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = "transparent";
        }}
      >
        <HoverTooltip
          content={primary}
          truncatableRef={primaryRef}
          positioning="below-start"
          wrap
          maxWidth={600}
        >
          <div
            ref={primaryRef}
            className="truncate text-sm font-semibold"
            style={{ color: "var(--colorNeutralForeground1)" }}
          >
            {primary}
          </div>
        </HoverTooltip>
        <div
          className="mt-0.5 truncate text-[11px]"
          style={{ color: "var(--colorNeutralForeground3)" }}
        >
          {secondary}
        </div>
      </button>
    </div>
  );
}

function matchExt(path: string, exts: string[]): boolean {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return exts.includes(lower.slice(dot + 1));
}

function classify(slot: NonNullable<Slot>, paths: string[]): "ok" | "bad" {
  if (paths.length === 0) return "bad";
  if (slot === "cpp") return paths.some((p) => matchExt(p, CPP_EXTS)) ? "ok" : "bad";
  return "bad";
}
