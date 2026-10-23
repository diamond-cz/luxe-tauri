import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { FluentProvider } from "@fluentui/react-components";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { loadState } from "@/ipc/stateIo";
import { bootstrapI18n } from "@/locales/i18n";
import { localeAt } from "@/locales";
import { pickTheme } from "@/theme/fluent-tokens";
import { ColumnSettingsWindow } from "@/views/mtk/isp6s/TablePane/ColumnSettingsWindow";
import { consumeColumnSettingsBootstrap } from "@/views/mtk/isp6s/TablePane/columnSettingsBootstrap";
import "./styles/globals.css";

const mode = new URLSearchParams(window.location.search).get("mode") === "tone" ? "tone" : "isp6s";
const bootstrap = consumeColumnSettingsBootstrap(mode);
const initialTheme = bootstrap?.theme ?? "dark";

function applyThemeClass(theme: string) {
  const light = theme === "light" || (theme === "system" && !window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("light", light);
  document.documentElement.classList.toggle("dark", !light);
}

applyThemeClass(initialTheme);

function ColumnSettingsApp() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    let active = true;
    void loadState().then((state) => {
      if (!active) return;
      if (!bootstrap) setTheme(state.settings.theme);
      void bootstrapI18n(localeAt(state.settings.language))
        .catch((error) => console.warn("load column settings translations", error));
    }).catch((error) => console.warn("load column settings preferences", error));
    return () => { active = false; };
  }, []);
  useEffect(() => { applyThemeClass(theme); }, [theme]);

  return <FluentProvider id="column-settings-theme-root" theme={pickTheme(theme)} className="h-full" applyStylesToPortals={false}>
    <ErrorBoundary><ColumnSettingsWindow initialSchema={bootstrap?.schema} /></ErrorBoundary>
  </FluentProvider>;
}

document.addEventListener("contextmenu", (event) => event.preventDefault(), { capture: true });
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><ColumnSettingsApp /></React.StrictMode>,
);
