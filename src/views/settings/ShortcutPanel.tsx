import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { SectionTitle } from "@/components/settings/SectionTitle";
import { SettingRow } from "@/components/settings/SettingRow";
import { KeyRecorder } from "@/components/settings/KeyRecorder";
import { useShortcutStore } from "@/stores/shortcutStore";
import { updateShortcuts } from "@/ipc/shell";
import type { Shortcuts } from "@/types/ipc";

const ROWS: { id: keyof Shortcuts; labelKey: string; defaultLabel: string }[] = [
  { id: "home",     labelKey: "shortcut_home_label",     defaultLabel: "跳转到主页"   },
  { id: "settings", labelKey: "shortcut_settings_label", defaultLabel: "跳转到设置页" },
  { id: "exit",     labelKey: "shortcut_exit_label",     defaultLabel: "退出应用"     },
  { id: "poetry",   labelKey: "shortcut_poetry_label",   defaultLabel: "切换诗词"     },
];

export function ShortcutPanel() {
  const { t } = useTranslation();
  const shortcuts    = useShortcutStore((s) => s.shortcuts);
  const setShortcuts = useShortcutStore((s) => s.setAll);

  /** Working copy; flushed on every keystroke so user sees immediate feedback. */
  const [draft, setDraft] = useState<Shortcuts>(shortcuts);
  useEffect(() => { setDraft(shortcuts); }, [shortcuts]);

  const flush = async (next: Shortcuts) => {
    setDraft(next);
    setShortcuts(next);
    await updateShortcuts(next).catch((err) =>
      console.warn("update_shortcuts failed", err),
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle title={t("sec_shortcut", { defaultValue: "快捷键设置" })} />
      {ROWS.map(({ id, labelKey, defaultLabel }) => (
        <SettingRow
          key={id}
          icon="ic_fluent_keyboard_regular"
          title={t(labelKey, { defaultValue: defaultLabel })}
        >
          <KeyRecorder
            value={draft[id]}
            onChange={(accel) => flush({ ...draft, [id]: accel })}
            onClear={() => flush({ ...draft, [id]: "" })}
          />
        </SettingRow>
      ))}
    </div>
  );
}