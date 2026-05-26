import { Button } from "@fluentui/react-components";
import { useTranslation } from "react-i18next";
import logo from "@/assets/luxe-logo.png";
import { SectionTitle } from "@/components/settings/SectionTitle";
import { SettingRow } from "@/components/settings/SettingRow";

const APP_VERSION = "0.1.0";
const REPO_URL    = "https://github.com/diamond-cz/hiz";

function openExternal(url: string) {
  // window.open is intercepted by Tauri webview and routes via the OS default browser.
  window.open(url, "_blank");
}

export function AboutPanel() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center gap-4 pt-2">
      {/* logo + name + version */}
      <img src={logo} alt="LUXE" className="h-24 w-24 rounded-md" />
      <div className="text-2xl font-bold tracking-wide">LUXE</div>
      <div className="text-sm" style={{ color: "var(--colorNeutralForeground3)" }}>
        v{APP_VERSION}
        <span className="mx-2 text-pink-400">❤</span>
        {t("app_desc", { defaultValue: "多平台 AE 算法可视化工具" })}
      </div>

      {/* ────────── 开源 ────────── */}
      <section className="mt-4 flex w-full max-w-3xl flex-col gap-3">
        <SectionTitle title={t("sec_open", { defaultValue: "开源" })} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SettingRow
            icon="ic_fluent_person_regular"
            title={t("about_author",      { defaultValue: "主作者" })}
            desc ={t("about_author_desc", { defaultValue: "diamond-cz" })}
          >
            <Button
              appearance="subtle"
              icon={<OpenGlyph />}
              onClick={() => openExternal(`${REPO_URL}/graphs/contributors`)}
              aria-label="open author"
            />
          </SettingRow>
          <SettingRow
            icon="ic_fluent_home_database_regular"
            title={t("about_repo",      { defaultValue: "开源仓库" })}
            desc ={t("about_repo_desc", { defaultValue: "在 GitHub 上查看项目主页" })}
          >
            <Button
              appearance="subtle"
              icon={<OpenGlyph />}
              onClick={() => openExternal(REPO_URL)}
              aria-label="open repo"
            />
          </SettingRow>
        </div>
      </section>

      {/* ────────── 版权 ────────── */}
      <section className="flex w-full max-w-3xl flex-col gap-3">
        <SectionTitle title={t("sec_copyright", { defaultValue: "版权" })} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <SettingRow
            icon="ic_fluent_info_regular"
            title={t("about_copyright",      { defaultValue: "版权声明" })}
            desc ={t("about_copyright_desc", { defaultValue: "LUXE 版权所有 © 2026 by diamond-cz" })}
          >
            <span />
          </SettingRow>
          <SettingRow
            icon="ic_fluent_diversity_regular"
            title={t("about_icon_pack",      { defaultValue: "图标库" })}
            desc ={t("about_icon_pack_desc", { defaultValue: "本项目内置了 Fluent UI 图标库, Microsoft 公司保有版权" })}
          >
            <span />
          </SettingRow>
        </div>
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