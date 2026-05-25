import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { FluentProvider } from "@fluentui/react-components";
import { luxeDarkTheme } from "@/theme/fluent-tokens";
import { SideNav } from "@/components/shell/SideNav";
import { HomeView } from "@/views/HomeView";
import { MtkView } from "@/views/mtk/MtkView";
import { QualcommView } from "@/views/QualcommView";
import { UnisocView } from "@/views/UnisocView";
import { SettingsView } from "@/views/SettingsView";
import { useWindowBootstrap } from "@/hooks/useWindowBootstrap";

export default function App() {
  useWindowBootstrap();

  return (
    <FluentProvider theme={luxeDarkTheme} className="h-full">
      <MemoryRouter initialEntries={["/home"]}>
        <div className="flex h-full w-full">
          <SideNav />
          <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
            <Routes>
              <Route path="/"          element={<Navigate to="/home" replace />} />
              <Route path="/home"      element={<HomeView />} />
              <Route path="/mtk/*"     element={<MtkView />} />
              <Route path="/qualcomm"  element={<QualcommView />} />
              <Route path="/unisoc"    element={<UnisocView />} />
              <Route path="/settings"  element={<SettingsView />} />
            </Routes>
          </main>
        </div>
      </MemoryRouter>
    </FluentProvider>
  );
}
