import { useEffect, useRef, useState } from "react";
import { ChevronDown16Regular } from "@fluentui/react-icons";

import { ISP_LIST, ISP_TABS, type IspId, type IspTab } from "./ispTabs";

interface Props {
  isp:        IspId;
  tabIdx:     number;
  onIspChange:(id: IspId) => void;
  onTabChange:(idx: number) => void;
}

/**
 * Replaces the old vertical ISP nav rail with a compact horizontal bar:
 * "ISP  [▼ ISP6S]    [AE Basic] [ToneMap]"
 */
export function IspSelectBar({ isp, tabIdx, onIspChange, onTabChange }: Props) {
  const tabs = ISP_TABS[isp];
  const selectRef = useRef<HTMLDivElement | null>(null);
  const [selectHover, setSelectHover] = useState(false);
  const [selectFocus, setSelectFocus] = useState(false);
  const [selectOpen, setSelectOpen] = useState(false);
  const selectHighlighted = selectHover || selectFocus || selectOpen;
  const currentIspLabel = ISP_LIST.find((it) => it.id === isp)?.label ?? isp;

  useEffect(() => {
    if (!selectOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!selectRef.current?.contains(event.target as Node)) {
        setSelectOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selectOpen]);

  return (
    <div
      className="flex h-11 shrink-0 items-stretch gap-3 pl-0 pr-5"
      style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}
    >
      <div
        ref={selectRef}
        className="relative flex h-full w-[140px] items-stretch transition-colors"
        style={{
          background: selectHighlighted
            ? "var(--colorNeutralBackground3)"
            : "var(--colorNeutralBackground2)",
          borderRight: `1px solid ${
            selectHighlighted
              ? "var(--colorNeutralStroke1)"
              : "var(--colorNeutralStroke2)"
          }`,
          color: selectHighlighted
            ? "var(--colorNeutralForeground1)"
            : "var(--colorNeutralForeground2)",
        }}
        onMouseEnter={() => setSelectHover(true)}
        onMouseLeave={() => setSelectHover(false)}
      >
        <button
          type="button"
          className="flex h-full w-full items-center justify-between gap-2 px-3 text-sm transition-colors"
          aria-haspopup="listbox"
          aria-expanded={selectOpen}
          onClick={() => setSelectOpen((v) => !v)}
          onFocus={() => setSelectFocus(true)}
          onBlur={() => setSelectFocus(false)}
          style={{
            background: selectHighlighted
              ? "var(--colorNeutralBackground3)"
              : "var(--colorNeutralBackground2)",
            color: "inherit",
            outline: selectFocus
              ? "1px solid var(--colorBrandStroke1)"
              : "none",
            outlineOffset: -1,
          }}
        >
          <span>{currentIspLabel}</span>
          <ChevronDown16Regular
            className="shrink-0 transition-transform"
            style={{ transform: selectOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          />
        </button>

        {selectOpen && (
          <div
            role="listbox"
            className="absolute left-0 top-full z-50 w-full overflow-hidden rounded-b-md border text-sm shadow-lg"
            style={{
              background:  "var(--colorNeutralBackground1)",
              borderColor: "var(--colorNeutralStroke2)",
              color:       "var(--colorNeutralForeground1)",
              boxShadow:   "0 10px 24px rgba(0,0,0,0.18)",
            }}
          >
            {ISP_LIST.map((it, index) => (
              <IspOption
                key={it.id}
                id={it.id}
                label={it.label}
                active={it.id === isp}
                separated={index > 0}
                onSelect={(id) => {
                  onIspChange(id);
                  setSelectOpen(false);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 items-stretch overflow-x-hidden">
        {tabs.map((t, i) => (
          <TabButton
            key={`${t.label}-${i}`}
            tab={t}
            active={i === tabIdx}
            onClick={() => onTabChange(i)}
          />
        ))}
      </div>
    </div>
  );
}

function IspOption({
  id, label, active, separated, onSelect,
}: {
  id: IspId;
  label: string;
  active: boolean;
  separated: boolean;
  onSelect: (id: IspId) => void;
}) {
  const [hover, setHover] = useState(false);
  const highlighted = hover || active;

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className="flex h-9 w-full items-center px-3 text-left transition-colors"
      style={{
        background: highlighted
          ? "var(--colorNeutralBackground3)"
          : "var(--colorNeutralBackground1)",
        borderTop: separated ? "1px solid var(--colorNeutralStroke2)" : "none",
        color: active
          ? "var(--colorBrandForeground1)"
          : "var(--colorNeutralForeground1)",
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => onSelect(id)}
    >
      {label}
    </button>
  );
}

function TabButton({
  tab, active, onClick,
}: { tab: IspTab; active: boolean; onClick: () => void }) {
  const stub = tab.fileHint === null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex h-full items-center gap-2 px-4 text-sm transition-colors"
      style={{
        color: active
          ? "var(--colorBrandForeground1)"
          : "var(--colorNeutralForeground2)",
        fontWeight: active ? 600 : 500,
      }}
    >
      <span>{tab.label}</span>
      {stub && (
        <span
          className="rounded px-1.5 py-0.5 text-[10px]"
          style={{
            background: "var(--colorNeutralBackground3)",
            color:      "var(--colorNeutralForeground3)",
          }}
        >
          待开发
        </span>
      )}
      {active && (
        <span
          aria-hidden
          className="absolute bottom-0 left-2 right-2 h-0.5 rounded"
          style={{ background: "var(--colorBrandForeground1)" }}
        />
      )}
    </button>
  );
}
