import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { call } from "@/ipc/client";
import { LANGUAGE_LOCALES, type LocaleCode } from "./index";

type LocaleBundle = Record<string, string>;
type AllBundles  = Record<string, LocaleBundle>;

let bootstrapped = false;

/**
 * Boot i18next with bundles fetched from Rust. fallback chain:
 *   current_locale → zh_CN → key string (parseMissingKeyHandler)
 */
export async function bootstrapI18n(initial: LocaleCode): Promise<void> {
  if (bootstrapped) {
    await i18n.changeLanguage(initial);
    return;
  }
  bootstrapped = true;

  const bundles = await call<AllBundles>("get_all_locale_bundles");

  const resources = Object.fromEntries(
    LANGUAGE_LOCALES.map((code) => [
      code,
      { translation: bundles[code] ?? {} },
    ]),
  );

  await i18n.use(initReactI18next).init({
    resources,
    lng:           initial,
    fallbackLng:   "zh_CN",
    defaultNS:     "translation",
    interpolation: { escapeValue: false },         // React already escapes
    parseMissingKeyHandler: (key) => key,           // mirror Python tr() behaviour
    returnNull:    false,
    returnEmptyString: false,
  });
}

export async function setActiveLocale(code: LocaleCode): Promise<void> {
  await i18n.changeLanguage(code);
}

export { i18n };
