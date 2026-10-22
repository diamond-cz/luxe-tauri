import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@fluentui/react-components";
import { ChevronDown20Regular, Dismiss20Regular, Heart20Filled, Heart20Regular } from "@fluentui/react-icons";
import { favoritesFirst, readColumnEditHistory, writeColumnEditHistory, type ColumnEditField, type ColumnEditHistoryItem } from "./columnEditHistory";

export function ColumnEditHistoryInput({ field, value, ariaLabel, onChange, onSave, onCancel }: {
  field: ColumnEditField; value: string; ariaLabel: string;
  onChange: (value: string) => void; onSave: () => void; onCancel: () => void;
}) {
  const [history, setHistory] = useState(() => readColumnEditHistory(field));
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 220 });
  const anchorRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const updateHistory = (next: ColumnEditHistoryItem[]) => {
    const sorted = favoritesFirst(next);
    setHistory(sorted);
    writeColumnEditHistory(field, sorted);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const positionPopup = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const openBelow = below >= 180 || below >= rect.top;
      const maxHeight = Math.min(220, Math.max(32, (openBelow ? below : rect.top) - 12));
      setPosition({ left: rect.left, top: openBelow ? rect.bottom + 2 : rect.top - maxHeight - 2,
        width: rect.width, maxHeight });
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchorRef.current?.contains(event.target)
        && !popupRef.current?.contains(event.target)) setOpen(false);
    };
    positionPopup();
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", positionPopup);
    window.addEventListener("scroll", positionPopup, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", positionPopup);
      window.removeEventListener("scroll", positionPopup, true);
    };
  }, [open]);

  return <div ref={anchorRef} className="column-settings-history-anchor flex min-w-0 items-center">
    <Input autoFocus size="small" className="min-w-0 flex-1" value={value} aria-label={ariaLabel}
      onChange={(_, data) => onChange(data.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") { setOpen(false); onSave(); }
        if (event.key === "Escape") { if (open) setOpen(false); else onCancel(); }
      }} />
    <button type="button" className="column-settings-history-toggle" title={`${ariaLabel}历史`} aria-label={`${ariaLabel}历史`}
      aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <ChevronDown20Regular aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={popupRef} className="column-settings-history-list" role="group"
      aria-label={`${ariaLabel}历史`} style={{ left: position.left, top: position.top,
        width: position.width, maxHeight: position.maxHeight }}>
      {history.length === 0 ? <div className="px-3 py-2 text-xs" style={{ color: "var(--colorNeutralForeground3)" }}>暂无历史记录</div>
        : history.map((item) => <div key={item.value} className="column-settings-history-item">
          <button type="button" className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs"
            title={item.value} onClick={() => { onChange(item.value); setOpen(false); }}>{item.value}</button>
          <button type="button" className="column-settings-history-action" title={item.favorite ? "取消收藏" : "收藏"}
            aria-label={`${item.favorite ? "取消收藏" : "收藏"} ${item.value}`} aria-pressed={item.favorite}
            style={{ color: item.favorite ? "var(--colorPaletteRedForeground1)" : "var(--colorNeutralForeground3)" }}
            onClick={() => updateHistory(history.map((entry) => entry.value === item.value
              ? { ...entry, favorite: !entry.favorite } : entry))}>
            {item.favorite ? <Heart20Filled /> : <Heart20Regular />}
          </button>
          <button type="button" className="column-settings-history-action" title="移除"
            aria-label={`移除 ${item.value}`} onClick={() => updateHistory(history.filter((entry) => entry.value !== item.value))}>
            <Dismiss20Regular />
          </button>
        </div>)}
    </div>, document.getElementById("column-settings-theme-root") ?? document.body)}
  </div>;
}
