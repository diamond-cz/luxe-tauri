import { useEffect, useRef } from "react";
import { debounce } from "lodash-es";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  loadState,
  computeAdaptiveGeometry,
  currentAvailRect,
  applyWindowGeometry,
  saveWindowGeometry,
} from "@/ipc/stateIo";
import {
  fetchPoetry,
  resolveCloseDecision,
  hideMainWindow,
  quitApp,
  type CloseDecision,
} from "@/ipc/shell";
import { useWindowStore } from "@/stores/windowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useShortcutStore } from "@/stores/shortcutStore";
import { useMtkStore } from "@/stores/mtkStore";
import { useIsp6sVisualStore } from "@/stores/isp6sVisualStore";
import { usePoetryStore } from "@/stores/poetryStore";
import { bootstrapI18n } from "@/locales/i18n";
import { localeAt } from "@/locales";
import {
  EVT_POETRY_UPDATED,
  EVT_SHORTCUT_TRIGGERED,
  EVT_TRAY_ACTION,
} from "@/ipc/client";
import { sendNotification } from "@tauri-apps/plugin-notification";

interface ShellHandlers {
  onNavigate?: (path: string) => void;
  onRequestCloseAsk?: () => void; // open the "remember choice" dialog
  onPoetryChanged?: (line: string) => void;
}

/**
 * Boots the window + shell. Returns nothing; consumers wire side-effects via
 * the handlers passed in.
 */
export function useShellBootstrap(handlers: ShellHandlers) {
  const setMainWindow = useWindowStore((s) => s.setMainWindow);
  const setSettings   = useSettingsStore((s) => s.setSettings);
  const setShortcuts  = useShortcutStore((s) => s.setAll);
  const handlersRef   = useRef(handlers);
  handlersRef.current = handlers;
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;     // StrictMode double-mount guard
    booted.current = true;

    let unlisteners: Array<() => void> = [];
    let geomUnlisteners: Array<Promise<() => void>> = [];

    (async () => {
      /* 1. Load persistent state, hydrate stores. */
      const root = await loadState();
      setMainWindow(root.main_window);
      setSettings(root.settings);
      setShortcuts(root.shortcuts);
      useMtkStore.setState((s) => { s.mtk = root.mtk; });
      useIsp6sVisualStore.getState().setVisual(root.isp6s_ae_visual);

      /* 2. Boot i18n with the saved locale index. */
      const lang = localeAt(root.settings.language);
      await bootstrapI18n(lang);

      /* 3. Compute & apply adaptive geometry, then reveal the window. */
      const avail = await currentAvailRect();
      const target = await computeAdaptiveGeometry(root.main_window, avail);
      await applyWindowGeometry(target);

      /* 4. Wire close handler: backend decision → quit / hide / ask. */
      const win = getCurrentWindow();
      const unCloseRequested = await win.onCloseRequested(async (event) => {
        const decision: CloseDecision = await resolveCloseDecision();
        if (decision === "tray") {
          event.preventDefault();
          await hideMainWindow();
          try {
            await sendNotification({
              title: "LUXE",
              body:  "已最小化到托盘 · 双击托盘图标恢复",
            });
          } catch {/* notifications optional */}
        } else if (decision === "ask") {
          event.preventDefault();
          handlersRef.current.onRequestCloseAsk?.();
        } else {
          // "quit" — the tray icon keeps the process alive when only the
          // window closes (Tauri v2 doesn't auto-exit while a tray is
          // registered). Force a full process exit via app.exit(0).
          event.preventDefault();
          await quitApp().catch(() => {});
        }
      });
      unlisteners.push(unCloseRequested);

      /* 5. Listen for global shortcut & tray events. */
      const unShortcut = await listen<{ action: string }>(
        EVT_SHORTCUT_TRIGGERED,
        ({ payload }) => {
          switch (payload.action) {
            case "home":     handlersRef.current.onNavigate?.("/home");     break;
            case "settings": handlersRef.current.onNavigate?.("/settings"); break;
            case "exit":     quitApp().catch(() => {});                     break;
            case "poetry":   fetchPoetry().catch(() => {});                  break;
          }
        },
      );
      unlisteners.push(unShortcut);

      const unTray = await listen<{ kind: string }>(
        EVT_TRAY_ACTION,
        ({ payload }) => {
          switch (payload.kind) {
            case "show":           // backend already shows/focuses
              break;
            case "refresh_poetry": fetchPoetry().catch(() => {});       break;
            case "settings":       handlersRef.current.onNavigate?.("/settings"); break;
            case "quit":           // backend already exits
              break;
          }
        },
      );
      unlisteners.push(unTray);

      const unPoetry = await listen<string>(EVT_POETRY_UPDATED, ({ payload }) => {
        usePoetryStore.getState().setLine(payload);
        handlersRef.current.onPoetryChanged?.(payload);
        // Keep window title in sync too — taskbar tooltip / Alt+Tab still uses it.
        win.setTitle(`👀 ${payload}`).catch(() => {});
      });
      unlisteners.push(unPoetry);

      /* 6. Persist geometry on resize / move (debounced). */
      const persist = debounce(() => {
        saveWindowGeometry().catch((err) =>
          console.warn("save geom failed", err),
        );
      }, 300);
      geomUnlisteners.push(win.onResized(() => persist()));
      geomUnlisteners.push(win.onMoved(() => persist()));

      /* 7. Initial poetry fetch (don't block boot if it fails). */
      fetchPoetry().catch(() => {});
    })().catch((err) => {
      console.error("[bootstrap]", err);
      getCurrentWindow().show().catch(() => {});
    });

    return () => {
      unlisteners.forEach((fn) => fn());
      geomUnlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, [setMainWindow, setSettings, setShortcuts]);
}
