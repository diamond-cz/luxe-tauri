import { MemoryRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { FluentProvider } from "@fluentui/react-components";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { pickTheme } from "@/theme/fluent-tokens";
import { SideNav } from "@/components/shell/SideNav";
import { TitleBar } from "@/components/shell/TitleBar";
import { CloseBehaviorDialog } from "@/components/shell/CloseBehaviorDialog";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { GlobalTitleTooltip } from "@/components/common/HoverTooltip";
import { useShellBootstrap } from "@/hooks/useShellBootstrap";
import { useSettingsStore } from "@/stores/settingsStore";

const HomeView = lazy(() => import("@/views/HomeView").then(({ HomeView }) => ({ default: HomeView })));
const MtkView = lazy(() => import("@/views/mtk/MtkView").then(({ MtkView }) => ({ default: MtkView })));
const QualcommView = lazy(() => import("@/views/QualcommView").then(({ QualcommView }) => ({ default: QualcommView })));
const UnisocView = lazy(() => import("@/views/UnisocView").then(({ UnisocView }) => ({ default: UnisocView })));
const SettingsView = lazy(() => import("@/views/settings/SettingsView").then(({ SettingsView }) => ({ default: SettingsView })));

export default function App() {
  const themeKey = useSettingsStore((s) => s.settings.theme);
  const theme    = pickTheme(themeKey);

  return (
    <FluentProvider theme={theme} className="h-full">
      <ErrorBoundary>
        <MemoryRouter initialEntries={["/home"]}>
          <ShellRoot />
          <GlobalTitleTooltip />
        </MemoryRouter>
      </ErrorBoundary>
    </FluentProvider>
  );
}

function ShellRoot() {
  const navigate = useNavigate();
  const location = useLocation();
  const [askClose, setAskClose] = useState(false);

  const onNavigate         = useCallback((path: string) => navigate(path), [navigate]);
  const onRequestCloseAsk  = useCallback(() => setAskClose(true), []);

  useShellBootstrap({ onNavigate, onRequestCloseAsk });

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
    <div className="flex h-full w-full flex-col">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <SideNav />
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
          {/* Auto-reset on route change so a crash in one view doesn't
              persist after the user navigates away. */}
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<RouteFallback />}>
              <Routes>
                <Route path="/"         element={<Navigate to="/home" replace />} />
                <Route path="/home"     element={<HomeView />} />
                <Route path="/mtk/*"    element={<MtkView />} />
                <Route path="/qualcomm" element={<QualcommView />} />
                <Route path="/unisoc"   element={<UnisocView />} />
                <Route path="/settings" element={<SettingsView />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <CloseBehaviorDialog open={askClose} onClose={() => setAskClose(false)} />
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs"
         style={{ color: "var(--colorNeutralForeground3)" }}>
      加载中...
    </div>
  );
}
