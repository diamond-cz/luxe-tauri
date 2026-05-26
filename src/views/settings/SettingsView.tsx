import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GeneralPanel } from "./GeneralPanel";
import { ShortcutPanel } from "./ShortcutPanel";
import { AboutPanel } from "./AboutPanel";

type Tab = "general" | "shortcut" | "about";

export function SettingsView() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("general");

  const tabs: { id: Tab; label: string }[] = [
    { id: "general",  label: t("tab_general",  { defaultValue: "通用" })   },
    { id: "shortcut", label: t("tab_shortcut", { defaultValue: "快捷键" }) },
    { id: "about",    label: t("tab_about",    { defaultValue: "关于" })   },
  ];

  return (
    <div className="flex h-full w-full flex-col">
      {/* ─── Page header ─── */}
      <div className="relative flex shrink-0 items-center justify-between px-10 pt-8 pb-4">
        <h1 className="text-2xl font-semibold">
          {t("app_title", { defaultValue: "应用设置" })}
        </h1>
        <TabPills tabs={tabs} active={tab} onChange={setTab} />
        <span aria-hidden style={{ width: 1 }} />
      </div>

      {/* ─── Panel body (scrolls) ─── */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-10 pb-8">
        <div className="mx-auto w-full max-w-4xl">
          {tab === "general"  && <GeneralPanel />}
          {tab === "shortcut" && <ShortcutPanel />}
          {tab === "about"    && <AboutPanel />}
        </div>
      </div>
    </div>
  );
}

interface TabPillsProps {
  tabs:    { id: Tab; label: string }[];
  active:  Tab;
  onChange:(t: Tab) => void;
}

function TabPills({ tabs, active, onChange }: TabPillsProps) {
  return (
    <div
      role="tablist"
      className="absolute left-1/2 top-8 -translate-x-1/2 flex rounded-full p-1"
      style={{
        background: "var(--colorNeutralBackground3)",
        border:     "1px solid var(--colorNeutralStroke2)",
      }}
    >
      {tabs.map((tb) => {
        const selected = tb.id === active;
        return (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tb.id)}
            className="rounded-full px-5 py-1.5 text-sm transition-colors"
            style={{
              background: selected ? "var(--colorBrandBackground)" : "transparent",
              color:      selected ? "var(--colorNeutralForegroundOnBrand)" : "var(--colorNeutralForeground2)",
              fontWeight: selected ? 600 : 500,
            }}
          >
            {tb.label}
          </button>
        );
      })}
    </div>
  );
}