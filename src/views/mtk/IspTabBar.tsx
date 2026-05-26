import type { IspTab } from "./ispTabs";

interface Props {
  tabs:    IspTab[];
  current: number;
  onChange:(idx: number) => void;
}

export function IspTabBar({ tabs, current, onChange }: Props) {
  return (
    <div
      className="flex h-10 shrink-0 items-stretch"
      style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}
    >
      {tabs.map((tab, idx) => {
        const active = idx === current;
        const stub   = tab.fileHint === null;
        return (
          <button
            key={`${tab.label}-${idx}`}
            type="button"
            onClick={() => onChange(idx)}
            className="relative flex items-center gap-2 px-4 text-sm transition-colors"
            style={{
              color: active
                ? "var(--colorBrandForeground1)"
                : "var(--colorNeutralForeground2)",
              fontWeight: active ? 600 : 500,
              background: active ? "var(--colorNeutralBackground1)" : "transparent",
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
      })}
    </div>
  );
}
