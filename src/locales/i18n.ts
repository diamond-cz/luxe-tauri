import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { call } from "@/ipc/client";
import { LANGUAGE_LOCALES, type LocaleCode } from "./index";

type LocaleBundle = Record<string, string>;
type AllBundles  = Record<string, LocaleBundle>;

/**
 * Module-load synchronous init. The instance is valid (just with empty
 * resources) before React renders, so `useTranslation()` never triggers
 * Suspense or queue-shape changes.
 *
 * Why this matters: i18next.init() is async-ish and updates hook state.
 * If useTranslation() runs BEFORE init, its internal useState queue uses
 * one shape; then init mutates state and the next render's updateReducer
 * trips on "Should have a queue".
 */
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources:     {},
    lng:           "zh_CN",
    fallbackLng:   "zh_CN",
    defaultNS:     "translation",
    interpolation: { escapeValue: false },
    parseMissingKeyHandler: (key) => key,
    returnNull:        false,
    returnEmptyString: false,
    react: { useSuspense: false },
  }).catch((err) => console.warn("i18n init failed", err));
}

let bundlesLoaded = false;

/** Fetch every bundle from Rust and register them. Idempotent. */
export async function loadAllBundles(): Promise<void> {
  if (bundlesLoaded) return;
  const bundles = await call<AllBundles>("get_all_locale_bundles");
  for (const code of LANGUAGE_LOCALES) {
    const bundle = bundles[code];
    if (!bundle) continue;
    i18n.addResourceBundle(code, "translation", bundle, true, true);
  }
  bundlesLoaded = true;
}

/** Convenience used by useShellBootstrap during startup. */
export async function bootstrapI18n(initial: LocaleCode): Promise<void> {
  await loadAllBundles();
  if (i18n.language !== initial) {
    await i18n.changeLanguage(initial);
  }
}

export async function setActiveLocale(code: LocaleCode): Promise<void> {
  await loadAllBundles();
  await i18n.changeLanguage(code);
}

export { i18n };
