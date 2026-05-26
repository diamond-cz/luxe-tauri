import { MemoryRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { FluentProvider } from "@fluentui/react-components";
import { useCallback, useEffect, useState } from "react";

import { pickTheme } from "@/theme/fluent-tokens";
import { SideNav } from "@/components/shell/SideNav";
import { CloseBehaviorDialog } from "@/components/shell/CloseBehaviorDialog";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { HomeView } from "@/views/HomeView";
import { MtkView } from "@/views/mtk/MtkView";
import { QualcommView } from "@/views/QualcommView";
import { UnisocView } from "@/views/UnisocView";
import { SettingsView } from "@/views/settings/SettingsView";
import { useShellBootstrap } from "@/hooks/useShellBootstrap";
import { useSettingsStore } from "@/stores/settingsStore";

export default function App() {
  /* React to settings.theme so the FluentProvider can switch dark↔light live. */
  const themeKey = useSettingsStore((s) => s.settings.theme);
  const theme    = pickTheme(themeKey);

  return (
    <FluentProvider theme={theme} className="h-full">
      <ErrorBoundary>
        <MemoryRouter initialEntries={["/home"]}>
          <ShellRoot />
        </MemoryRouter>
      </ErrorBoundary>
    </FluentProvider>
  );
}

function ShellRoot() {
  const navigate = useNavigate();
  const [askClose, setAskClose] = useState(false);

  const onNavigate         = useCallback((path: string) => navigate(path), [navigate]);
  const onRequestCloseAsk  = useCallback(() => setAskClose(true), []);

  useShellBootstrap({ onNavigate, onRequestCloseAsk });

  /* Drive global theme + scale at the <html> root so body bg / scrollbar /
   * tooltips outside FluentProvider all stay consistent. */
  const themeKey = useSettingsStore((s) => s.settings.theme);
  const scale    = useSettingsStore((s) => s.settings.scale);
  useEffect(() => {
    const resolved =
      themeKey === "system"
        ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : (themeKey === "light" ? "light" : "dark");
    document.documentElement.classList.toggle("dark",  resolved === "dark");
    document.documentElement.classList.toggle("light", resolved === "light");
  }, [themeKey]);
  useEffect(() => {
    const clamped = Math.max(50, Math.min(scale, 200));
    document.documentElement.style.fontSize = `${(16 * clamped) / 100}px`;
  }, [scale]);

  return (
    <div className="flex h-full w-full">
      <SideNav />
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
        <ErrorBoundary>
          <Routes>
            <Route path="/"         element={<Navigate to="/home" replace />} />
            <Route path="/home"     element={<HomeView />} />
            <Route path="/mtk/*"    element={<MtkView />} />
            <Route path="/qualcomm" element={<QualcommView />} />
            <Route path="/unisoc"   element={<UnisocView />} />
            <Route path="/settings" element={<SettingsView />} />
          </Routes>
        </ErrorBoundary>
      </main>
      <CloseBehaviorDialog open={askClose} onClose={() => setAskClose(false)} />
    </div>
  );
}