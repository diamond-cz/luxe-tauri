import { useTranslation } from "react-i18next";
import { Select, Input, Switch, Button } from "@fluentui/react-components";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { useSettingsStore } from "@/stores/settingsStore";
import { saveSettings, getConfigDir, openPath } from "@/ipc/shell";
import { LANGUAGE_LOCALES, LOCALE_LABELS, localeAt, type LocaleCode } from "@/locales";
import { setActiveLocale } from "@/locales/i18n";
import type { Settings } from "@/types/ipc";
import { SectionTitle } from "@/components/settings/SectionTitle";
import { SettingRow } from "@/components/settings/SettingRow";

const SCALE_OPTIONS = [90, 100, 110, 125, 150] as const;
const SELECT_WIDTH = 200;

export function GeneralPanel() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);

  const persist = async (next: Settings) => {
    setSettings(next);
    await saveSettings(next).catch((err) => console.warn("save settings", err));
  };

  const currentLocale: LocaleCode = localeAt(settings.language);

  const onLanguage = async (code: LocaleCode) => {
    await setActiveLocale(code);
    await persist({ ...settings, language: LANGUAGE_LOCALES.indexOf(code) });
  };

  const openConfigDir = async () => {
    try {
      const dir = await getConfigDir();
      await openPath(dir);
    } catch (err) {
      console.warn("open config dir", err);
    }
  };

  const browseCache = async () => {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked === "string") persist({ ...settings, cache_path: picked });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ────────── 通用 ────────── */}
      <section className="flex flex-col gap-3">
        <SectionTitle title={t("sec_general", { defaultValue: "通用" })} />

        <SettingRow
          icon="ic_fluent_local_language_regular"
          title={t("language", { defaultValue: "显示语言" })}
          desc={t("language_desc", { defaultValue: "选择界面的显示语言" })}
        >
          <Select
            value={currentLocale}
            onChange={(_, d) => onLanguage(d.value as LocaleCode)}
            style={{ minWidth: SELECT_WIDTH }}
          >
            {LANGUAGE_LOCALES.map((code) => (
              <option key={code} value={code}>{LOCALE_LABELS[code]}</option>
            ))}
          </Select>
        </SettingRow>

        <SettingRow
          icon="ic_fluent_dark_theme_regular"
          title={t("theme", { defaultValue: "应用主题" })}
          desc={t("theme_desc", { defaultValue: "切换深色或浅色模式" })}
        >
          <Select
            value={settings.theme}
            onChange={(_, d) => persist({ ...settings, theme: d.value })}
            style={{ minWidth: SELECT_WIDTH }}
          >
            <option value="dark">  {t("theme_dark",   { defaultValue: "深色模式" })}</option>
            <option value="light"> {t("theme_light",  { defaultValue: "浅色模式" })}</option>
            <option value="system">{t("theme_system", { defaultValue: "跟随系统" })}</option>
          </Select>
        </SettingRow>

        <SettingRow
          icon="ic_fluent_resize_large_regular"
          title={t("scale", { defaultValue: "界面缩放" })}
          desc={t("scale_desc", { defaultValue: "调整界面缩放比例" })}
        >
          <Select
            value={String(settings.scale)}
            onChange={(_, d) => persist({ ...settings, scale: parseInt(d.value, 10) })}
            style={{ minWidth: SELECT_WIDTH }}
          >
            {SCALE_OPTIONS.map((s) => (
              <option key={s} value={String(s)}>{s}%</option>
            ))}
          </Select>
        </SettingRow>

        <SettingRow
          icon="ic_fluent_dismiss_square_regular"
          title={t("close_behavior", { defaultValue: "窗口关闭行为" })}
          desc={t("close_behavior_desc", { defaultValue: "选择关闭窗口时的默认行为" })}
        >
          <Select
            value={String(settings.close_behavior)}
            onChange={(_, d) =>
              persist({ ...settings, close_behavior: Number(d.value) as 0 | 1 | 2 })
            }
            style={{ minWidth: SELECT_WIDTH }}
          >
            <option value="0">{t("close_ask",  { defaultValue: "每次询问" })}</option>
            <option value="1">{t("close_tray", { defaultValue: "最小化到托盘" })}</option>
            <option value="2">{t("close_exit", { defaultValue: "直接退出" })}</option>
          </Select>
        </SettingRow>

        <SettingRow
          icon="ic_fluent_folder_regular"
          title={t("config_dir", { defaultValue: "配置目录" })}
          desc={t("config_dir_desc", { defaultValue: "打开项目配置文件存储目录" })}
        >
          <Button appearance="secondary" icon={<OpenGlyph />} onClick={openConfigDir}>
            {t("open", { defaultValue: "打开" })}
          </Button>
        </SettingRow>

        <SettingRow
          icon="ic_fluent_folder_regular"
          title={t("cache_path", { defaultValue: "缓存路径" })}
          desc={t("cache_path_desc", { defaultValue: "留空则使用默认路径" })}
        >
          <Input
            value={settings.cache_path}
            placeholder={t("placeholder_cache", { defaultValue: "默认路径" })}
            onChange={(_, d) => persist({ ...settings, cache_path: d.value })}
            style={{ minWidth: 220 }}
          />
          <Button appearance="secondary" onClick={browseCache}>
            {t("browse", { defaultValue: "选择" })}
          </Button>
          <Button appearance="secondary" onClick={() => persist({ ...settings, cache_path: "" })}>
            {t("reset", { defaultValue: "重置默认" })}
          </Button>
        </SettingRow>
      </section>

      {/* ────────── 更新 ────────── */}
      <section className="flex flex-col gap-3">
        <SectionTitle title={t("sec_update", { defaultValue: "更新" })} />

        <SettingRow
          icon="ic_fluent_arrow_sync_regular"
          title={t("auto_update", { defaultValue: "启动时自动检查更新" })}
          desc={t("auto_update_desc", { defaultValue: "启动后自动检查 GitHub 最新版本；当前仅提醒并打开 Release" })}
        >
          <Select
            value={settings.auto_update ? "true" : "false"}
            onChange={(_, d) => persist({ ...settings, auto_update: d.value === "true" })}
            style={{ minWidth: SELECT_WIDTH }}
          >
            <option value="false">{t("update_off", { defaultValue: "关闭（手动检查）" })}</option>
            <option value="true"> {t("update_on",  { defaultValue: "开启（启动时检查）" })}</option>
          </Select>
        </SettingRow>

        <SettingRow
          icon="ic_fluent_alert_regular"
          title={t("update_notify", { defaultValue: "更新提醒" })}
          desc={t("update_notify_desc", { defaultValue: "检测到新版本时发送系统通知，并在侧边栏首页入口显示提示" })}
        >
          <Switch
            checked={settings.update_notify}
            onChange={(_, d) => persist({ ...settings, update_notify: d.checked === true })}
          />
        </SettingRow>
      </section>
    </div>
  );
}

function OpenGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H5v12h12v-6h2v6c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7c0-1.1.9-2 2-2z"/>
    </svg>
  );
}
