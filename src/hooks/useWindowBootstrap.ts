import { useEffect, useRef } from "react";
import { debounce } from "lodash-es";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  loadState,
  computeAdaptiveGeometry,
  currentAvailRect,
  applyWindowGeometry,
  saveWindowGeometry,
} from "@/ipc/stateIo";
import { useWindowStore } from "@/stores/windowStore";
import { useSettingsStore } from "@/stores/settingsStore";

/**
 * Boots the window: load state, compute adaptive geometry, apply, then wire
 * resize/move listeners that persist debounced geometry back to disk.
 */
export function useWindowBootstrap() {
  const setMainWindow = useWindowStore((s) => s.setMainWindow);
  const setSettings   = useSettingsStore((s) => s.setSettings);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;     // guard StrictMode double-mount
    booted.current = true;

    (async () => {
      const root = await loadState();
      setMainWindow(root.main_window);
      setSettings(root.settings);

      const avail = await currentAvailRect();
      const target = await computeAdaptiveGeometry(root.main_window, avail);
      await applyWindowGeometry(target);
    })().catch((err) => {
      // Surface anything that breaks the boot path; fall back to default size.
      console.error("[bootstrap]", err);
      getCurrentWindow().show().catch(() => {});
    });

    const win = getCurrentWindow();
    const persist = debounce(() => {
      saveWindowGeometry().catch((err) => console.warn("save geom failed", err));
    }, 300);

    const unlistenResize = win.onResized(() => persist());
    const unlistenMove   = win.onMoved(() => persist());

    return () => {
      persist.cancel();
      unlistenResize.then((f) => f());
      unlistenMove.then((f) => f());
    };
  }, [setMainWindow, setSettings]);
}
