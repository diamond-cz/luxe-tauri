import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { pauseShortcuts, resumeShortcuts } from "@/ipc/shell";

interface Props {
  value:    string;
  onChange: (accel: string) => void;
  onClear?: () => void;
  placeholder?: string;
}

const MODIFIER_ORDER = ["CmdOrCtrl", "Alt", "Shift", "Super"] as const;

type FormatResult =
  | { kind: "ok";       value: string }
  | { kind: "needMod" }                       // bare key without any modifier
  | { kind: "modOnly" }                       // just Ctrl/Alt/Shift held
  | { kind: "cancel"  };                      // Escape

function formatAccelerator(e: KeyboardEvent): FormatResult {
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("CmdOrCtrl");
  if (e.altKey)               mods.push("Alt");
  if (e.shiftKey)             mods.push("Shift");

  let key = e.key;
  if (key === "Escape") return { kind: "cancel" };

  // Modifier-only press (user hasn't picked the trigger key yet)
  if (["Control", "Alt", "Shift", "Meta", "OS", "ContextMenu", "Dead"].includes(key)) {
    return { kind: "modOnly" };
  }

  // Reject bare key with no modifier — accelerator must have at least 2 keys.
  if (mods.length === 0) return { kind: "needMod" };

  // Normalise to Tauri's accelerator codes.
  if (key === " ")        key = "Space";
  else if (key === "Enter")     key = "Enter";
  else if (key === "Tab")       key = "Tab";
  else if (key === "ArrowUp")   key = "Up";
  else if (key === "ArrowDown") key = "Down";
  else if (key === "ArrowLeft") key = "Left";
  else if (key === "ArrowRight")key = "Right";
  else if (/^[a-zA-Z]$/.test(key)) key = key.toUpperCase();
  // F1..F24, digits stay as-is.

  return {
    kind:  "ok",
    value: [...MODIFIER_ORDER.filter((m) => mods.includes(m)), key].join("+"),
  };
}

export function KeyRecorder({ value, onChange, onClear, placeholder }: Props) {
  const { t } = useTranslation();
  const [listening, setListening] = useState(false);
  const [hint,      setHint]      = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hintTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashHint = useCallback((msg: string) => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setHint(msg);
    hintTimer.current = setTimeout(() => setHint(null), 1600);
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = formatAccelerator(e);
    switch (r.kind) {
      case "ok":
        onChange(r.value);
        setListening(false);
        setHint(null);
        break;
      case "needMod":
        flashHint(t("shortcut_need_modifier", { defaultValue: "需配合 Ctrl / Alt / Shift" }));
        break;
      case "modOnly":
        // wait for the trigger key — no flash needed
        break;
      case "cancel":
        setListening(false);
        setHint(null);
        break;
    }
  }, [onChange, t, flashHint]);

  useEffect(() => {
    if (!listening) {
      resumeShortcuts().catch(() => {});
      return;
    }
    pauseShortcuts().catch(() => {});
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [listening, onKeyDown]);

  useEffect(() => {
    if (!listening) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setListening(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [listening]);

  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

  const displayValue = listening
    ? t("shortcut_listening", { defaultValue: "正在等待..." })
    : (value || (placeholder ?? t("shortcut_placeholder", { defaultValue: "按下快捷键" })));

  return (
    <div ref={containerRef} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setListening((s) => !s)}
          className={
            "min-w-[200px] rounded-md border px-3 py-2 text-left text-sm transition-colors " +
            (listening ? "ring-2" : "")
          }
          style={{
            background:  "var(--colorNeutralBackground3)",
            borderColor: listening
              ? "var(--colorBrandStroke1)"
              : "var(--colorNeutralStroke2)",
            color: value
              ? "var(--colorNeutralForeground1)"
              : "var(--colorNeutralForeground4)",
          }}
        >
          {displayValue}
        </button>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            title={t("clear", { defaultValue: "清除" })}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10"
            style={{ color: "var(--colorNeutralForeground3)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 2a10 10 0 1 0 10 10A10.011 10.011 0 0 0 12 2zm3.59 13.59L12 12l-3.59 3.59-1.41-1.41L10.59 10.59 7 7l1.41-1.41L12 9.17l3.59-3.58L17 7l-3.59 3.59L17 14.18z"/>
            </svg>
          </button>
        )}
      </div>
      {hint && (
        <div
          className="text-xs"
          style={{ color: "var(--colorPaletteRedForeground1)" }}
          role="alert"
        >
          {hint}
        </div>
      )}
    </div>
  );
}