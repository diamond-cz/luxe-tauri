import {
  Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Checkbox, Button,
} from "@fluentui/react-components";
import {
  ArrowMinimize24Filled,
  ArrowExit24Filled,
  Dismiss24Regular,
} from "@fluentui/react-icons";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { hideMainWindow, quitApp, saveSettings } from "@/ipc/shell";
import { useSettingsStore } from "@/stores/settingsStore";
import type { Settings } from "@/types/ipc";

interface Props {
  open:    boolean;
  onClose: () => void;
}

interface OptionMeta {
  kind:     "tray" | "quit";
  title:    string;
  desc:     string;
  iconBg:   string;
  Icon:     React.ComponentType<{ className?: string }>;
}

/**
 * Reference: hiz CloseConfirmDialog (see chat screenshot Image #18).
 *
 * Layout uses Fluent v9 slots correctly:
 *   <DialogTitle action={<X/>}>title</DialogTitle>     ← X lives in the title slot
 *   <DialogContent>subtitle + cards + checkbox</DialogContent>
 *
 * Putting raw <div>s as DialogBody siblings (my first cut) caused Fluent's
 * grid template to flatten them onto the title row — that's the visual bug
 * in screenshot #17.
 */
export function CloseBehaviorDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const settings    = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const [remember, setRemember] = useState(false);

  useEffect(() => { if (!open) setRemember(false); }, [open]);

  const onPick = async (kind: "tray" | "quit") => {
    if (remember) {
      const next: Settings = { ...settings, close_behavior: kind === "tray" ? 1 : 2 };
      setSettings(next);
      await saveSettings(next).catch(() => {});
    }
    onClose();
    if (kind === "tray") await hideMainWindow().catch(() => {});
    else                 await quitApp().catch(() => {});
  };

  const options: OptionMeta[] = [
    {
      kind:   "tray",
      title:  t("close_tray",      { defaultValue: "最小化到托盘" }),
      desc:   t("close_tray_desc", { defaultValue: "应用将在后台继续运行" }),
      iconBg: "#2D7BF4",
      Icon:   ArrowMinimize24Filled,
    },
    {
      kind:   "quit",
      title:  t("close_exit",      { defaultValue: "退出应用" }),
      desc:   t("close_exit_desc", { defaultValue: "完全关闭应用程序" }),
      iconBg: "#E83A3A",
      Icon:   ArrowExit24Filled,
    },
  ];

  return (
    <Dialog open={open} modalType="modal" onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface style={{ maxWidth: 520, borderRadius: 16 }}>
        <DialogBody>
          <DialogTitle
            action={
              <Button
                appearance="subtle"
                size="small"
                icon={<Dismiss24Regular />}
                onClick={onClose}
                aria-label="close"
              />
            }
          >
            {t("close_dialog_title", { defaultValue: "关闭窗口" })}
          </DialogTitle>

          <DialogContent>
            <div className="flex flex-col gap-4">
              {/* Subtitle, sits right under the title */}
              <div className="text-sm" style={{ color: "var(--colorNeutralForeground3)" }}>
                {t("close_dialog_desc", { defaultValue: "请选择关闭窗口时的操作" })}
              </div>

              {/* Two big card buttons */}
              <div className="flex flex-col gap-3">
                {options.map(({ kind, title, desc, iconBg, Icon }) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => onPick(kind)}
                    className={
                      "group flex items-center gap-4 rounded-xl border px-4 py-4 text-left " +
                      "transition-all hover:shadow-md focus:outline-none"
                    }
                    style={{
                      background:  "var(--colorNeutralBackground1)",
                      borderColor: "var(--colorNeutralStroke2)",
                    }}
                  >
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: iconBg, color: "#fff" }}
                    >
                      <Icon />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-semibold"
                           style={{ color: "var(--colorNeutralForeground1)" }}>
                        {title}
                      </div>
                      <div className="mt-0.5 text-xs"
                           style={{ color: "var(--colorNeutralForeground3)" }}>
                        {desc}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Remember checkbox */}
              <div className="pt-1">
                <Checkbox
                  checked={remember}
                  onChange={(_, d) => setRemember(d.checked === true)}
                  label={t("close_dialog_remember", { defaultValue: "记住我的选择，不再询问" })}
                />
              </div>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}