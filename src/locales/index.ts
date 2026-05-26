/**
 * Canonical locale order. The index of each entry corresponds to the value
 * persisted in `[settings].language`. Must match
 * `src-tauri/src/config/translations.rs::LANGUAGE_LOCALES`.
 */
export const LANGUAGE_LOCALES = [
  "zh_CN", "zh_TW", "en_US", "ja_JP", "ko_KR",
  "de_DE", "fr_FR", "es_ES", "pt_BR", "ru_RU",
  "it_IT", "tr_TR", "pl_PL", "cs_CZ", "vi_VN", "ar_SA",
] as const;

export type LocaleCode = (typeof LANGUAGE_LOCALES)[number];

/** Display label used in the settings dropdown (no locale lookup needed). */
export const LOCALE_LABELS: Record<LocaleCode, string> = {
  zh_CN: "简体中文",
  zh_TW: "繁體中文",
  en_US: "English",
  ja_JP: "日本語",
  ko_KR: "한국어",
  de_DE: "Deutsch",
  fr_FR: "Français",
  es_ES: "Español",
  pt_BR: "Português (BR)",
  ru_RU: "Русский",
  it_IT: "Italiano",
  tr_TR: "Türkçe",
  pl_PL: "Polski",
  cs_CZ: "Čeština",
  vi_VN: "Tiếng Việt",
  ar_SA: "العربية",
};

export const localeAt = (index: number): LocaleCode =>
  LANGUAGE_LOCALES[Math.max(0, Math.min(index, LANGUAGE_LOCALES.length - 1))];

export const indexOfLocale = (code: string): number => {
  const i = (LANGUAGE_LOCALES as readonly string[]).indexOf(code);
  return i < 0 ? 0 : i;
};
