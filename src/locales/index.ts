/**
 * Canonical locale order. The index of each entry corresponds to the value
 * persisted in `[settings].language`. Must match
 * `src-tauri/src/config/translations.rs::LANGUAGE_LOCALES`.
 */
export const LANGUAGE_LOCALES = [
  "zh_CN", "zh_TW", "en_US", "ja_JP", "tr_TR",
] as const;

export type LocaleCode = (typeof LANGUAGE_LOCALES)[number];

/** Display label used in the settings dropdown (no locale lookup needed). */
export const LOCALE_LABELS: Record<LocaleCode, string> = {
  zh_CN: "简体中文",
  zh_TW: "繁體中文",
  en_US: "English",
  ja_JP: "日本語",
  tr_TR: "Türkçe",
};

export const localeAt = (index: number): LocaleCode =>
  LANGUAGE_LOCALES[Number.isInteger(index) && index >= 0 && index < LANGUAGE_LOCALES.length ? index : 0];

export const indexOfLocale = (code: string): number => {
  const i = (LANGUAGE_LOCALES as readonly string[]).indexOf(code);
  return i < 0 ? 0 : i;
};
